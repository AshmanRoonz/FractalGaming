// Delete the triangles a marks JSON flagged, straight out of a GLB.
//
// The glb_editor (tools/glb_editor.html) writes {file, mesh, tris, marked:[triIndex,...]}. This
// takes that list and rewrites the primitive's index buffer without those triangles. Nothing else
// is touched: same vertices, same attributes, same materials, same nodes - so every marker empty
// the pipeline cares about survives untouched.
//
//   node tools/strip_marked_tris.mjs --glb assets_src/objects/carrier.glb --marks path/to.json
//   node tools/strip_marked_tris.mjs ... --out other.glb   (default: in place)
//
// It refuses to run unless the GLB's triangle count matches the count the marks were taken
// against, because a mismatch means the indices point at different geometry than the person
// marking was looking at.
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const glbPath = arg('--glb');
const marksPath = arg('--marks');
const outPath = arg('--out', glbPath);
if (!glbPath || !marksPath) {
  console.error('usage: node tools/strip_marked_tris.mjs --glb <file.glb> --marks <marks.json> [--out <file.glb>]');
  process.exit(2);
}

const marks = JSON.parse(fs.readFileSync(marksPath, 'utf8'));
const marked = new Set((marks.marked || []).map(Number));
if (!marked.size) { console.error('no marked triangles in', marksPath); process.exit(2); }

const io = new NodeIO();
const doc = await io.read(glbPath);
const meshes = doc.getRoot().listMeshes();

let total = 0;
for (const m of meshes) {
  for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    total += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
  }
}
if (marks.tris != null && total !== marks.tris) {
  console.error(`REFUSING: ${glbPath} has ${total} triangles, the marks were taken against ${marks.tris}.`);
  console.error('The indices would point at different geometry than was marked.');
  process.exit(1);
}

// The editor numbers triangles across the file in mesh/primitive order, which is the order below.
let base = 0, removed = 0;
for (const m of meshes) {
  for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    if (!idx) { base += p.getAttribute('POSITION').getCount() / 3; continue; }
    const src = idx.getArray();
    const n = src.length / 3;
    const keep = [];
    for (let t = 0; t < n; t++) {
      if (marked.has(base + t)) { removed++; continue; }
      keep.push(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]);
    }
    if (keep.length !== src.length) {
      idx.setArray(new src.constructor(keep));
    }
    base += n;
  }
}

if (!removed) { console.error('none of the marked triangles were found - nothing written'); process.exit(1); }

await io.write(outPath, doc);
const after = total - removed;
console.log(`${glbPath}: ${total} -> ${after} triangles (${removed} removed, ${marked.size} marked)`);
console.log('wrote', outPath);
