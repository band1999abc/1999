#!/usr/bin/env python3
"""
Development server for Replit.

Routes
------
GET  /api/analytics        — query events by date range (auth required)
POST /api/analytics        — collect analytics event (no auth)
GET  /api/weather          — IP-geolocated weather condition
GET  /api/auth             — session check  → {"ok": bool}
POST /api/auth             — login / logout → {"ok": bool}
GET  /api/diary            — list posts (auth → all; unauth → published only)
POST /api/diary            — create post (auth required)
GET  /api/diary/<id>       — get single post
PUT  /api/diary/<id>       — update post (auth required)
DELETE /api/diary/<id>     — delete post (auth required)
GET  /api/live             — list lives (auth → all; unauth → published only)
POST /api/live             — create live (auth required)
GET  /api/live/<id>        — get single live
PUT  /api/live/<id>        — update live (auth required)
DELETE /api/live/<id>      — delete live (auth required)
GET  /afterhours           — admin dashboard → afterhours.html
GET  /afterhours/diary     — diary admin → afterhours-diary.html
GET  /afterhours/live      — live admin  → afterhours-live.html
GET  /afterhours/login     — login page  → login.html
GET  *                     — static files via SimpleHTTPRequestHandler
"""

import base64
import datetime
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
                return arr
        except json.JSONDecodeError:
            pass
    pw = os.environ.get('ADMIN_PASSWORD', '')
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

_DATE_RE     = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_SCHED_AT_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$')


def _today_iso():
    return time.strftime('%Y-%m-%d')


def _now_jst():
    """Return current Japan time as 'YYYY-MM-DDTHH:MM' (JST = UTC+9)."""
    utc_ts = time.time() + 9 * 3600
    t = time.gmtime(utc_ts)
    return time.strftime('%Y-%m-%dT%H:%M', t)


def _valid_date(s):
    """Return s if it matches YYYY-MM-DD, else return today's date."""
    return s if (s and _DATE_RE.match(s)) else _today_iso()


