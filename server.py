#!/usr/bin/env python3
"""
Development server for Replit.

Routes
------
GET  /api/weather      — IP-geolocated weather condition
GET  /api/auth         — session check  → {"ok": bool}
POST /api/auth         — login / logout → {"ok": bool}
GET  /afterhours       — admin gate: session valid → afterhours.html
                                     else          → login.html
GET  *                 — static files via SimpleHTTPRequestHandler
"""

import base64
import hashlib
import hmac
import http.server
import json
import os
import time
import urllib.parse
import urllib.request

# ── Auth helpers ──────────────────────────────────────────────────────────────

_COOKIE_NAME = 'admin_session'
_MAX_AGE     = 7 * 24 * 3600          # 7 days in seconds
_TEMPLATES   = os.path.join(os.path.dirname(__file__), 'templates')


def _make_token():
    exp     = time.time() + _MAX_AGE
    payload = base64.urlsafe_b64encode(
        json.dumps({'exp': exp}).encode()
    ).decode().rstrip('=')
    secret  = os.environ.get('SESSION_SECRET', '')
    sig     = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}.{sig}'


def _verify_token(token):
    try:
        dot = token.rfind('.')
        if dot < 1:
            return False
        payload  = token[:dot]
        sig      = token[dot + 1:]
        secret   = os.environ.get('SESSION_SECRET', '')
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        padded = payload + '=' * (-len(payload) % 4)
        data   = json.loads(base64.urlsafe_b64decode(padded))
        return time.time() < data['exp']
    except Exception:
        return False


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


# ── Request handler ───────────────────────────────────────────────────────────

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):

    # ── Routing ───────────────────────────────────────────────────────────────

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/')
        if self.path.startswith('/api/weather'):
            self._handle_weather()
        elif path == '/api/auth':
            self._handle_auth_get()
        elif path == '/afterhours':
            self._handle_afterhours()
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/auth':
            self._handle_auth_post()
        else:
            self.send_error(404)

    # ── No-cache headers for HTML ─────────────────────────────────────────────

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path in ('/', '') or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    # ── /afterhours ───────────────────────────────────────────────────────────

    def _handle_afterhours(self):
        cookies  = _parse_cookies(self.headers.get('Cookie', ''))
        token    = cookies.get(_COOKIE_NAME, '')
        filename = 'afterhours.html' if _verify_token(token) else 'login.html'
        self._serve_template(filename)

    def _serve_template(self, filename):
        filepath = os.path.join(_TEMPLATES, filename)
        try:
            with open(filepath, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            http.server.BaseHTTPRequestHandler.end_headers(self)
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_error(404)

    # ── GET /api/auth  (session check) ────────────────────────────────────────

    def _handle_auth_get(self):
        cookies = _parse_cookies(self.headers.get('Cookie', ''))
        token   = cookies.get(_COOKIE_NAME, '')
        ok      = _verify_token(token)
        self._write_json(200 if ok else 401, {'ok': ok})

    # ── POST /api/auth  (login / logout) ──────────────────────────────────────

    def _handle_auth_post(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            body   = json.loads(self.rfile.read(length))
        except Exception:
            self._write_json(400, {'error': 'Bad request'})
            return

        action = body.get('action')

        # — login —
        if action == 'login':
            admin_pw = os.environ.get('ADMIN_PASSWORD', '')
            given    = str(body.get('password', ''))
            a        = given.encode()
            b        = admin_pw.encode()
            ok       = (len(admin_pw) > 0 and
                        len(a) == len(b) and
                        hmac.compare_digest(a, b))
            if not ok:
                self._write_json(401, {'ok': False})
                return
            token = _make_token()
            self._write_json_with_cookie(200, {'ok': True}, _cookie_header(token))
            return

        # — logout —
        if action == 'logout':
            self._write_json_with_cookie(200, {'ok': True}, _cookie_header(None))
            return

        self._write_json(400, {'error': 'Unknown action'})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _write_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    def _write_json_with_cookie(self, status, payload, cookie):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Set-Cookie', cookie)
        self.send_header('Cache-Control', 'no-store')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    # ── Weather ───────────────────────────────────────────────────────────────

    def _handle_weather(self):
        """Resolve weather condition; returns {"condition": "<Main>"} or {"condition": null}."""
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

            # Primary: ipapi.co
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

            # Fallback: freeipapi.com
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

        # OpenWeatherMap
        condition = None
        if api_key:
            t_owm = time.monotonic()
            try:
                qs  = urllib.parse.urlencode({'lat': lat, 'lon': lon, 'appid': api_key})
                url = 'https://api.openweathermap.org/data/2.5/weather?' + qs
                with urllib.request.urlopen(url, timeout=5) as resp:
                    data = json.loads(resp.read())
                condition = data['weather'][0]['main']
                owm_ms    = int((time.monotonic() - t_owm) * 1000)
                print('[weather/owm]   %dms  condition=%s' % (owm_ms, condition))
            except Exception as e:
                owm_ms = int((time.monotonic() - t_owm) * 1000)
                print('[weather/owm]   %dms  error: %s' % (owm_ms, e))

        total_ms = int((time.monotonic() - t_total) * 1000)
        print('[weather/total] %dms' % total_ms)
        self._write_json(200, {'condition': condition})

    def log_message(self, format, *args):
        print(format % args)


if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
