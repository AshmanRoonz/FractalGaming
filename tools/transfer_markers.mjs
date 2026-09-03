// Copy the owner's gun* / thruster* / cockpit* marker nodes from the frozen v37.23 hulls
// (assets_base/ships/<ship>.glb) into the ORIGINAL hi-poly exports (LSS/ships_original/<Ship>.glb),
// losslessly: meshes, buffers and textures are untouched, only empty nodes are added at the scene
// root. Both files sit in the same scene space (verified by tools/blender/orig_peek.py: dims and
// centres agree to 1e-4), so translations copy as they are.
//
//   node tools/transfer_markers.mjs            # all seven
//   node tools/transfer_markers.mjs pyro vortex
//
// The untouched originals are kept once in assets_base/ships_original_raw/ (gitignored).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPS = ['vortex', 'pyro', 'puncture', 'slayer', 'tracker', 'blaster', 'syphon'];
const want = process.argv.slice(2).map(s => s.toLowerCase());
const cap = s => s[0].toUpperCase() + s.slice(1);
const isMarker = n => /^(gun|thruster|cockpit)\d+$/i.test(n || '');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const ship of want.length ? want : SHIPS) {
  const frozenPath = path.join(REPO, 'assets_base', 'ships', `${ship}.glb`);
  const origPath = path.join(REPO, 'LSS', 'ships_original', `${cap(ship)}.glb`);
  const rawDir = path.join(REPO, 'assets_base', 'ships_original_raw');
  const rawPath = path.join(rawDir, `${cap(ship)}.glb`);
  if (!fs.existsSync(origPath)) { console.log(ship, 'no original at', origPath); continue; }
  fs.mkdirSync(rawDir, { recursive: true });
  if (!fs.existsSync(rawPath)) fs.copyFileSync(origPath, rawPath);

  const frozen = await io.read(frozenPath);
  const markers = [];
  for (const n of frozen.getRoot().listNodes()) {
    if (!isMarker(n.getName())) continue;
    const t = n.getWorldTranslation();
    markers.push({ name: n.getName(), t: [t[0], t[1], t[2]] });
  }
  markers.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const doc = await io.read(origPath);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  let removed = 0;
  for (const n of root.listNodes()) if (isMarker(n.getName())) { n.dispose(); removed++; }
  for (const m of markers) scene.addChild(doc.createNode(m.name).setTranslation(m.t));
  const vertsBefore = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getAttribute('POSITION').getCount(), 0), 0);
  const texBefore = root.listTextures().reduce((a, t) => a + t.getImage().byteLength, 0);

  // binary in memory: NodeIO.write picks the format by extension and a '.tmp' name silently
  // produced a JSON stub with side files (it did, once ; the raw backups restored the folder)
  const tmp = origPath.replace(/\.glb$/i, '.transfer-tmp.glb');
  fs.writeFileSync(tmp, Buffer.from(await io.writeBinary(doc)));
  const back = await io.readBinary(new Uint8Array(fs.readFileSync(tmp)));
  const r2 = back.getRoot();
  const vertsAfter = r2.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getAttribute('POSITION').getCount(), 0), 0);
  const texAfter = r2.listTextures().reduce((a, t) => a + t.getImage().byteLength, 0);
  const got = r2.listNodes().filter(n => isMarker(n.getName())).map(n => n.getName()).sort();
  const sizeOk = fs.statSync(tmp).size > 0.9 * fs.statSync(origPath).size;
  if (!sizeOk || vertsAfter !== vertsBefore || texAfter !== texBefore || got.length !== markers.length) {
    fs.unlinkSync(tmp);
    throw new Error(`${ship}: verification failed (verts ${vertsBefore}->${vertsAfter}, tex ${texBefore}->${texAfter}, markers ${markers.length}->${got.length})`);
  }
  fs.renameSync(tmp, origPath);
  console.log(`${ship.padEnd(9)} ${markers.length} markers -> ${path.relative(REPO, origPath)}  (${removed} old removed ; ${(fs.statSync(origPath).size / 1e6).toFixed(1)} MB) ` +
              markers.map(m => `${m.name}[${m.t.map(v => v.toFixed(3)).join(',')}]`).join(' '));
}
