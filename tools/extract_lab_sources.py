# -*- coding: utf-8 -*-
"""Pull the REAL css + the two screen markups out of the game, for layout_lab.html."""
import io, re, json, os

P = r'C:\Users\ashro\Fractal_Reality\FractalGaming\LSS\index-working.html'
OUT = r'C:\Users\ashro\AppData\Local\Temp\claude\C--Users-ashro-Fractal-Reality-FractalGaming\9122b324-e3d7-428b-9cd2-2f49ced4f78c\scratchpad'
raw = io.open(P, encoding='utf-8', errors='replace').read()

# ---- every <style> block in the head ----
css = []
for m in re.finditer(r'<style>(.*?)</style>', raw, re.S):
    css.append(m.group(1))
print('style blocks: %d  (%d chars total)' % (len(css), sum(len(c) for c in css)))

def extract_div(html, start_idx):
    """Return the full <div ...>...</div> starting at start_idx, by tag depth."""
    i = start_idx
    depth = 0
    tag = re.compile(r'<(/?)(div)\b[^>]*?(/?)>', re.I)
    while True:
        m = tag.search(html, i)
        if not m: raise SystemExit('ABORT: unbalanced from %d' % start_idx)
        if m.group(3) == '/':      # self-closing <div/>
            i = m.end(); continue
        depth += -1 if m.group(1) else 1
        i = m.end()
        if depth == 0:
            return html[start_idx:i]

blocks = {}
for key, needle in [('lobby', '<div id="lobby"'), ('shipSelect', '<div id="ship-select">')]:
    idx = raw.index(needle)
    blocks[key] = extract_div(raw, idx)
    print('%-11s %6d chars' % (key, len(blocks[key])))

io.open(os.path.join(OUT, 'lab_css.txt'), 'w', encoding='utf-8').write('\n'.join(css))
io.open(os.path.join(OUT, 'lab_lobby.html'), 'w', encoding='utf-8').write(blocks['lobby'])
io.open(os.path.join(OUT, 'lab_ship.html'), 'w', encoding='utf-8').write(blocks['shipSelect'])
print('written to', OUT)
