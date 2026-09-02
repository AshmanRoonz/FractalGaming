#!/usr/bin/env python3
"""Meshy AI client for the LSS asset pipeline (stdlib only).

The key is read from the MESHY_API_KEY environment variable, or from tools/meshy/.key
(gitignored). It is never printed and never written anywhere else.

    python tools/meshy/meshy.py balance
    python tools/meshy/meshy.py t2m  <slug> "<prompt>" [--refine] [--pbr] [--poly 60000] [--quad]
                                     [--model meshy-7] [--ultra] [--tex-prompt "..."] [--tex-res 2k]
    python tools/meshy/meshy.py i2m  <slug> <image.png|url> [--pbr] [--poly 60000] [--quad]
                                     [--model meshy-7] [--tex-prompt "..."] [--tex-res 2k]
    python tools/meshy/meshy.py retex <slug> <model.glb|task-id> "<style prompt>" [--pbr] [--keep-uv]
    python tools/meshy/meshy.py status <kind> <task-id>          # kind = t2m | i2m | retex
    python tools/meshy/meshy.py wait   <kind> <task-id> <slug>   # poll, then download
    python tools/meshy/meshy.py download <kind> <task-id> <slug>
    python tools/meshy/meshy.py list   <kind> [n]

Every task's JSON, thumbnail, GLB and texture maps land in
assets_base/cockpits/candidates/<slug>/ (gitignored until a candidate is chosen).
Credits (docs, 2026-09): text-to-3D preview 20 (40 ultra), refine varies with texture
resolution; image-to-3D 30 (+10 with a texture prompt/image). Failed tasks refund.
"""
import base64
import codecs
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.join(ROOT, 'assets_base', 'cockpits', 'candidates')
BASE = 'https://api.meshy.ai'
KIND_PATH = {'t2m': '/openapi/v2/text-to-3d', 'i2m': '/openapi/v1/image-to-3d', 'retex': '/openapi/v1/retexture'}


def api_key():
    k = os.environ.get('MESHY_API_KEY', '').strip()
    if not k:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.key')
        if os.path.exists(p):
            raw = open(p, 'rb').read()
            # PowerShell's `echo >` writes UTF-16 with a BOM; accept that, UTF-8 with BOM, and plain
            if raw[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE):
                k = raw.decode('utf-16').strip()
            else:
                k = raw.decode('utf-8-sig').strip()
    if not k:
        sys.exit('no Meshy key: set MESHY_API_KEY or write it to tools/meshy/.key (gitignored)')
    return k


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Authorization', 'Bearer ' + api_key())
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=120) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        msg = e.read().decode('utf-8', 'replace')
        sys.exit(f'HTTP {e.code} on {method} {path}: {msg[:600]}')


def data_uri(path_or_url):
    if path_or_url.startswith('http://') or path_or_url.startswith('https://') or path_or_url.startswith('data:'):
        return path_or_url
    mime = mimetypes.guess_type(path_or_url)[0] or 'application/octet-stream'
    with open(path_or_url, 'rb') as f:
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode('ascii')


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            v = args[i + 1]
            del args[i:i + 2]
            return v
    return default


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def fetch_to(url, path):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return os.path.getsize(path)


def download(kind, task_id, slug):
    task = call('GET', f'{KIND_PATH[kind]}/{task_id}')
    if task.get('status') != 'SUCCEEDED':
        sys.exit(f"task {task_id} is {task.get('status')}: {task.get('task_error')}")
    out = os.path.join(OUT_ROOT, slug)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, f'task_{kind}_{task_id}.json'), 'w', encoding='utf-8') as f:
        json.dump(task, f, indent=2)
    got = []
    urls = task.get('model_urls') or {}
    if urls.get('glb'):
        got.append(('model.glb', fetch_to(urls['glb'], os.path.join(out, 'model.glb'))))
    if task.get('thumbnail_url'):
        got.append(('thumbnail.png', fetch_to(task['thumbnail_url'], os.path.join(out, 'thumbnail.png'))))
    for i, tex in enumerate(task.get('texture_urls') or []):
        for name, url in tex.items():
            if url:
                fn = f'tex{i}_{name}.png'
                got.append((fn, fetch_to(url, os.path.join(out, fn))))
    print(f'downloaded to {os.path.relpath(out, ROOT)}: ' + ', '.join(f'{n} ({s // 1024} KB)' for n, s in got))
    print('consumed_credits', task.get('consumed_credits'))
    return task


