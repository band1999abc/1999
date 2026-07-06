#!/usr/bin/env python3
"""
Development server for Replit.

Routes
------
GET  /api/weather          — IP-geolocated weather condition
GET  /api/auth             — session check  → {"ok": bool}
POST /api/auth             — login / logout → {"ok": bool}
GET  /api/diary            — list posts (auth → all; unauth → published only)
POST /api/diary            — create post (auth required)
GET  /api/diary/<id>       — get single post
PUT  /api/diary/<id>       — update post (auth required)
DELETE /api/diary/<id>     — delete post (auth required)
GET  /afterhours           — admin gate → afterhours.html or login.html
GET  /afterhours/diary     — diary admin gate → afterhours-diary.html or redirect
GET  *                     — static files via SimpleHTTPRequestHandler
"""

import base64
import hashlib
import hmac
import http.server
import json
import os
import re
import time
import urllib.parse
import urllib.request
import uuid as _uuid_mod

# ── Paths ─────────────────────────────────────────────────────────────────────

_ROOT      = os.path.dirname(os.path.abspath(__file__))
_TEMPLATES = os.path.join(_ROOT, 'templates')
_DATA_DIR  = os.path.join(_ROOT, 'data')

# ── Auth helpers ──────────────────────────────────────────────────────────────

_COOKIE_NAME = 'admin_session'
_MAX_AGE     = 7 * 24 * 3600          # 7 days in seconds


def _get_members():
    """Return list of {name, password, comment} dicts.

    Reads MEMBERS env var (JSON array), e.g.:
      [{"name":"Alice","password":"pw1","comment":"おかえり、Aliceさん。"},
       {"name":"Bob",  "password":"pw2","comment":"こんばんは、Bobさん。"}]
    Falls back to ADMIN_PASSWORD with name "Admin".
    """
    raw = os.environ.get('MEMBERS', '').strip()
    if raw:
        try:
            arr = json.loads(raw)
            if isinstance(arr, list) and arr:
                print(f'[auth] MEMBERS loaded: {len(arr)} member(s): '
                      + ', '.join(m.get("name", "?") for m in arr))
                return arr
            else:
                print(f'[auth] MEMBERS parsed but not a non-empty list: {type(arr)}')
        except json.JSONDecodeError as e:
            print(f'[auth] MEMBERS JSON parse error: {e}')
            print(f'[auth] MEMBERS raw (first 200 chars): {raw[:200]!r}')
    else:
        print('[auth] MEMBERS env var is empty or not set')
    pw = os.environ.get('ADMIN_PASSWORD', '')
    print(f'[auth] falling back to ADMIN_PASSWORD (set={bool(pw)})')
    return [{'name': 'Admin', 'password': pw, 'comment': 'おかえりなさい。'}] if pw else []


def _get_member_comment(name):
    for m in _get_members():
        if m.get('name') == name:
            return m.get('comment', '')
    return ''


def _make_token(member_name=''):
    exp     = time.time() + _MAX_AGE
    payload = base64.urlsafe_b64encode(
        json.dumps({'exp': exp, 'member': member_name}).encode()
    ).decode().rstrip('=')
    secret  = os.environ.get('SESSION_SECRET', '')
    sig     = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}.{sig}'


def _verify_token(token):
    """Returns member name (str, possibly '') if valid, None if invalid/expired."""
    try:
        dot = token.rfind('.')
        if dot < 1:
            return None
        payload  = token[:dot]
        sig      = token[dot + 1:]
        secret   = os.environ.get('SESSION_SECRET', '')
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload + '=' * (-len(payload) % 4)
        data   = json.loads(base64.urlsafe_b64decode(padded))
        if time.time() >= data['exp']:
            return None
        return data.get('member', '')
    except Exception:
        return None


def _parse_cookies(header):
    out = {}
    for part in (header or '').split(';'):
        idx = part.find('=')
        if idx < 0:
            continue
        out[part[:idx].strip()] = part[idx + 1:].strip()
    return out


def _cookie_header(token):
    age = _MAX_AGE if token else 0
    val = token or ''
    return (f'{_COOKIE_NAME}={val}; HttpOnly; SameSite=Strict; '
            f'Path=/; Max-Age={age}')


# ── Diary storage helpers ─────────────────────────────────────────────────────

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _today_iso():
    return time.strftime('%Y-%m-%d')


def _valid_date(s):
    """Return s if it matches YYYY-MM-DD, else return today's date."""
    return s if (s and _DATE_RE.match(s)) else _today_iso()


def _load_diary():
    path = os.path.join(_DATA_DIR, 'diary.json')
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            print('[diary] WARNING: diary.json is not a list, resetting to []')
            return []
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f'[diary] WARNING: could not load diary.json: {e}')
        return []


