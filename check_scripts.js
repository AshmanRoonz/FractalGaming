#!/usr/bin/env node
// Syntax-check every <script> block in index.html and index-working.html.
// Prints "<file>: N scripts, M bad" per file; exits 1 if any block fails
// `node --check` (external-src script tags are counted but skipped).
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

let anyBad = false;
for (const file of ['index.html', 'index-working.html']) {
  const html = fs.readFileSync(path.join(__dirname, 'LSS', file), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0, bad = 0;
  while ((m = re.exec(html)) !== null) {
    n++;
    const attrs = m[1], body = m[2];
    if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
    const typeM = attrs.match(/type\s*=\s*["']([^"']+)["']/);
    const type = typeM ? typeM[1] : 'text/javascript';
    if (type !== 'text/javascript' && type !== 'module') {
      // importmap / JSON blocks: validate as JSON instead of JS.
      try { JSON.parse(body); } catch (e) { bad++; console.error(`${file} script #${n} (type=${type}) FAILED: ${e.message}`); }
      continue;
    }
    const isModule = type === 'module';
    const tmp = path.join(os.tmpdir(), `lss_chk_${n}${isModule ? '.mjs' : '.js'}`);
    fs.writeFileSync(tmp, body, 'utf8');
    try {
      execFileSync('node', ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      bad++;
      console.error(`${file} script #${n} FAILED:\n${e.stderr}`);
    }
    fs.unlinkSync(tmp);
  }
  console.log(`${file}: ${n} scripts, ${bad} bad`);
  if (bad) anyBad = true;
}
process.exit(anyBad ? 1 : 0);