def wait(kind, task_id, slug=None, every=8):
    last = None
    while True:
        task = call('GET', f'{KIND_PATH[kind]}/{task_id}')
        st, pr = task.get('status'), task.get('progress')
        if (st, pr) != last:
            print(f'  {task_id} {st} {pr}% queue={task.get("preceding_tasks", "")}', flush=True)
            last = (st, pr)
        if st in ('SUCCEEDED', 'FAILED', 'CANCELED'):
            break
        time.sleep(every)
    if st != 'SUCCEEDED':
        sys.exit(f'task ended {st}: {task.get("task_error")}')
    if slug:
        return download(kind, task_id, slug)
    return task


def main(argv):
    if not argv:
        sys.exit(__doc__)
    cmd, args = argv[0], list(argv[1:])
    if cmd == 'balance':
        print(json.dumps(call('GET', '/openapi/v1/balance')))
        return
    if cmd == 'list':
        kind = args[0]
        n = int(args[1]) if len(args) > 1 else 10
        for t in call('GET', f'{KIND_PATH[kind]}?page_size={n}&page_num=1') or []:
            print(t.get('id'), t.get('status'), t.get('type'), (t.get('prompt') or '')[:60], 'credits', t.get('consumed_credits'))
        return
    if cmd == 'status':
        kind, task_id = args[0], args[1]
        t = call('GET', f'{KIND_PATH[kind]}/{task_id}')
        print(json.dumps({k: t.get(k) for k in ('id', 'status', 'progress', 'preceding_tasks', 'consumed_credits', 'task_error')}))
        return
    if cmd == 'wait':
        wait(args[0], args[1], args[2] if len(args) > 2 else None)
        return
    if cmd == 'download':
        download(args[0], args[1], args[2])
        return
    if cmd == 't2m':
        do_refine = flag(args, '--refine')
        pbr = flag(args, '--pbr')
        quad = flag(args, '--quad')
        ultra = flag(args, '--ultra')
        poly = int(opt(args, '--poly', '60000'))
        model = opt(args, '--model', 'latest')
        tex_prompt = opt(args, '--tex-prompt')
        tex_res = opt(args, '--tex-res', '2k')
        slug, prompt = args[0], args[1]
        body = {'mode': 'preview', 'prompt': prompt, 'ai_model': model, 'should_remesh': True,
                'topology': 'quad' if quad else 'triangle', 'target_polycount': poly, 'target_formats': ['glb'],
                'ultra_mode': ultra}
        pid = call('POST', KIND_PATH['t2m'], body)['result']
        print('preview task', pid)
        task = wait('t2m', pid, slug if not do_refine else None)
        if not do_refine:
            return
        rb = {'mode': 'refine', 'preview_task_id': pid, 'enable_pbr': pbr, 'texture_resolution': tex_res,
              'ai_model': model, 'target_formats': ['glb']}
        if tex_prompt:
            rb['texture_prompt'] = tex_prompt
        rid = call('POST', KIND_PATH['t2m'], rb)['result']
        print('refine task', rid)
        wait('t2m', rid, slug)
        return
    if cmd == 'i2m':
        pbr = flag(args, '--pbr')
        quad = flag(args, '--quad')
        poly = int(opt(args, '--poly', '60000'))
        model = opt(args, '--model', 'latest')
        tex_prompt = opt(args, '--tex-prompt')
        tex_res = opt(args, '--tex-res', '2k')
        slug, image = args[0], args[1]
        body = {'image_url': data_uri(image), 'ai_model': model, 'should_texture': True, 'enable_pbr': pbr,
                'texture_resolution': tex_res, 'should_remesh': True, 'topology': 'quad' if quad else 'triangle',
                'target_polycount': poly, 'target_formats': ['glb']}
        if tex_prompt:
            body['texture_prompt'] = tex_prompt
        tid = call('POST', KIND_PATH['i2m'], body)['result']
        print('image-to-3d task', tid)
        wait('i2m', tid, slug)
        return
    if cmd == 'retex':
        pbr = flag(args, '--pbr')
        keep_uv = flag(args, '--keep-uv')
        tex_res = opt(args, '--tex-res', '2k')
        model = opt(args, '--model', 'latest')
        slug, src, style = args[0], args[1], args[2]
        body = {'text_style_prompt': style, 'enable_pbr': pbr, 'enable_original_uv': keep_uv,
                'texture_resolution': tex_res, 'ai_model': model, 'target_formats': ['glb']}
        if os.path.exists(src) or src.startswith('http'):
            body['model_url'] = data_uri(src)
        else:
            body['input_task_id'] = src
        tid = call('POST', KIND_PATH['retex'], body)['result']
        print('retexture task', tid)
        wait('retex', tid, slug)
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
