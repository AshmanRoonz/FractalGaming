"""Serve the repo for tools/glb_editor.html and accept its "Save to pipeline" posts.

    python tools/glb_editor_server.py            # then open http://localhost:8098/tools/glb_editor.html
    python tools/glb_editor_server.py 9000       # another port

GET  serves files relative to the repo root (so ?load=/LSS/ships_original/Pyro.glb works).
POST /save-marks?name=<ship>_glass.json  writes the body into tools/blender/marks/.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MARKS = os.path.join(REPO, 'tools', 'blender', 'marks')


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=REPO, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/save-marks':
            self.send_error(404)
            return
        name = os.path.basename(parse_qs(u.query).get('name', ['marks.json'])[0])
        if not name.endswith('.json'):
            name += '.json'
        n = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(n)
        os.makedirs(MARKS, exist_ok=True)
        path = os.path.join(MARKS, name)
        with open(path, 'wb') as fh:
            fh.write(body)
        msg = f'{os.path.relpath(path, REPO)} ({len(body)} bytes)'
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(msg.encode())
        print('saved', msg)

    def log_message(self, fmt, *args):
        if '/save-marks' in (args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8098
    print(f'glb editor server: http://localhost:{port}/tools/glb_editor.html   (marks -> {os.path.relpath(MARKS, REPO)})')
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
