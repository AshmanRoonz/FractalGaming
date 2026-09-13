# -*- coding: utf-8 -*-
"""Assemble LSS/layout_lab.html - a live layout editor for the lobby + ship-select screens."""
import io, os, re

S = r'C:\Users\ashro\AppData\Local\Temp\claude\C--Users-ashro-Fractal-Reality-FractalGaming\9122b324-e3d7-428b-9cd2-2f49ced4f78c\scratchpad'
OUT = r'C:\Users\ashro\Fractal_Reality\FractalGaming\LSS\layout_lab.html'

css   = io.open(os.path.join(S, 'lab_css.txt'), encoding='utf-8').read()
lobby = io.open(os.path.join(S, 'lab_lobby.html'), encoding='utf-8').read()
ship  = io.open(os.path.join(S, 'lab_ship.html'), encoding='utf-8').read()

# Inline handlers would fire the real game functions (which do not exist here) and steal clicks
# from the editor. Strip them; every other attribute is kept so the layout is byte-faithful.
def denude(h):
    return re.sub(r'\s on(?:click|mouseover|mouseout|input|change|mousedown|mouseup)="[^"]*"', '', h, flags=re.I)
lobby, ship = denude(lobby), denude(ship)

LAB_CSS = r'''
/* ---------- layout lab chrome ---------- */
html,body{margin:0;padding:0;background:#05070d;}
#lab-bar{position:fixed;top:0;left:0;right:0;height:34px;z-index:2147483000;
  background:#141b27;border-bottom:1px solid #2b3a52;display:flex;align-items:center;gap:8px;
  padding:0 10px;font:12px/1 'Segoe UI',system-ui,sans-serif;color:#cfe0f5;}
#lab-bar button,#lab-bar select{font:12px/1 'Segoe UI',system-ui,sans-serif;background:#1d2839;
  color:#cfe0f5;border:1px solid #35496a;border-radius:4px;padding:5px 9px;cursor:pointer;}
#lab-bar button:hover{background:#27354b;}
#lab-bar button.on{background:#2b6cb0;border-color:#4a9eff;color:#fff;}
#lab-bar .sp{flex:1;}
#lab-bar .tag{color:#7d93b2;}
#lab-stage{position:fixed;top:34px;left:0;right:0;bottom:0;overflow:hidden;}
/* (!) !important is load-bearing: #lobby carries an INLINE style attribute in the game markup,
   and an inline display beats any class rule. Same reason .show has to shout. */
#lab-stage > .lab-screen{display:none !important;position:absolute !important;inset:0 !important;
  opacity:1 !important;visibility:visible !important;pointer-events:auto !important;}
#lab-stage > .lab-screen.show{display:flex !important;}
/* the editor's own layer */
#lab-panel{position:fixed;top:44px;right:10px;width:288px;max-height:calc(100vh - 56px);overflow:auto;
  z-index:2147483001;background:#111926f2;border:1px solid #2b3a52;border-radius:8px;
  font:12px/1.35 'Segoe UI',system-ui,sans-serif;color:#cfe0f5;padding:10px;display:none;
  backdrop-filter:blur(6px);box-shadow:0 10px 40px #000a;}
#lab-panel.show{display:block;}
#lab-panel h4{margin:0 0 6px;font-size:12px;color:#8fd0ff;letter-spacing:1px;}
#lab-panel .row{display:flex;align-items:center;gap:6px;margin:4px 0;}
#lab-panel .row label{width:92px;color:#8ea6c4;flex:0 0 auto;font-size:11px;}
#lab-panel input[type=text],#lab-panel select,#lab-panel textarea{flex:1;min-width:0;background:#0c131e;
  color:#dbe8f7;border:1px solid #2b3a52;border-radius:4px;padding:4px 6px;font:11px/1.3 ui-monospace,Consolas,monospace;}
#lab-panel textarea{width:100%;height:70px;resize:vertical;}
#lab-panel .btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
#lab-panel button{background:#1d2839;color:#cfe0f5;border:1px solid #35496a;border-radius:4px;
  padding:5px 8px;cursor:pointer;font:11px/1 'Segoe UI',system-ui,sans-serif;}
#lab-panel button:hover{background:#27354b;}
#lab-crumb{font:10px/1.4 ui-monospace,Consolas,monospace;color:#7d93b2;word-break:break-all;margin-bottom:6px;}
#lab-crumb span{cursor:pointer;color:#8fd0ff;}
#lab-crumb span:hover{text-decoration:underline;}
.lab-hi{outline:2px solid #4a9eff !important;outline-offset:-2px;}
.lab-sel{outline:2px solid #ffcc44 !important;outline-offset:-2px;}
#lab-size{position:fixed;z-index:2147483002;background:#ffcc44;color:#000;font:10px/1 monospace;
  padding:2px 4px;border-radius:3px;pointer-events:none;display:none;}
#lab-grip{position:fixed;z-index:2147483002;width:12px;height:12px;background:#ffcc44;
  border:1px solid #000;cursor:nwse-resize;display:none;}
#lab-export{position:fixed;inset:60px;z-index:2147483003;background:#0c131ef7;border:1px solid #2b3a52;
  border-radius:8px;padding:12px;display:none;flex-direction:column;gap:8px;}
#lab-export.show{display:flex;}
#lab-export textarea{flex:1;background:#070c14;color:#b9ffd0;border:1px solid #2b3a52;border-radius:6px;
  padding:10px;font:12px/1.45 ui-monospace,Consolas,monospace;}
'''

