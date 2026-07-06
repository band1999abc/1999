#!/usr/bin/env python3
import http.server
import os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split('?')[0]
        if path.endswith('.html') or path == '/' or not os.path.splitext(path)[1]:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        print(format % args)

if __name__ == '__main__':
    server = http.server.HTTPServer(('0.0.0.0', 5000), NoCacheHandler)
    print('Serving on http://0.0.0.0:5000')
    server.serve_forever()