def _auto_promote_scheduled(posts):
    """Promote 'scheduled' posts whose scheduledAt has passed (JST). Returns changed flag."""
    now_jst = _now_jst()
    changed = False
    for p in posts:
        if p.get('status') == 'scheduled':
            sched = p.get('scheduledAt', '')
            if sched and sched <= now_jst:
                p['status'] = 'published'
                p['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
                changed = True
    return changed


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


# ── Live storage helpers ──────────────────────────────────────────────────────

_TIME_RE = re.compile(r'^\d{1,2}:\d{2}$')


def _valid_time(s):
    """Return s if it looks like H:MM or HH:MM, else empty string."""
    return s if (s and _TIME_RE.match(s)) else ''


def _load_lives():
    path = os.path.join(_DATA_DIR, 'lives.json')
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        return data
    except (json.JSONDecodeError, OSError) as e:
        print(f'[live] WARNING: could not load lives.json: {e}')
        return []


def _save_lives(lives):
    os.makedirs(_DATA_DIR, exist_ok=True)
    path = os.path.join(_DATA_DIR, 'lives.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(lives, f, ensure_ascii=False, indent=2)


# ── Request handler ───────────────────────────────────────────────────────────

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):

    # ── Routing ───────────────────────────────────────────────────────────────

    def send_error(self, code, message=None, explain=None):
        """404 は custom 404.html を返す。それ以外はデフォルト動作。"""
        if code == 404:
            filepath = os.path.join(_ROOT, '404.html')
            try:
                with open(filepath, 'rb') as f:
                    body = f.read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.end_headers()
                self.wfile.write(body)
                return
            except FileNotFoundError:
                pass
        super().send_error(code, message, explain)

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/')
        if self.path.startswith('/api/weather'):
            self._handle_weather()
        elif path == '/api/auth':
            self._handle_auth_get()
        elif path == '/afterhours/analytics':
            self._serve_template('afterhours-analytics.html')
        elif path == '/afterhours/diary':
            self._handle_afterhours_diary()
        elif path == '/afterhours/live':
            self._serve_template('afterhours-live.html')
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
        elif path == '/api/live':
            self._handle_live_list()
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_get(item_id)
            else:
                self.send_error(404)
        elif path == '/api/analytics':
            self._handle_analytics_read()
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                parsed_qs = urllib.parse.urlparse(self.path)
                qs_params = urllib.parse.parse_qs(parsed_qs.query)
                slot_id   = qs_params.get('s', [None])[0]
                self._handle_flyer_get(item_id, slot_id)
            else:
                self.send_error(404)
        elif path == '/sw.js':
            # Service worker must never be cached by HTTP cache
            self._serve_static_nocache('sw.js', 'application/javascript')
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/auth':
            self._handle_auth_post()
        elif path == '/api/diary':
            self._handle_diary_create()
        elif path == '/api/live':
            self._handle_live_create()
        elif path == '/api/analytics':
            self._handle_analytics_track()
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                self._handle_flyer_post(item_id)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_PUT(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_update(item_id)
                return
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_update(item_id)
                return
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                self._handle_flyer_put(item_id)
                return
        self.send_error(404)

    def do_DELETE(self):
        path = self.path.split('?')[0].rstrip('/')
        if path.startswith('/api/diary/'):
            item_id = path[len('/api/diary/'):]
            if item_id and '/' not in item_id:
                self._handle_diary_delete(item_id)
                return
        elif path.startswith('/api/live/'):
            item_id = path[len('/api/live/'):]
            if item_id and '/' not in item_id:
                self._handle_live_delete(item_id)
                return
        elif path.startswith('/api/flyer/'):
            item_id = path[len('/api/flyer/'):]
            if item_id and '/' not in item_id:
                parsed_qs = urllib.parse.urlparse(self.path)
                qs_params = urllib.parse.parse_qs(parsed_qs.query)
                slot_id   = qs_params.get('s', [None])[0]
                self._handle_flyer_delete(item_id, slot_id)
                return
        self.send_error(404)

    # ── No-cache headers for HTML ─────────────────────────────────────────────

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path in ('/', '') or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
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
        self._serve_template('afterhours.html')

    def _handle_afterhours_diary(self):
        self._serve_template('afterhours-diary.html')

    def _serve_static_nocache(self, filename, content_type):
        filepath = os.path.join(_ROOT, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Service-Worker-Allowed', '/')
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    def _serve_template(self, filename):
        filepath = os.path.join(_TEMPLATES, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
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
                same_len = bool(pw) and len(g) == len(p)
                is_match = same_len and hmac.compare_digest(g, p)
                if is_match and matched is None:
                    matched = m
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
        if _auto_promote_scheduled(posts):
            _save_diary(posts)
        if not authed:
            posts = [p for p in posts if p.get('status') == 'published']
        posts.sort(
            key=lambda p: (p.get('date', ''), p.get('scheduledAt', '')),
            reverse=True
        )
        self._write_json(200, posts)

    # ── GET /api/diary/<id> ───────────────────────────────────────────────────

    def _handle_diary_get(self, item_id):
        authed = self._is_authed()
        posts  = _load_diary()
        if _auto_promote_scheduled(posts):
            _save_diary(posts)
        post = next((p for p in posts if p.get('id') == item_id), None)
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
        now    = time.strftime('%Y-%m-%dT%H:%M:%S')
        status = body.get('status', 'draft')
        if status not in ('published', 'draft', 'scheduled'):
            status = 'draft'
        raw_date = str(body.get('date', ''))
        if raw_date and not _DATE_RE.match(raw_date):
            self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
            return
        raw_sched = str(body.get('scheduledAt', '')).strip()
        if status == 'scheduled':
            if not raw_sched or not _SCHED_AT_RE.match(raw_sched):
                self._write_json(400, {'error': 'scheduledAt required (YYYY-MM-DDTHH:MM)'})
                return
        else:
            raw_sched = ''
        post = {
            'id':          str(_uuid_mod.uuid4()),
            'title':       str(body.get('title', '')).strip(),
            'body':        str(body.get('body',  '')).strip(),
            'date':        _valid_date(raw_date),
            'status':      status,
            'scheduledAt': raw_sched,
            'createdAt':   now,
            'updatedAt':   now,
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
        if status not in ('published', 'draft', 'scheduled'):
            status = prev.get('status', 'draft')
        if 'date' in body:
            raw_date = str(body['date'])
            if not _DATE_RE.match(raw_date):
                self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
                return
        raw_sched = str(body['scheduledAt']).strip() if 'scheduledAt' in body \
                    else prev.get('scheduledAt', '')
        if status == 'scheduled':
            if not raw_sched or not _SCHED_AT_RE.match(raw_sched):
                self._write_json(400, {'error': 'scheduledAt required (YYYY-MM-DDTHH:MM)'})
                return
        else:
            raw_sched = ''
        updated = {
            **prev,
            'title':       str(body['title']).strip()  if 'title' in body else prev.get('title', ''),
            'body':        str(body['body']).strip()   if 'body'  in body else prev.get('body',  ''),
            'date':        body['date']                if 'date'  in body else prev.get('date',  _today_iso()),
            'status':      status,
            'scheduledAt': raw_sched,
            'updatedAt':   time.strftime('%Y-%m-%dT%H:%M:%S'),
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

    # ── GET /api/live ─────────────────────────────────────────────────────────

    def _handle_live_list(self):
        authed = self._is_authed()
        lives  = _load_lives()
        if not authed:
            lives = [l for l in lives if l.get('status') == 'published']
        self._write_json(200, lives)

    # ── GET /api/live/<id> ────────────────────────────────────────────────────

    def _handle_live_get(self, item_id):
        authed = self._is_authed()
        lives  = _load_lives()
        live   = next((l for l in lives if l.get('id') == item_id), None)
        if not live:
            self._write_json(404, {'error': 'Not found'})
            return
        if live.get('status') != 'published' and not authed:
            self._write_json(404, {'error': 'Not found'})
            return
        self._write_json(200, live)

    # ── POST /api/live ────────────────────────────────────────────────────────

    def _handle_live_create(self):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        now    = time.strftime('%Y-%m-%dT%H:%M:%S')
        status = body.get('status', 'draft')
        if status not in ('published', 'draft'):
            status = 'draft'
        raw_date = str(body.get('date', ''))
        if raw_date and not _DATE_RE.match(raw_date):
            self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
            return
        lives = _load_lives()
        # Default sort_order: one higher than current max
        max_order = max((l.get('sort_order', 0) for l in lives), default=-1)
        raw_order = body.get('sort_order', max_order + 1)
        try:
            sort_order = int(raw_order)
        except (TypeError, ValueError):
            self._write_json(400, {'error': 'sort_order must be an integer'})
            return
        live = {
            'id':         str(_uuid_mod.uuid4()),
            'date':       _valid_date(raw_date),
            'venue':      str(body.get('venue',  '')).strip(),
            'open':       _valid_time(str(body.get('open',  '')).strip()),
            'start':      _valid_time(str(body.get('start', '')).strip()),
            'ticket':     str(body.get('ticket', '')).strip(),
            'status':     status,
            'sort_order': sort_order,
            'createdAt':  now,
            'updatedAt':  now,
        }
        lives.append(live)
        _save_lives(lives)
        self._write_json(201, live)

    # ── PUT /api/live/<id> ────────────────────────────────────────────────────

    def _handle_live_update(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        body = self._read_json_body()
        if body is None:
            return
        lives = _load_lives()
        idx   = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        prev   = lives[idx]
        status = body.get('status', prev.get('status', 'draft'))
        if status not in ('published', 'draft'):
            status = prev.get('status', 'draft')
        if 'date' in body:
            raw_date = str(body['date'])
            if raw_date and not _DATE_RE.match(raw_date):
                self._write_json(400, {'error': 'Invalid date format; expected YYYY-MM-DD'})
                return
        if 'sort_order' in body:
            try:
                new_order = int(body['sort_order'])
            except (TypeError, ValueError):
                self._write_json(400, {'error': 'sort_order must be an integer'})
                return
        else:
            new_order = prev.get('sort_order', idx)
        updated = {
            **prev,
            'date':       body['date']                               if 'date'   in body else prev.get('date', _today_iso()),
            'venue':      str(body['venue']).strip()                 if 'venue'  in body else prev.get('venue',  ''),
            'open':       _valid_time(str(body['open']).strip())     if 'open'   in body else prev.get('open',   ''),
            'start':      _valid_time(str(body['start']).strip())    if 'start'  in body else prev.get('start',  ''),
            'ticket':     str(body['ticket']).strip()                if 'ticket' in body else prev.get('ticket', ''),
            'status':     status,
            'sort_order': new_order,
            'updatedAt':  time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        lives[idx] = updated
        _save_lives(lives)
        self._write_json(200, updated)

    # ── DELETE /api/live/<id> ─────────────────────────────────────────────────

    def _handle_live_delete(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        lives = _load_lives()
        idx   = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Not found'})
            return
        lives.pop(idx)
        _save_lives(lives)
        self._write_json(200, {'ok': True})


    # -- POST /api/analytics -- collect event ----------------------------

    _ANALYTICS_UUID_RE = re.compile(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)
    _ANALYTICS_EVENTS = frozenset(
        ['page_view', 'music_play', 'diary_view', 'live_view', 'contact_view'])

    def _handle_analytics_track(self):
        """POST /api/analytics -- store one analytics event (no auth required)."""
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Invalid JSON'})
            return

        visitor_id     = str(body.get('visitor_id', '')).strip()
        session_id     = str(body.get('session_id', '')).strip()
        page           = str(body.get('page', '/')).strip()[:300]
        event          = str(body.get('event', '')).strip()
        is_new_visitor = bool(body.get('is_new_visitor', False))
        props          = body.get('props', {})

        if not self._ANALYTICS_UUID_RE.match(visitor_id):
            self._write_json(400, {'error': 'Invalid visitor_id'})
            return
        if not self._ANALYTICS_UUID_RE.match(session_id):
            self._write_json(400, {'error': 'Invalid session_id'})
            return
        if event not in self._ANALYTICS_EVENTS:
            self._write_json(400, {'error': 'Invalid event'})
            return
        if not isinstance(props, dict):
            props = {}

        now      = datetime.datetime.now(datetime.timezone.utc)
        jst_date = (now + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')
        entry    = {
            'id':             str(_uuid_mod.uuid4()),
            'ts':             now.isoformat(),
            'visitor_id':     visitor_id,
            'session_id':     session_id,
            'page':           page,
            'event':          event,
            'is_new_visitor': is_new_visitor,
            'props':          props,
        }

        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        os.makedirs(analytics_dir, exist_ok=True)
        file_path = os.path.join(analytics_dir, jst_date + '.json')

        events = []
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                if isinstance(data, list):
                    events = data
            except Exception:
                pass

        events.append(entry)
        try:
            with open(file_path, 'w', encoding='utf-8') as fh:
                json.dump(events, fh, ensure_ascii=False)
        except Exception:
            self._write_json(500, {'error': 'Storage error'})
            return

        self.send_response(204)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    # -- GET /api/analytics -- query events (admin only) ------------------

    def _handle_analytics_read(self):
        """GET /api/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD -- return events."""
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return

        _DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}')
        today    = (datetime.datetime.now(datetime.timezone.utc)
                    + datetime.timedelta(hours=9)).strftime('%Y-%m-%d')

        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)
        start  = qs.get('start', [today])[0]
        end    = qs.get('end',   [today])[0]
        if not _DATE_RE.fullmatch(start):
            start = today
        if not _DATE_RE.fullmatch(end):
            end = today

        analytics_dir = os.path.join(_DATA_DIR, 'analytics')
        all_events    = []
        cur  = datetime.date.fromisoformat(start)
        last = datetime.date.fromisoformat(end)
        days = 0
        while cur <= last and days < 90:
            fp = os.path.join(analytics_dir, cur.isoformat() + '.json')
            if os.path.exists(fp):
                try:
                    with open(fp, 'r', encoding='utf-8') as fh:
                        data = json.load(fh)
                    if isinstance(data, list):
                        all_events.extend(data)
                except Exception:
                    pass
            cur  += datetime.timedelta(days=1)
            days += 1

        all_events.sort(key=lambda e: e.get('ts', ''))
        self._write_json(200, {
            'start':  start,
            'end':    end,
            'count':  len(all_events),
            'events': all_events,
        })

    # ── Flyer storage helpers ─────────────────────────────────────────────────

    def _normalize_flyer(self, live):
        """Normalise live['flyer'] → list of slot IDs."""
        f = live.get('flyer')
        if not f:
            return []
        if f is True:
            return ['0']
        if isinstance(f, list):
            return f
        return []

    def _read_flyer_slot(self, item_id, slot_id):
        """Read data URL for a slot; falls back to legacy file for slot '0'."""
        for base in ['/tmp', os.getcwd()]:
            p = os.path.join(base, 'data', 'flyers', item_id, slot_id + '.b64')
            if os.path.exists(p):
                try:
                    return open(p, 'r', encoding='utf-8').read().strip()
                except OSError:
                    pass
        if slot_id == '0':
            for base in ['/tmp', os.getcwd()]:
                p = os.path.join(base, 'data', 'flyers', item_id + '.b64')
                if os.path.exists(p):
                    try:
                        return open(p, 'r', encoding='utf-8').read().strip()
                    except OSError:
                        pass
        return None

    def _write_flyer_slot(self, item_id, slot_id, data_url):
        """Write data URL for a slot."""
        for base in [_DATA_DIR, '/tmp']:
            try:
                d = os.path.join(base, 'flyers', item_id)
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, slot_id + '.b64'), 'w', encoding='utf-8') as fh:
                    fh.write(data_url)
                return
            except OSError:
                pass
        raise OSError('Could not write flyer slot %s/%s' % (item_id, slot_id))

    def _delete_flyer_slot(self, item_id, slot_id):
        """Delete data for a slot (including legacy file for slot '0')."""
        for base in [_DATA_DIR, '/tmp']:
            p = os.path.join(base, 'flyers', item_id, slot_id + '.b64')
            try:
                os.remove(p)
            except OSError:
                pass
        if slot_id == '0':
            for base in [_DATA_DIR, '/tmp']:
                p = os.path.join(base, 'flyers', item_id + '.b64')
                try:
                    os.remove(p)
                except OSError:
                    pass

    # ── GET /api/flyer/<id>[?s=SLOT] ─────────────────────────────────────────

    def _handle_flyer_get(self, item_id, slot_id=None):
        import base64 as _b64
        lives = _load_lives()
        live  = next((l for l in lives if l.get('id') == item_id), None)
        if not live:
            self.send_error(404)
            return
        if live.get('status') != 'published' and not self._is_authed():
            self.send_error(404)
            return

        images = self._normalize_flyer(live)
        if not images:
            self.send_error(404)
            return

        target_slot = slot_id if slot_id else images[0]
        if target_slot not in images:
            self.send_error(404)
            return

        flyer_data = self._read_flyer_slot(item_id, target_slot)
        if not flyer_data:
            self.send_error(404)
            return

        try:
            sep = ';base64,'
            if not flyer_data.startswith('data:') or sep not in flyer_data:
                self.send_error(500)
                return
            header, b64data = flyer_data.split(sep, 1)
            mime_type = header[len('data:'):]
            img_data  = _b64.b64decode(b64data)
            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(img_data)))
            self.send_header('Cache-Control', 'public, max-age=86400')
            http.server.BaseHTTPRequestHandler.end_headers(self)
            self.wfile.write(img_data)
        except Exception as e:
            print('[flyer] GET error: %s' % e)
            self.send_error(500)

    # ── POST /api/flyer/<id> — add new image ──────────────────────────────────

    def _handle_flyer_post(self, item_id):
        import random
        import string as _string
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        length = int(self.headers.get('Content-Length', 0))
        if length > 6 * 1024 * 1024:
            self._write_json(413, {'error': 'Image too large (max ~4 MB)'})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return
        data_url = body.get('dataUrl', '')
        if not isinstance(data_url, str) or not data_url.startswith('data:image/'):
            self._write_json(400, {'error': 'Invalid image dataUrl'})
            return
        if ';base64,' not in data_url:
            self._write_json(400, {'error': 'dataUrl must be base64 encoded'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        current_images = self._normalize_flyer(lives[idx])
        if len(current_images) >= 20:
            self._write_json(400, {'error': '画像は最大20枚までです'})
            return
        slot_id = ''.join(random.choices(_string.ascii_lowercase + _string.digits, k=6))
        try:
            self._write_flyer_slot(item_id, slot_id, data_url)
        except OSError as e:
            print('[flyer] POST write error: %s' % e)
            self._write_json(500, {'error': 'Failed to save image'})
            return
        new_images = current_images + [slot_id]
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'slotId': slot_id, 'images': new_images})

    # ── PUT /api/flyer/<id> — backward compat: set slot '0' ──────────────────

    def _handle_flyer_put(self, item_id):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        length = int(self.headers.get('Content-Length', 0))
        if length > 6 * 1024 * 1024:
            self._write_json(413, {'error': 'Image too large (max ~4 MB)'})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return
        data_url = body.get('dataUrl', '')
        if not isinstance(data_url, str) or not data_url.startswith('data:image/'):
            self._write_json(400, {'error': 'Invalid image dataUrl'})
            return
        if ';base64,' not in data_url:
            self._write_json(400, {'error': 'dataUrl must be base64 encoded'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        try:
            self._write_flyer_slot(item_id, '0', data_url)
        except OSError as e:
            print('[flyer] PUT write error: %s' % e)
            self._write_json(500, {'error': 'Failed to save flyer'})
            return
        current_images = self._normalize_flyer(lives[idx])
        new_images = current_images if '0' in current_images else ['0'] + current_images
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'images': new_images})

    # ── DELETE /api/flyer/<id>[?s=SLOT] ──────────────────────────────────────

    def _handle_flyer_delete(self, item_id, slot_id=None):
        if not self._is_authed():
            self._write_json(401, {'error': 'Unauthorized'})
            return
        lives = _load_lives()
        idx = next((i for i, l in enumerate(lives) if l.get('id') == item_id), -1)
        if idx < 0:
            self._write_json(404, {'error': 'Live not found'})
            return
        current_images = self._normalize_flyer(lives[idx])
        if slot_id:
            if slot_id not in current_images:
                self._write_json(404, {'error': 'Slot not found'})
                return
            self._delete_flyer_slot(item_id, slot_id)
            new_images = [s for s in current_images if s != slot_id]
        else:
            # Delete ALL slots
            for s in current_images:
                self._delete_flyer_slot(item_id, s)
            # Also clean up any legacy file
            for base in [_DATA_DIR, '/tmp']:
                p = os.path.join(base, 'flyers', item_id + '.b64')
                try:
                    os.remove(p)
                except OSError:
                    pass
            new_images = []
        lives[idx] = dict(lives[idx], flyer=new_images,
                          updatedAt=time.strftime('%Y-%m-%dT%H:%M:%S'))
        _save_lives(lives)
        self._write_json(200, {'ok': True, 'images': new_images})

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
                qs  = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'appid': api_key, 'units': 'metric'})
                url = 'https://api.openweathermap.org/data/2.5/weather?' + qs
                with urllib.request.urlopen(url, timeout=5) as resp:
                    data = json.loads(resp.read())
                condition = data['weather'][0]['main']
                temp_c = data.get('main', {}).get('temp')  # °C (units=metric)
                print('[weather/owm]   %dms  condition=%s temp=%.1f' % (int((time.monotonic()-t_owm)*1000), condition, temp_c if temp_c is not None else 0))
            except Exception as e:
                print('[weather/owm]   %dms  error: %s' % (int((time.monotonic()-t_owm)*1000), e))

        print('[weather/total] %dms' % int((time.monotonic()-t_total)*1000))
        self._write_json(200, {'condition': condition, 'temp': temp_c})

    def log_message(self, format, *args):
        print(format % args)


if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