LAB_JS = r'''
(function(){
'use strict';
// ---------------------------------------------------------------- state
var LS = 'lss_layout_lab_v1';
var ov = {};                 // selector -> { prop: value }
var sel = null, mode = 'select', dragging = null;
var stage = document.getElementById('lab-stage');
var sheet = document.getElementById('lab-overrides');
var panel = document.getElementById('lab-panel');

try { ov = JSON.parse(localStorage.getItem(LS) || '{}'); } catch(e){ ov = {}; }

// A selector the GAME can actually use: prefer an id, else an nth-child path up to the
// nearest id. Stable across reloads, and precise enough to hand straight to a stylesheet.
function selFor(el){
  if (!el || el === stage) return null;
  if (el.id) return '#' + el.id;
  var parts = [], n = el;
  while (n && n !== stage){
    if (n.id){ parts.unshift('#' + n.id); break; }
    var p = n.parentElement; if (!p) break;
    var i = Array.prototype.indexOf.call(p.children, n) + 1;
    parts.unshift(n.tagName.toLowerCase() + ':nth-child(' + i + ')');
    n = p;
  }
  return parts.join(' > ');
}
function render(){
  var out = [];
  for (var s in ov){
    var d = ov[s], body = [];
    for (var k in d){ if (d[k] !== '' && d[k] != null) body.push(k + ':' + d[k] + ' !important'); }
    if (body.length) out.push(s + ' {\n  ' + body.join(';\n  ') + ';\n}');
  }
  sheet.textContent = out.join('\n');
  try { localStorage.setItem(LS, JSON.stringify(ov)); } catch(e){}
  var n = 0; for (var q in ov){ for (var w in ov[q]) n++; }
  document.getElementById('lab-count').textContent = n + ' override' + (n===1?'':'s');
}
function setProp(s, k, v){
  if (!s) return;
  ov[s] = ov[s] || {};
  if (v === '' || v == null) delete ov[s][k]; else ov[s][k] = v;
  if (!Object.keys(ov[s]).length) delete ov[s];
  render();
}
// ---------------------------------------------------------------- selection
function pick(el){
  if (sel) sel.classList.remove('lab-sel');
  sel = el;
  if (!el){ panel.classList.remove('show'); grip.style.display='none'; return; }
  el.classList.add('lab-sel');
  panel.classList.add('show');
  fill();
  placeGrip();
}
function fill(){
  var s = selFor(sel), cs = getComputedStyle(sel), d = ov[s] || {};
  document.getElementById('lab-sel-name').textContent = s || '?';
  // breadcrumb of ancestors, clickable - the fastest way to grab a parent box
  var crumb = document.getElementById('lab-crumb'); crumb.innerHTML = '';
  var chain = [], n = sel;
  while (n && n !== stage){ chain.unshift(n); n = n.parentElement; }
  chain.forEach(function(node, i){
    var sp = document.createElement('span');
    sp.textContent = (node.id ? '#'+node.id : node.tagName.toLowerCase());
    sp.onclick = function(){ pick(node); };
    crumb.appendChild(sp);
    if (i < chain.length-1) crumb.appendChild(document.createTextNode(' \u203a '));
  });
  FIELDS.forEach(function(f){
    var inp = document.getElementById('lab-f-' + f.k.replace(/[^a-z]/g,''));
    if (!inp) return;
    inp.value = (d[f.k] != null) ? d[f.k] : '';
    inp.placeholder = cs.getPropertyValue(f.k).trim().slice(0, 24);
  });
  document.getElementById('lab-raw').value = Object.keys(d).filter(function(k){
    return !FIELDS.some(function(f){ return f.k === k; });
  }).map(function(k){ return k + ': ' + d[k] + ';'; }).join('\n');
}
var FIELDS = [
  {k:'width'},{k:'height'},{k:'min-height'},{k:'max-height'},
  {k:'padding'},{k:'margin'},{k:'gap'},
  {k:'font-size'},{k:'letter-spacing'},{k:'line-height'},
  {k:'color'},{k:'background'},{k:'border'},{k:'border-radius'},
  {k:'display'},{k:'flex-direction'},{k:'justify-content'},{k:'align-items'},{k:'flex'},
  {k:'object-fit'},{k:'aspect-ratio'},{k:'opacity'},{k:'text-align'},{k:'position'},
  {k:'top'},{k:'left'},{k:'transform'},{k:'z-index'},{k:'overflow'}
];
// ---------------------------------------------------------------- drag + resize
var grip = document.getElementById('lab-grip');
var sizeTag = document.getElementById('lab-size');
function placeGrip(){
  if (!sel){ grip.style.display='none'; return; }
  var r = sel.getBoundingClientRect();
  grip.style.display='block'; grip.style.left=(r.right-6)+'px'; grip.style.top=(r.bottom-6)+'px';
  sizeTag.style.display='block'; sizeTag.style.left=r.left+'px'; sizeTag.style.top=Math.max(36,r.top-16)+'px';
  sizeTag.textContent = Math.round(r.width)+' x '+Math.round(r.height);
}
grip.addEventListener('mousedown', function(e){
  if (!sel) return; e.preventDefault(); e.stopPropagation();
  var r = sel.getBoundingClientRect();
  dragging = {kind:'size', x:e.clientX, y:e.clientY, w:r.width, h:r.height};
});
stage.addEventListener('mousedown', function(e){
  if (mode !== 'move' || !sel) return;
  if (!sel.contains(e.target)) return;
  e.preventDefault();
  var s = selFor(sel), d = ov[s] || {};
  dragging = {kind:'move', x:e.clientX, y:e.clientY,
              l:parseFloat(d['left']||0)||0, t:parseFloat(d['top']||0)||0};
});
window.addEventListener('mousemove', function(e){
  if (!dragging || !sel) return;
  var s = selFor(sel);
  if (dragging.kind === 'size'){
    setProp(s,'width', Math.max(8, Math.round(dragging.w + e.clientX - dragging.x)) + 'px');
    setProp(s,'height',Math.max(8, Math.round(dragging.h + e.clientY - dragging.y)) + 'px');
  } else {
    setProp(s,'position','relative');
    setProp(s,'left', Math.round(dragging.l + e.clientX - dragging.x) + 'px');
    setProp(s,'top',  Math.round(dragging.t + e.clientY - dragging.y) + 'px');
  }
  placeGrip(); fill();
});
window.addEventListener('mouseup', function(){ dragging = null; });
// arrow-key nudge, 1px (10 with shift)
window.addEventListener('keydown', function(e){
  if (!sel || document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  var dx=0, dy=0, step = e.shiftKey ? 10 : 1;
  if (e.key==='ArrowLeft') dx=-step; else if (e.key==='ArrowRight') dx=step;
  else if (e.key==='ArrowUp') dy=-step; else if (e.key==='ArrowDown') dy=step;
  else if (e.key==='Escape'){ pick(null); return; }
  else return;
  e.preventDefault();
  var s = selFor(sel), d = ov[s]||{};
  setProp(s,'position','relative');
  setProp(s,'left', ((parseFloat(d['left']||0)||0)+dx)+'px');
  setProp(s,'top',  ((parseFloat(d['top'] ||0)||0)+dy)+'px');
  placeGrip(); fill();
});
// ---------------------------------------------------------------- clicks
stage.addEventListener('mouseover', function(e){
  if (mode === 'off') return;
  var t = e.target; if (t===stage) return;
  t.classList.add('lab-hi');
}, true);
stage.addEventListener('mouseout', function(e){ e.target.classList && e.target.classList.remove('lab-hi'); }, true);
stage.addEventListener('click', function(e){
  if (mode === 'off') return;
  e.preventDefault(); e.stopPropagation();
  pick(e.target === stage ? null : e.target);
}, true);
window.addEventListener('scroll', placeGrip, true);
window.addEventListener('resize', placeGrip);
// ---------------------------------------------------------------- wiring
function build(){
  var host = document.getElementById('lab-fields');
  FIELDS.forEach(function(f){
    var row = document.createElement('div'); row.className='row';
    var lb = document.createElement('label'); lb.textContent = f.k;
    var inp = document.createElement('input'); inp.type='text'; inp.id='lab-f-'+f.k.replace(/[^a-z]/g,'');
    inp.addEventListener('input', function(){ setProp(selFor(sel), f.k, inp.value.trim()); placeGrip(); });
    row.appendChild(lb); row.appendChild(inp); host.appendChild(row);
  });
  document.getElementById('lab-raw').addEventListener('input', function(){
    var s = selFor(sel); if (!s) return;
    // strip anything not in FIELDS, then re-add what the textarea says
    var keep = {}; FIELDS.forEach(function(f){ if (ov[s] && ov[s][f.k]!=null) keep[f.k]=ov[s][f.k]; });
    ov[s] = keep;
    this.value.split(/;|\n/).forEach(function(line){
      var i = line.indexOf(':'); if (i<1) return;
      var k = line.slice(0,i).trim(), v = line.slice(i+1).trim().replace(/;$/,'');
      if (k && v) ov[s][k] = v;
    });
    render();
  });
}
function screenTo(which){
  ['lobby','ship-select'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.classList.toggle('show', id === which);
  });
  document.getElementById('lab-screen').value = which;
  pick(null);
}
document.getElementById('lab-screen').addEventListener('change', function(){ screenTo(this.value); });
['select','move','off'].forEach(function(m){
  document.getElementById('lab-mode-'+m).addEventListener('click', function(){
    mode = m;
    ['select','move','off'].forEach(function(x){
      document.getElementById('lab-mode-'+x).classList.toggle('on', x===m);
    });
  });
});
document.getElementById('lab-hide').addEventListener('click', function(){
  if (sel) { setProp(selFor(sel),'display','none'); pick(null); }
});
document.getElementById('lab-clear').addEventListener('click', function(){
  var s = selFor(sel); if (s){ delete ov[s]; render(); fill(); placeGrip(); }
});
document.getElementById('lab-reset').addEventListener('click', function(){
  if (!confirm('Discard every override?')) return;
  ov = {}; render(); pick(null);
});
document.getElementById('lab-export-btn').addEventListener('click', function(){
  var box = document.getElementById('lab-export');
  document.getElementById('lab-export-text').value =
    '/* layout_lab overrides - ' + new Date().toISOString().slice(0,16).replace('T',' ') + ' */\n' + sheet.textContent;
  box.classList.add('show');
});
document.getElementById('lab-export-close').addEventListener('click', function(){
  document.getElementById('lab-export').classList.remove('show');
});
document.getElementById('lab-export-copy').addEventListener('click', function(){
  var t = document.getElementById('lab-export-text'); t.select();
  try { document.execCommand('copy'); this.textContent='Copied'; setTimeout(function(){ document.getElementById('lab-export-copy').textContent='Copy'; },1200); } catch(e){}
});
document.getElementById('lab-import').addEventListener('click', function(){
  var txt = prompt('Paste a previously exported override block:');
  if (txt == null) return;
  var re = /([^{}]+)\{([^}]*)\}/g, m, next = {};
  while ((m = re.exec(txt))){
    var s = m[1].replace(/\/\*[\s\S]*?\*\//g,'').trim(); if (!s) continue;
    next[s] = next[s] || {};
    m[2].split(';').forEach(function(d){
      var i = d.indexOf(':'); if (i<1) return;
      next[s][d.slice(0,i).trim()] = d.slice(i+1).replace(/!important/,'').trim();
    });
  }
  ov = next; render(); pick(null);
});
build(); render(); screenTo('ship-select');
document.getElementById('lab-mode-select').classList.add('on');
})();
'''

