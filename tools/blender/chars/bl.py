"""Tiny client for the Blender Lab MCP extension on 127.0.0.1:9876.
usage: python bl.py script.py [k=v ...]   (the script must assign a dict to `result`; ARGS dict is injected)"""
import socket, json, sys
code = open(sys.argv[1], encoding='utf-8').read()
args = dict(a.split('=', 1) for a in sys.argv[2:])
code = 'ARGS = ' + repr(args) + '\n' + code
s = socket.create_connection(('127.0.0.1', 9876), timeout=1800)
s.sendall((json.dumps({"type": "execute", "code": code, "strict_json": False}) + "\0").encode())
buf = b''
while not buf.endswith(b'\0'):
    d = s.recv(1 << 20)
    if not d: break
    buf += d
r = json.loads(buf.rstrip(b'\0').decode('utf-8', 'replace'))
if r.get('stdout'): print(r['stdout'])
r.pop('stdout', None)
print(json.dumps(r, indent=1)[:20000])
