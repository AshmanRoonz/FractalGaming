// Minimal Chrome DevTools Protocol client for measuring the Phi Resonance app on a phone.
// Usage:
//   node cdp.mjs <port> list
//   node cdp.mjs <port> eval  <urlSubstring> <file.js | -e "expression">
//   node cdp.mjs <port> inject <urlSubstring> <file.js>      (runs before page scripts, then reloads)
// The page is chosen by a substring of its URL. Expressions may be async; the value is printed as JSON.
import { readFileSync } from 'node:fs';

const [port, cmd, filter, ...rest] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;

async function targets() {
  const r = await fetch(base + '/json');
  return r.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ ws, send });
    ws.onerror = (e) => reject(new Error('websocket error ' + (e.message || '')));
  });
}

function source() {
  if (rest[0] === '-e') return rest.slice(1).join(' ');
  return readFileSync(rest[0], 'utf8');
}

const list = await targets();
if (cmd === 'list') {
  console.log(JSON.stringify(list.map(t => ({ type: t.type, title: t.title, url: t.url })), null, 1));
  process.exit(0);
}
const t = list.find(x => x.type === 'page' && (!filter || x.url.includes(filter)));
if (!t) { console.error('no page matching', filter, JSON.stringify(list.map(x => x.url))); process.exit(2); }
const { ws, send } = await connect(t.webSocketDebuggerUrl);

if (cmd === 'eval') {
  const res = await send('Runtime.evaluate', { expression: source(), awaitPromise: true, returnByValue: true, userGesture: true });
  if (res.result && res.result.exceptionDetails) console.log('EXCEPTION', JSON.stringify(res.result.exceptionDetails).slice(0, 800));
  else console.log(JSON.stringify(res.result && res.result.result && res.result.result.value));
} else if (cmd === 'inject') {
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: source() });
  await send('Page.reload', { ignoreCache: false });
  console.log('injected and reloaded');
}
ws.close();
process.exit(0);