# ---- ship select needs its JS-filled content faked, or it is a set of empty boxes ----
FILL = r'''
<script>
(function(){
  function set(id, html){ var e = document.getElementById(id); if (e) e.innerHTML = html; }
  var SHIPS = ['VORTEX','PYRO','PUNCTURE','SLAYER','TRACKER','BLASTER','SYPHON'];
  set('ship-carousel-track', SHIPS.map(function(s,i){
    return '<div class="ship-chip' + (i===0?' selected':'') + '"><div class="sc-name">'+s+'</div>'+
           '<div class="sc-role">'+(i===0?'CORVETTE':'INTERCEPTOR')+'</div></div>';
  }).join(''));
  set('map-indicator', ['hourglass','spire','spine','infinity','tower','cross','arc','gyre','colonnade','shifting_deep','gmaps_user']
      .map(function(k,i){ return '<div class="map-dot'+(i===10?' active':'')+'" data-key="'+k+'"></div>'; }).join(''));
  set('map-window',
    '<div id="map-window-preview"><img class="map-thumb-img" src="map_thumbs/toronto.jpg" alt="Custom Location" draggable="false"></div>' +
    '<div id="map-window-name">Custom Location</div>' +
    '<div id="map-window-desc">Fly a real place. Drop a pin and the terrain builds from live elevation.</div>');
  set('perks-grid', ['OUTLINE OPTICS','EMERGENCY RECHARGE','EXTRA CRASH','AUTO CLOAK','WING BOOSTER']
      .map(function(p,i){ return '<div class="perk-card'+(i===2?' selected':'')+'">'+p+'</div>'; }).join(''));
  set('perks-desc', 'Pick one. More room for wider hardpoints and core pressure.');
  set('teammates-strip', '<div class="tm-chip">YOU</div><div class="tm-chip">ashman</div>');
  var info = document.getElementById('ship-preview-info');
  if (info && !info.textContent.trim()) info.innerHTML =
    '<div class="spi-row"><span>HULL</span><b>1080</b></div>'+
    '<div class="spi-row"><span>SHIELD</span><b>2000</b></div>'+
    '<div class="spi-row"><span>SPEED</span><b>300</b></div>'+
    '<div class="spi-row"><span>DASHES</span><b>2</b></div>';
})();
</script>
'''

