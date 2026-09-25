// v48.46 O3.5: the tree-planting loop of _swBuildTrees, old (v48.45) vs new, on the same deterministic stub
// terrain and the same seeded Math.random stream - the buckets (x, y, z, eco per tree) must be identical.
import fs from 'fs';
const OLD = fs.readFileSync('' + (process.argv[2] || 'C:/Users/ashro/Fractal_Reality/FractalGaming/LSS/backups/index-working_v48.45_onepass-shields.html') + '', 'utf8');
const NEW = fs.readFileSync('C:/Users/ashro/Fractal_Reality/FractalGaming/LSS/index-working.html', 'utf8');
function loopSrc(src) {
  const f = src.indexOf('function _swBuildTrees(x0,z0,T){');
  const a = src.indexOf('for(let j=0;j<N;j++)for(let i=0;i<N;i++){', f);
  let i = src.indexOf('{', a), d = 0;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
  return src.slice(a, i + 1);
}
const lo = loopSrc(OLD), ln = loopSrc(NEW);
if (lo === ln) { console.log('loops identical?!'); process.exit(1); }
// deterministic smooth stubs (any deterministic terrain proves the reorder; the real one is deterministic too)
const H = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const stubs = `
  const _stGroundYGrid=(x,z,T)=>300*Math.sin(x*0.0011)*Math.cos(z*0.0009)+120*Math.sin((x+z)*0.004);
  const _stGroundYCarved=_stGroundYGrid;
  const _hubCityExcludes=(x,z)=>((x*x+z*z)<400*400);
  const _owExcludes=(x,z)=>false;
  const _hzZoneForFoliage=(x,z)=>{ const v=Math.sin(x*0.0003)+Math.cos(z*0.00027); return v>1.6?{key:'snow',zs:0.3}:(v<-1.7?{key:'rocky',zs:0.5}:(v>1.2?{key:'volcanic',zs:0.6}:null)); };
  const _hzFungusAt=(x,z)=>0.5+0.5*Math.sin(x*0.002+z*0.0013);
  const _stPatch=(x,z)=>0.5+0.5*Math.sin(x*0.0017)*Math.cos(z*0.0021);
  const _swForestAt=(x,z)=>0.5+0.5*Math.sin(x*0.0005+1.3)*Math.sin(z*0.0007);
  const _swMoistAt=(x,z,T)=>Math.max(0,Math.min(1,0.5+0.6*Math.sin(x*0.0009)*Math.cos(z*0.0012)));
  const _swExposeAt=(x,z,y,T)=>Math.max(0,Math.min(1,0.4+0.6*Math.cos(x*0.0013+z*0.0008)));
  const _stHash2=(a,b)=>{ const s=Math.sin(a*12.9898+b*78.233)*43758.5453; return s-Math.floor(s); };
  const window={};
  const _ECO_MAX=1.77;
`;
function run(loop, seed, x0, z0, full) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let draws = 0;
  const M = Object.create(Math); M.random = () => { draws++; return rnd(); };
  const body = stubs + `
    const N=${full ? 58 : 52}, step=9000/N, eps=6, SR=0.55, SG=0.85, _full=${full};
    const buckets={ std:[[],[],[],[],[],[],[],[],[]], snow:[[],[],[],[]], shroom:[[],[]] };
    const _shroomVi=1, _stdPal=[2,5,7], _snowPal=null;
    const T={ HUB:true, WL:-200, YMID:0, AMP:900, snowLine:0.7, biome:'mossy' };
    const x0=${x0}, z0=${z0};
    ${loop}
    return buckets;`;
  const fn = new Function('Math', body);
  const b = fn(M);
  return { b, draws };
}
let bad = 0, runs = 0, trees = 0, drawsOld = 0, drawsNew = 0;
for (let k = 0; k < 60; k++) {
  const x0 = (k % 10 - 5) * 9000 + 1234, z0 = (Math.floor(k / 10) - 3) * 9000 - 777, full = (k % 3) !== 0;
  const A = run(lo, 1000 + k, x0, z0, full), B = run(ln, 1000 + k, x0, z0, full);
  runs++; drawsOld += A.draws; drawsNew += B.draws;
  const ja = JSON.stringify(A.b), jb = JSON.stringify(B.b);
  if (ja !== jb) bad++;
  for (const kk of ['std', 'snow', 'shroom']) for (const arr of A.b[kk]) trees += arr.length / 4;
}
console.log('chunks ' + runs + ', differing ' + bad + ', trees planted ' + trees + ', random draws old ' + drawsOld + ' new ' + drawsNew);
