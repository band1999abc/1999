#!/usr/bin/env python3
import http.server
import urllib.request
import urllib.parse
import json
import os

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
        """Proxy to OpenWeatherMap; returns {"condition": "<Main>"} or {"condition": null}."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        lat = params.get('lat', [None])[0]
        lon = params.get('lon', [None])[0]
        api_key = os.environ.get('OPENWEATHERMAP_API_KEY', '')

        condition = None
        if lat and lon and api_key:
            try:
                url = (
                    'https://api.openweathermap.org/data/2.5/weather'
                    '?lat=' + lat + '&lon=' + lon + '&appid=' + api_key
                )
                with urllib.request.urlopen(url, timeout=5) as resp:
                    data = json.loads(resp.read())
                condition = data['weather'][0]['main']
            except Exception:
                pass  # Network error or bad response → silent fallback

        body = json.dumps({'condition': condition}).encode()
        self.send_response(200)
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