html = []
html.append('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">')
html.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
html.append('<title>LSS Layout Lab</title>')
html.append('<style>\n' + css + '\n</style>')
html.append('<style>\n' + LAB_CSS + '\n</style>')
html.append('<style id="lab-overrides"></style>')
html.append('</head>\n<body>')

html.append('''
<div id="lab-bar">
  <b style="letter-spacing:2px;color:#8fd0ff;">LAYOUT LAB</b>
  <span class="tag">Screen</span>
  <select id="lab-screen">
    <option value="ship-select">Ship Select</option>
    <option value="lobby">Main Menu</option>
  </select>
  <span class="tag">Mode</span>
  <button id="lab-mode-select" title="Click an element to select it">Select</button>
  <button id="lab-mode-move" title="Drag the selected element">Move</button>
  <button id="lab-mode-off" title="Stop intercepting clicks">Off</button>
  <span class="sp"></span>
  <span class="tag" id="lab-count">0 overrides</span>
  <button id="lab-import">Import</button>
  <button id="lab-export-btn">Export CSS</button>
  <button id="lab-reset">Reset</button>
</div>

<div id="lab-stage">
''' )
html.append(lobby.replace('<div id="lobby"', '<div id="lobby" class="lab-screen"', 1))
html.append(ship.replace('<div id="ship-select">', '<div id="ship-select" class="lab-screen">', 1))
html.append('</div>')