def _save_diary(posts):
    os.makedirs(_DATA_DIR, exist_ok=True)
    path = os.path.join(_DATA_DIR, 'diary.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)


# ── Request handler ───────────────────────────────────────────────────────────

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):

    # ── Routing ───────────────────────────────────────────────────────────────

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/')
        if self.path.startswith('/api/weather'):
            self._handle_weather()
        elif path == '/api/auth':
            self._handle_auth_get()
        elif path == '/afterhours/diary':
            self._handle_afterhours_diary()
        elif path == '/afterhours/login':
            self._serve_template('login.html')
        elif path == '/afterhours':
            self._handle_afterhours()
        elif path == '/api/diary':
            self._handle_diary_list()
        elif path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_get(item_id)
            else:
                self.send_error(404)
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/auth':
            self._handle_auth_post()
        elif path == '/api/diary':
            self._handle_diary_create()
        else:
            self.send_error(404)

    def do_PUT(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_update(item_id)
                return
        self.send_error(404)

    def do_DELETE(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_delete(item_id)
                return
        self.send_error(404)

    # ── No-cache headers for HTML ─────────────────────────────────────────────

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path in ('/', '') or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            # Reduce XSS blast-radius now that the admin token lives in sessionStorage
            self.send_header(
                'Content-Security-Policy',
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' https://fonts.googleapis.com; "
                "font-src https://fonts.gstatic.com; "
                "img-src 'self' data:; "
                "connect-src 'self' https://ipapi.co https://freeipapi.com "
                "https://api.openweathermap.org; "
                "frame-ancestors 'self' https://*.replit.dev https://*.replit.co "
                "https://*.replit.com https://replit.com;"
            )
        super().end_headers()

    # ── /afterhours ───────────────────────────────────────────────────────────

    def _handle_afterhours(self):
        # Always serve the shell; JS does the auth check via /api/auth
        self._serve_template('afterhours.html')

    def _handle_afterhours_diary(self):
        # Always serve the shell; JS does the auth check via /api/auth
        self._serve_template('afterhours-diary.html')

    def _serve_template(self, filename):
        filepath = os.path.join(_TEMPLATES, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            # Use self.end_headers() so Cache-Control + CSP are added via override
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    # ── GET /api/auth  (session check) ────────────────────────────────────────

    def _handle_auth_get(self):
        member = self._get_authed_member()
        if member is None:
            self._write_json(401, {'ok': False})
            return
        comment = _get_member_comment(member)
        self._write_json(200, {'ok': True, 'member': member, 'comment': comment})

    # ── POST /api/auth  (login / logout) ──────────────────────────────────────

    def _handle_auth_post(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return

        action = body.get('action')

        if action == 'login':
            given   = str(body.get('password', ''))
            matched = None
            for m in _get_members():
                pw = str(m.get('password', ''))
                g  = given.encode()
                p  = pw.encode() if pw else b'\x00'
                # Always call compare_digest (constant-time); match only if pw
                # non-empty and lengths equal so the digest comparison is valid.
                same_len = bool(pw) and len(g) == len(p)
                is_match = same_len and hmac.compare_digest(g, p)
                if is_match and matched is None:
                    matched = m
                # No break — always iterate all members to avoid timing leaks
            if not matched:
                self._write_json(401, {'ok': False})
                return
            member_name = matched.get('name', '')
            token = _make_token(member_name)
            self._write_json_with_cookie(
                200,
                {'ok': True, 'token': token, 'member': member_name},
                _cookie_header(token)
            )
            return

        if action == 'logout':
            self._write_json_with_cookie(200, {'ok': True}, _cookie_header(None))
            return

        self._write_json(400, {'error': 'Unknown action'})

    # ── Auth shortcut ─────────────────────────────────────────────────────────

    def _get_authed_member(self):
        """Returns member name (str) if authenticated, None otherwise."""
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            result = _verify_token(auth_header[7:])
            if result is not None:
                return result
        cookies = _parse_cookies(self.headers.get('Cookie', ''))
        result = _verify_token(cookies.get(_COOKIE_NAME, ''))
        if result is not None:
            return result
        return None

    def _is_authed(self):
        return self._get_authed_member() is not None

    # ── GET /api/diary ────────────────────────────────────────────────────────

    def _handle_diary_list(self):
        authed = self._is_authed()
        posts  = _load_diary()
        if not authed:
            posts = [p for p in posts if p.get('status') == 'published']
        posts.sort(key=lambda p: p.get('date', ''), reverse=True)
        self._write_json(200, posts)

    # ── GET /api/diary/<id> ───────────────────────────────────────────────────

    def _handle_diary_get(self, item_id):
        authed = self._is_authed()
        posts  = _load_diary()
        post   = next((p for p in posts if p.get('id') == item_id), None)
        if not post:
            self._write_json(404, {'error': 'Not found'})
            return
        if post.get('status') != 'published' and not authed:
            self._write_json(404, {'error': 'Not found'})
            return
        self._write_json(200, post)

    # ── POST /api/diary ───────────────────────────────────────────────────────

    def _handle_diary_create(self):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        now      = time.strftime('%Y-%m-%dT%H:%M:%S')
        status   = body.get('status', 'draft')
        if status not in ('published', 'draft'):
            status = 'draft'
        raw_date = str(body.get('date', ''))
        if raw_date and not _DATE_RE.match(raw_date):
            self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
            return
        post = {
            'id':        str(_uuid_mod.uuid4()),
            'title':     str(body.get('title', '')).strip(),
            'body':      str(body.get('body',  '')).strip(),
            'date':      _valid_date(raw_date),
            'status':    status,
            'createdAt': now,
            'updatedAt': now,
        }
        posts = _load_diary()
        posts.insert(0, post)
        _save_diary(posts)
        self._write_json(201, post)

    # ── PUT /api/diary/<id> ───────────────────────────────────────────────────

    def _handle_diary_update(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        posts = _load_diary()
        idx   = next((i for i, p in enumerate(posts) if p.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        prev   = posts[idx]
        status = body.get('status', prev.get('status', 'draft'))
        if status not in ('published', 'draft'):
            status = prev.get('status', 'draft')
        if 'date' in body:
            raw_date = str(body['date'])
            if not _DATE_RE.match(raw_date):
                self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
                return
        updated = {
            **prev,
            'title':     str(body['title']).strip()  if 'title' in body else prev.get('title', ''),
            'body':      str(body['body']).strip()   if 'body'  in body else prev.get('body',  ''),
            'date':      body['date']                if 'date'  in body else prev.get('date',  _today_iso()),
            'status':    status,
            'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        posts[idx] = updated
        _save_diary(posts)
        self._write_json(200, updated)

    # ── DELETE /api/diary/<id> ────────────────────────────────────────────────

    def _handle_diary_delete(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        posts = _load_diary()
        idx   = next((i for i, p in enumerate(posts) if p.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        posts.pop(idx)
        _save_diary(posts)
        self._write_json(200, {'ok': True})

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return None

    def _write_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    def _write_json_with_cookie(self, status, payload, cookie):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Set-Cookie', cookie)
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    # ── Weather ───────────────────────────────────────────────────────────────

    def _handle_weather(self):
        t_total = time.monotonic()
        parsed  = urllib.parse.urlparse(self.path)
        params  = urllib.parse.parse_qs(parsed.query)
        lat_raw = params.get('lat', [None])[0]
        lon_raw = params.get('lon', [None])[0]
        api_key = os.environ.get('OPENWEATHERMAP_API_KEY', '')

        lat = lon = None

        if lat_raw and lon_raw:
            try:
                lat = float(lat_raw)
                lon = float(lon_raw)
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError('out of bounds')
                print('[weather/coords] explicit lat=%s lon=%s' % (lat, lon))
            except (TypeError, ValueError):
                self._write_json(400, {'condition': None})
                return
        else:
            forwarded = self.headers.get('X-Forwarded-For', '')
            ip = forwarded.split(',')[0].strip() if forwarded else self.client_address[0]
            t_geo  = time.monotonic()
            geo_ok = False

            try:
                path = ip if ip else 'json'
                with urllib.request.urlopen('https://ipapi.co/%s/json/' % path, timeout=3) as resp:
                    geo = json.loads(resp.read())
                if geo.get('latitude') is not None and geo.get('longitude') is not None and not geo.get('error'):
                    lat    = geo['latitude']
                    lon    = geo['longitude']
                    geo_ok = True
                    print('[weather/geo]   %dms  ipapi.co lat=%s lon=%s' % (int((time.monotonic()-t_geo)*1000), lat, lon))
                else:
                    print('[weather/geo]   ipapi.co no coords: %s' % geo.get('reason', '?'))
            except Exception as e:
                print('[weather/geo]   ipapi.co error: %s' % e)

            if not geo_ok:
                try:
                    url2 = 'https://freeipapi.com/api/json/%s' % (ip or '')
                    with urllib.request.urlopen(url2, timeout=3) as resp:
                        geo2 = json.loads(resp.read())
                    if geo2.get('latitude') is not None and geo2.get('longitude') is not None:
                        lat    = geo2['latitude']
                        lon    = geo2['longitude']
                        geo_ok = True
                        print('[weather/geo]   %dms  freeipapi lat=%s lon=%s' % (int((time.monotonic()-t_geo)*1000), lat, lon))
                    else:
                        print('[weather/geo]   freeipapi.com no coords')
                except Exception as e:
                    print('[weather/geo]   freeipapi.com error: %s' % e)

            if not geo_ok:
                print('[weather/geo]   both services failed')
                self._write_json(200, {'condition': None})
                return

        condition = None
        if api_key:
            t_owm = time.monotonic()
            try:
                qs  = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'appid': api_key})
                url = 'https://api.openweathermap.org/data/2.5/weather?' + qs
                with urllib.request.urlopen(url, timeout=5) as resp:
                    data = json.loads(resp.read())
                condition = data['weather'][0]['main']
                print('[weather/owm]   %dms  condition=%s' % (int((time.monotonic()-t_owm)*1000), condition))
            except Exception as e:
                print('[weather/owm]   %dms  error: %s' % (int((time.monotonic()-t_owm)*1000), e))

        print('[weather/total] %dms' % int((time.monotonic()-t_total)*1000))
        self._write_json(200, {'condition': condition})

    def log_message(self, format, *args):
        print(format % args)


if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
