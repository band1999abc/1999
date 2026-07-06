#!/usr/bin/env python3
"""
Development server for Replit.
Mirrors the Vercel Function logic: resolves weather from client IP when
lat/lon are not supplied.  Timing is printed to stdout for each stage.
"""
import http.server
import urllib.request
import urllib.parse
import json
import os
import time

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path.startswith('/api/weather'):
            self._handle_weather()
        else:
            super().do_GET()

    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path == '/' or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

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
            # Explicit coords (debug / backwards-compat)
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
            # IP-based geolocation
            forwarded = self.headers.get('X-Forwarded-For', '')
            ip = forwarded.split(',')[0].strip() if forwarded else self.client_address[0]
            t_geo = time.monotonic()
            geo_ok = False

            # Primary: ipapi.co
            try:
                path = ip if ip else 'json'
                with urllib.request.urlopen('https://ipapi.co/%s/json/' % path, timeout=3) as resp:
                    geo = json.loads(resp.read())
                if geo.get('latitude') is not None and geo.get('longitude') is not None and not geo.get('error'):
                    lat = geo['latitude']
                    lon = geo['longitude']
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
                        lat = geo2['latitude']
                        lon = geo2['longitude']
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
                owm_ms = int((time.monotonic() - t_owm) * 1000)
                print('[weather/owm]   %dms  condition=%s' % (owm_ms, condition))
            except Exception as e:
                owm_ms = int((time.monotonic() - t_owm) * 1000)
                print('[weather/owm]   %dms  error: %s' % (owm_ms, e))

        total_ms = int((time.monotonic() - t_total) * 1000)
        print('[weather/total] %dms' % total_ms)
        self._write_json(200, {'condition': condition})

    def _write_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        http.server.BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(format % args)

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