html.append('''
<div id="lab-size"></div>
<div id="lab-grip"></div>

<div id="lab-panel">
  <h4>SELECTED</h4>
  <div id="lab-crumb"></div>
  <div style="font:11px/1.3 ui-monospace,Consolas,monospace;color:#ffcc44;margin-bottom:6px;" id="lab-sel-name"></div>
  <div id="lab-fields"></div>
  <h4 style="margin-top:10px;">EXTRA CSS</h4>
  <textarea id="lab-raw" spellcheck="false" placeholder="box-shadow: none;&#10;flex-basis: 40%;"></textarea>
  <div class="btns">
    <button id="lab-hide">Hide element</button>
    <button id="lab-clear">Clear this</button>
  </div>
  <div style="margin-top:8px;color:#6d82a0;font-size:10px;line-height:1.5;">
    Arrow keys nudge 1px (10 with Shift). Drag the yellow corner to resize.
    Esc deselects. Everything is saved in this browser.
  </div>
</div>

<div id="lab-export">
  <div style="display:flex;align-items:center;gap:8px;">
    <b style="color:#8fd0ff;letter-spacing:1px;">EXPORT</b>
    <span style="color:#7d93b2;font-size:11px;">Paste this back to me and I will fold it into the game's stylesheet.</span>
    <span style="flex:1;"></span>
    <button id="lab-export-copy">Copy</button>
    <button id="lab-export-close">Close</button>
  </div>
  <textarea id="lab-export-text" spellcheck="false"></textarea>
</div>
''')
html.append(FILL)
html.append('<script>\n' + LAB_JS + '\n</script>')
html.append('</body>\n</html>')

out = '\n'.join(html)
io.open(OUT, 'w', encoding='utf-8').write(out)
print('wrote %s  (%.0f KB)' % (OUT, len(out.encode('utf-8'))/1024.0))
