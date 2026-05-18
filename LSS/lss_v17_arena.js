// ============================================================================
// Last Ship Sailing v17 - Arena / Level Builder extraction
// Source: C:\Users\ashro\Fractal_Reality\fractalgaming\LSS\old_versions\last_ship_sailing_v17.html
// Wall shader source (sdfFragSrc) is intentionally omitted as requested.
// All other code is verbatim.
// ============================================================================


// ----- game object: worker fields (verbatim from declaration block) -----
/*
  // Web Worker for marching cubes
  levelWorker: null,
  levelWorkerCallbacks: [],
*/


// ----- worker init (boot path) -----
// Initialize marching cubes worker
try {
  game.levelWorker = initializeMarchingCubesWorker();
} catch(e) {
  console.warn('Web Worker unavailable, will fall back to sync marching cubes:', e);
  game.levelWorker = null;
}


// ----- initializeMarchingCubesWorker (Blob-based worker source) -----
function initializeMarchingCubesWorker() {
  const workerCode = `
// Marching cubes worker: pure math functions plus tables

function sdSphere(px,py,pz,cx,cy,cz,r) {
  const dx=px-cx,dy=py-cy,dz=pz-cz;
  return Math.sqrt(dx*dx+dy*dy+dz*dz)-r;
}

function sdCylinder(px,py,pz,ax,ay,az,bx,by,bz,r) {
  const bax=bx-ax,bay=by-ay,baz=bz-az;
  const pax=px-ax,pay=py-ay,paz=pz-az;
  const baLen2=bax*bax+bay*bay+baz*baz;
  if(baLen2<0.001) return sdSphere(px,py,pz,ax,ay,az,r);
  const t=Math.max(0,Math.min(1,(pax*bax+pay*bay+paz*baz)/baLen2));
  const cx2=ax+bax*t,cy2=ay+bay*t,cz2=az+baz*t;
  const dx=px-cx2,dy=py-cy2,dz=pz-cz2;
  const perpDist=Math.sqrt(dx*dx+dy*dy+dz*dz);
  const baLen=Math.sqrt(baLen2);
  const axialFromMid=Math.abs(t-0.5)*baLen;
  const halfLen=baLen*0.5;
  const dAxial=axialFromMid-halfLen;
  const dPerp=perpDist-r;
  if(dPerp>0&&dAxial>0) return Math.sqrt(dPerp*dPerp+dAxial*dAxial);
  return Math.max(dPerp,dAxial);
}

function sdfSmin(a,b,k) {
  if(k<=0.001) return Math.min(a,b);
  const h=Math.max(0,Math.min(1,0.5+0.5*(b-a)/k));
  return b*(1-h)+a*h-k*h*(1-h);
}

function worldSDF(px,py,pz,spheres,cylinders,smoothK) {
  let roomD = 99999;
  for(const s of spheres) roomD = sdfSmin(roomD, sdSphere(px,py,pz,s.cx,s.cy,s.cz,s.r), smoothK);
  let d = roomD;
  for(const c of cylinders) {
    const cd = sdCylinder(px,py,pz,c.ax,c.ay,c.az,c.bx,c.by,c.bz,c.r);
    d = Math.min(d, sdfSmin(roomD, cd, smoothK));
  }
  return d;
}

const mcEdgeTable = new Uint16Array([0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0]);

const mcTriTable = [[-1],[0,8,3,-1],[0,1,9,-1],[1,8,3,9,8,1,-1],[1,2,10,-1],[0,8,3,1,2,10,-1],[9,2,10,0,2,9,-1],[2,8,3,2,10,8,10,9,8,-1],[3,11,2,-1],[0,11,2,8,11,0,-1],[1,9,0,2,3,11,-1],[1,11,2,1,9,11,9,8,11,-1],[3,10,1,11,10,3,-1],[0,10,1,0,8,10,8,11,10,-1],[3,9,0,3,11,9,11,10,9,-1],[9,8,10,10,8,11,-1],[4,7,8,-1],[4,3,0,7,3,4,-1],[0,1,9,8,4,7,-1],[4,1,9,4,7,1,7,3,1,-1],[1,2,10,8,4,7,-1],[3,4,7,3,0,4,1,2,10,-1],[9,2,10,9,0,2,8,4,7,-1],[2,10,9,2,9,7,2,7,3,7,9,4,-1],[8,4,7,3,11,2,-1],[11,4,7,11,2,4,2,0,4,-1],[9,0,1,8,4,7,2,3,11,-1],[4,7,11,9,4,11,9,11,2,9,2,1,-1],[3,10,1,3,11,10,7,8,4,-1],[1,11,10,1,4,11,1,0,4,7,11,4,-1],[4,7,8,9,0,11,9,11,10,11,0,3,-1],[4,7,11,4,11,9,9,11,10,-1],[9,5,4,-1],[9,5,4,0,8,3,-1],[0,5,4,1,5,0,-1],[8,5,4,8,3,5,3,1,5,-1],[1,2,10,9,5,4,-1],[3,0,8,1,2,10,4,9,5,-1],[5,2,10,5,4,2,4,0,2,-1],[2,10,5,3,2,5,3,5,4,3,4,8,-1],[9,5,4,2,3,11,-1],[0,11,2,0,8,11,4,9,5,-1],[0,5,4,0,1,5,2,3,11,-1],[2,1,5,2,5,8,2,8,11,4,8,5,-1],[10,3,11,10,1,3,9,5,4,-1],[4,9,5,0,8,1,8,10,1,8,11,10,-1],[5,4,0,5,0,11,5,11,10,11,0,3,-1],[5,4,8,5,8,10,10,8,11,-1],[9,7,8,5,7,9,-1],[9,3,0,9,5,3,5,7,3,-1],[0,7,8,0,1,7,1,5,7,-1],[1,5,3,3,5,7,-1],[9,7,8,9,5,7,10,1,2,-1],[10,1,0,10,0,7,10,7,5,7,0,3,-1],[8,0,2,8,2,5,8,5,7,10,5,2,-1],[2,10,5,2,5,3,3,5,7,-1],[7,9,5,7,8,9,3,11,2,-1],[9,5,7,9,7,2,9,2,0,2,7,11,-1],[2,3,11,0,1,8,1,7,8,1,5,7,-1],[11,2,1,11,1,7,7,1,5,-1],[9,5,8,8,5,7,10,1,3,10,3,11,-1],[5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1],[11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1],[11,10,5,7,11,5,-1],[10,6,5,-1],[0,8,3,5,10,6,-1],[9,0,1,5,10,6,-1],[1,8,3,1,9,8,5,10,6,-1],[1,6,5,2,6,1,-1],[1,6,5,1,2,6,3,0,8,-1],[9,6,5,9,0,6,0,2,6,-1],[5,9,8,5,8,2,5,2,6,3,2,8,-1],[2,3,11,10,6,5,-1],[11,0,8,11,2,0,10,6,5,-1],[0,1,9,2,3,11,5,10,6,-1],[5,10,6,1,9,2,9,11,2,9,8,11,-1],[6,3,11,6,5,3,5,1,3,-1],[0,8,11,0,11,5,0,5,1,5,11,6,-1],[3,11,6,0,3,6,0,6,5,0,5,9,-1],[6,5,9,6,9,11,11,9,8,-1],[5,10,6,4,7,8,-1],[4,3,0,4,7,3,6,5,10,-1],[1,9,0,5,10,6,8,4,7,-1],[10,6,5,1,9,7,1,7,3,7,9,4,-1],[6,1,2,6,5,1,4,7,8,-1],[1,2,5,5,2,6,3,0,4,3,4,7,-1],[8,4,7,9,0,5,0,6,5,0,2,6,-1],[7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1],[3,11,2,7,8,4,10,6,5,-1],[5,10,6,4,7,2,4,2,0,2,7,11,-1],[0,1,9,4,7,8,2,3,11,5,10,6,-1],[9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1],[8,4,7,3,11,5,3,5,1,5,11,6,-1],[5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1],[0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1],[6,5,9,6,9,11,4,7,9,7,11,9,-1],[10,4,9,6,4,10,-1],[4,10,6,4,9,10,0,8,3,-1],[10,0,1,10,6,0,6,4,0,-1],[8,3,1,8,1,6,8,6,4,6,1,10,-1],[1,4,9,1,2,4,2,6,4,-1],[3,0,8,1,2,9,2,4,9,2,6,4,-1],[0,2,4,4,2,6,-1],[8,3,2,8,2,4,4,2,6,-1],[10,4,9,10,6,4,11,2,3,-1],[0,8,2,2,8,11,4,9,10,4,10,6,-1],[3,11,2,0,1,6,0,6,4,6,1,10,-1],[6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1],[9,6,4,9,3,6,9,1,3,11,6,3,-1],[8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1],[3,11,6,3,6,0,0,6,4,-1],[6,4,8,11,6,8,-1],[7,10,6,7,8,10,8,9,10,-1],[0,7,3,0,10,7,0,9,10,6,7,10,-1],[10,6,7,1,10,7,1,7,8,1,8,0,-1],[10,6,7,10,7,1,1,7,3,-1],[1,2,6,1,6,8,1,8,9,8,6,7,-1],[2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1],[7,8,0,7,0,6,6,0,2,-1],[7,3,2,6,7,2,-1],[2,3,11,10,6,8,10,8,9,8,6,7,-1],[2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1],[1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1],[11,2,1,11,1,7,10,6,1,6,7,1,-1],[8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1],[0,9,1,11,6,7,-1],[7,8,0,7,0,6,3,11,0,11,6,0,-1],[7,11,6,-1],[7,6,11,-1],[3,0,8,11,7,6,-1],[0,1,9,11,7,6,-1],[8,1,9,8,3,1,11,7,6,-1],[10,1,2,6,11,7,-1],[1,2,10,3,0,8,6,11,7,-1],[2,9,0,2,10,9,6,11,7,-1],[6,11,7,2,10,3,10,8,3,10,9,8,-1],[7,2,3,6,2,7,-1],[7,0,8,7,6,0,6,2,0,-1],[2,7,6,2,3,7,0,1,9,-1],[1,6,2,1,8,6,1,9,8,8,7,6,-1],[10,7,6,10,1,7,1,3,7,-1],[10,7,6,1,7,10,1,8,7,1,0,8,-1],[0,3,7,0,7,10,0,10,9,6,10,7,-1],[7,6,10,7,10,8,8,10,9,-1],[6,8,4,11,8,6,-1],[3,6,11,3,0,6,0,4,6,-1],[8,6,11,8,4,6,9,0,1,-1],[9,4,6,9,6,3,9,3,1,11,3,6,-1],[6,8,4,6,11,8,2,10,1,-1],[1,2,10,3,0,11,0,6,11,0,4,6,-1],[4,11,8,4,6,11,0,2,9,2,10,9,-1],[10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1],[8,2,3,8,4,2,4,6,2,-1],[0,4,2,4,6,2,-1],[1,9,0,2,3,4,2,4,6,4,3,8,-1],[1,9,4,1,4,2,2,4,6,-1],[8,1,3,8,6,1,8,4,6,6,10,1,-1],[10,1,0,10,0,6,6,0,4,-1],[4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1],[10,9,4,6,10,4,-1],[4,9,5,7,6,11,-1],[0,8,3,4,9,5,11,7,6,-1],[5,0,1,5,4,0,7,6,11,-1],[11,7,6,8,3,4,3,5,4,3,1,5,-1],[9,5,4,10,1,2,7,6,11,-1],[6,11,7,1,2,10,0,8,3,4,9,5,-1],[7,6,11,5,4,10,4,2,10,4,0,2,-1],[3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1],[7,2,3,7,6,2,5,4,9,-1],[9,5,4,0,8,6,0,6,2,6,8,7,-1],[3,6,2,3,7,6,1,5,0,5,4,0,-1],[6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1],[9,5,4,10,1,6,1,7,6,1,3,7,-1],[1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1],[4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1],[7,6,10,7,10,8,5,4,10,4,8,10,-1],[6,9,5,6,11,9,11,8,9,-1],[3,6,11,0,6,3,0,5,6,0,9,5,-1],[0,11,8,0,5,11,0,1,5,5,6,11,-1],[6,11,3,6,3,5,5,3,1,-1],[1,2,10,9,5,11,9,11,8,11,5,6,-1],[0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1],[11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1],[6,11,3,6,3,5,2,10,3,10,5,3,-1],[5,8,9,5,2,8,5,6,2,3,8,2,-1],[9,5,6,9,6,0,0,6,2,-1],[1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1],[1,5,6,2,1,6,-1],[1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1],[10,1,0,10,0,6,9,5,0,5,6,0,-1],[0,3,8,5,6,10,-1],[10,5,6,-1],[11,5,10,7,5,11,-1],[11,5,10,11,7,5,8,3,0,-1],[5,11,7,5,10,11,1,9,0,-1],[10,7,5,10,11,7,9,8,1,8,3,1,-1],[11,1,2,11,7,1,7,5,1,-1],[0,8,3,1,2,7,1,7,5,7,2,11,-1],[9,7,5,9,2,7,9,0,2,2,11,7,-1],[7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1],[2,5,10,2,3,5,3,7,5,-1],[8,2,0,8,5,2,8,7,5,10,2,5,-1],[9,0,1,5,10,3,5,3,7,3,10,2,-1],[9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,-1],[1,3,5,3,7,5,-1],[0,8,7,0,7,1,1,7,5,-1],[9,0,3,9,3,5,5,3,7,-1],[9,8,7,5,9,7,-1],[5,8,4,5,10,8,10,11,8,-1],[5,0,4,5,11,0,5,10,11,11,3,0,-1],[0,1,9,8,4,10,8,10,11,10,4,5,-1],[10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1],[2,5,1,2,8,5,2,11,8,4,5,8,-1],[0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1],[0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1],[9,4,5,2,11,3,-1],[2,5,10,3,5,2,3,4,5,3,8,4,-1],[5,10,2,5,2,4,4,2,0,-1],[3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1],[5,10,2,5,2,4,1,9,2,9,4,2,-1],[8,4,5,8,5,3,3,5,1,-1],[0,4,5,1,0,5,-1],[8,4,5,8,5,3,9,0,5,0,3,5,-1],[9,4,5,-1],[4,11,7,4,9,11,9,10,11,-1],[0,8,3,4,9,7,9,11,7,9,10,11,-1],[1,10,11,1,11,4,1,4,0,7,4,11,-1],[3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1],[4,11,7,9,11,4,9,2,11,9,1,2,-1],[9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1],[11,7,4,11,4,2,2,4,0,-1],[11,7,4,11,4,2,8,3,4,3,2,4,-1],[2,9,10,2,7,9,2,3,7,7,4,9,-1],[9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1],[3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1],[1,10,2,8,7,4,-1],[4,9,1,4,1,7,7,1,3,-1],[4,9,1,4,1,7,0,8,1,8,7,1,-1],[4,0,3,7,4,3,-1],[4,8,7,-1],[9,10,8,10,11,8,-1],[3,0,9,3,9,11,11,9,10,-1],[0,1,10,0,10,8,8,10,11,-1],[3,1,10,11,3,10,-1],[1,2,11,1,11,9,9,11,8,-1],[3,0,9,3,9,11,1,2,9,2,11,9,-1],[0,2,11,8,0,11,-1],[3,2,11,-1],[2,3,8,2,8,10,10,8,9,-1],[9,10,2,0,9,2,-1],[2,3,8,2,8,10,0,1,8,1,10,8,-1],[1,10,2,-1],[1,3,8,9,1,8,-1],[0,9,1,-1],[0,3,8,-1],[-1]];

const mcEdgeVerts=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

self.onmessage = function(e) {
  const {bounds, gridRes, spheres, cylinders, smoothK} = e.data;
  const nx=gridRes,ny=gridRes,nz=gridRes;
  const dx=(bounds.maxX-bounds.minX)/nx;
  const dy=(bounds.maxY-bounds.minY)/ny;
  const dz=(bounds.maxZ-bounds.minZ)/nz;

  const vals=new Float32Array((nx+1)*(ny+1)*(nz+1));
  const gi=(i,j,k)=>i+(nx+1)*(j+(ny+1)*k);
  for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    vals[gi(i,j,k)]=worldSDF(bounds.minX+i*dx,bounds.minY+j*dy,bounds.minZ+k*dz,spheres,cylinders,smoothK);
  }

  function mcInterp(i1,j1,k1,i2,j2,k2){
    const v1=vals[gi(i1,j1,k1)],v2=vals[gi(i2,j2,k2)];
    if(Math.abs(v1)<0.00001)return[bounds.minX+i1*dx,bounds.minY+j1*dy,bounds.minZ+k1*dz];
    if(Math.abs(v2)<0.00001)return[bounds.minX+i2*dx,bounds.minY+j2*dy,bounds.minZ+k2*dz];
    if(Math.abs(v1-v2)<0.00001)return[bounds.minX+i1*dx,bounds.minY+j1*dy,bounds.minZ+k1*dz];
    const t=v1/(v1-v2);
    return[bounds.minX+(i1+t*(i2-i1))*dx,bounds.minY+(j1+t*(j2-j1))*dy,bounds.minZ+(k1+t*(k2-k1))*dz];
  }

  const positions=[];
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const v=[vals[gi(i,j,k)],vals[gi(i+1,j,k)],vals[gi(i+1,j+1,k)],vals[gi(i,j+1,k)],vals[gi(i,j,k+1)],vals[gi(i+1,j,k+1)],vals[gi(i+1,j+1,k+1)],vals[gi(i,j+1,k+1)]];
    let cubeIdx=0;
    for(let c=0;c<8;c++)if(v[c]<0)cubeIdx|=(1<<c);
    if(mcEdgeTable[cubeIdx]===0)continue;
    const ci=[i,i+1,i+1,i,i,i+1,i+1,i];
    const cj=[j,j,j+1,j+1,j,j,j+1,j+1];
    const ck=[k,k,k,k,k+1,k+1,k+1,k+1];
    const ev=new Array(12);
    for(let e=0;e<12;e++){
      if(mcEdgeTable[cubeIdx]&(1<<e)){
        const[a,b]=mcEdgeVerts[e];
        ev[e]=mcInterp(ci[a],cj[a],ck[a],ci[b],cj[b],ck[b]);
      }
    }
    const tris=mcTriTable[cubeIdx];
    for(let t=0;t<tris.length;t+=3){
      if(tris[t]===-1)break;
      const a=ev[tris[t]],b=ev[tris[t+1]],c=ev[tris[t+2]];
      if(a&&b&&c){positions.push(a[0],a[1],a[2],c[0],c[1],c[2],b[0],b[1],b[2]);}
    }
  }

  const posF32 = new Float32Array(positions);
  self.postMessage({gridRes, positions: posF32}, [posF32.buffer]);
};
`;

  const blob = new Blob([workerCode], {type: 'text/javascript'});
  return new Worker(URL.createObjectURL(blob));
}


// ----- SDF helpers (main-thread copy) -----
function sdSphere(px,py,pz,cx,cy,cz,r) {
  const dx=px-cx,dy=py-cy,dz=pz-cz;
  return Math.sqrt(dx*dx+dy*dy+dz*dz)-r;
}

function sdCylinder(px,py,pz,ax,ay,az,bx,by,bz,r) {
  const bax=bx-ax,bay=by-ay,baz=bz-az;
  const pax=px-ax,pay=py-ay,paz=pz-az;
  const baLen2=bax*bax+bay*bay+baz*baz;
  if(baLen2<0.001) return sdSphere(px,py,pz,ax,ay,az,r);
  const t=Math.max(0,Math.min(1,(pax*bax+pay*bay+paz*baz)/baLen2));
  const cx2=ax+bax*t,cy2=ay+bay*t,cz2=az+baz*t;
  const dx=px-cx2,dy=py-cy2,dz=pz-cz2;
  const perpDist=Math.sqrt(dx*dx+dy*dy+dz*dz);
  const baLen=Math.sqrt(baLen2);
  const axialFromMid=Math.abs(t-0.5)*baLen;
  const halfLen=baLen*0.5;
  const dAxial=axialFromMid-halfLen;
  const dPerp=perpDist-r;
  if(dPerp>0&&dAxial>0) return Math.sqrt(dPerp*dPerp+dAxial*dAxial);
  return Math.max(dPerp,dAxial);
}

function sdfSmin(a,b,k) {
  if(k<=0.001) return Math.min(a,b);
  const h=Math.max(0,Math.min(1,0.5+0.5*(b-a)/k));
  return b*(1-h)+a*h-k*h*(1-h);
}

// Evaluate the world SDF: negative = inside playable space, positive = solid wall
// Rooms blend smoothly with each other and with tunnels (smin),
// but tunnels use hard union (min) between each other so parallel tunnels stay separate.
// (v15a 2026-05-10 opt) Per-primitive bounding-sphere early-out. The smooth-min
// k=45 blend reaches ~3k = 135 units past surface ; beyond that a primitive
// can't influence the current min. Skipping those primitives with a single
// dist² comparison removes ~70% of per-primitive work in typical play
// (~3300 SDF evals/frame × ~40 primitives → ~3300 × ~12). For ~20 rooms +
// 20 tunnels per level this is the simplest correctness-preserving win
// (no spatial grid build, no level-event hooks).
const _SDF_BLEND_REACH = 135;  // sk * 3 with sk=45
function worldSDF(px,py,pz) {
  // (v12) Google Maps levels have no rooms/tunnels in the SDF arrays.
  // Returning the default 99999 reads as 'solid wall everywhere' which
  // (a) instantly kills every projectile and (b) pushes ships toward
  // some imaginary interior. Short-circuit to a large negative ('deeply
  // interior') so the whole world reads as open air. Tile-vs-entity
  // collision is handled separately by _lssGmapsTick raycasting against
  // the photoreal tile group.
  if (typeof _lssGmaps !== 'undefined' && _lssGmaps && _lssGmaps.active && !_lssGmaps.overlayOnly) return -10000;
  const sk = game.sdfSmoothK || 45;
  const blendReach = sk * 3;  // local in case sdfSmoothK overridden per round
  // 1) Room-only SDF (smooth blend between rooms)
  const spheres = game.levelSpheres || [];
  let roomD = 99999;
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const dx = px - s.cx, dy = py - s.cy, dz = pz - s.cz;
    const dist2 = dx*dx + dy*dy + dz*dz;
    // Skip if this sphere is too far to influence current roomD.
    // Want skip when sdSphere = sqrt(dist2) - s.r > roomD + blendReach
    // → dist2 > (roomD + blendReach + s.r)² (only valid when cutoff > 0).
    const cutoff = roomD + blendReach + s.r;
    if (cutoff > 0 && dist2 > cutoff * cutoff) continue;
    const sd = Math.sqrt(dist2) - s.r;
    roomD = sdfSmin(roomD, sd, sk);
  }
  // 2) Each tunnel blends with rooms (smooth junctions), but tunnels don't blend with each other
  const cylinders = game.levelCylinders || [];
  let d = roomD;
  for (let i = 0; i < cylinders.length; i++) {
    const c = cylinders[i];
    // Cache cylinder bounding sphere (midpoint + half-length + radius) on
    // the cylinder object on first touch. Game's level data is mutable but
    // these are derived constants ; safe to stash.
    if (c._bcx === undefined) {
      c._bcx = (c.ax + c.bx) * 0.5;
      c._bcy = (c.ay + c.by) * 0.5;
      c._bcz = (c.az + c.bz) * 0.5;
      const dax = c.bx - c.ax, day = c.by - c.ay, daz = c.bz - c.az;
      c._br = Math.sqrt(dax*dax + day*day + daz*daz) * 0.5 + c.r;
    }
    const dx = px - c._bcx, dy = py - c._bcy, dz = pz - c._bcz;
    const dist2 = dx*dx + dy*dy + dz*dz;
    // Same early-out logic as spheres, against the running d.
    const cutoff = d + blendReach + c._br;
    if (cutoff > 0 && dist2 > cutoff * cutoff) continue;
    const cd = sdCylinder(px,py,pz,c.ax,c.ay,c.az,c.bx,c.by,c.bz,c.r);
    d = Math.min(d, sdfSmin(roomD, cd, sk));
  }
  return d;
}

// SDF gradient (surface normal) via central differences
function sdfNormal(px,py,pz, out) {
  const e = 2.0;
  const nx = worldSDF(px+e,py,pz) - worldSDF(px-e,py,pz);
  const ny = worldSDF(px,py+e,pz) - worldSDF(px,py-e,pz);
  const nz = worldSDF(px,py,pz+e) - worldSDF(px,py,pz-e);
  const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
  // When an `out` vector is passed, write into it in place (no allocation).
  // Hot callers (resolveCollision) always pass one; legacy callers that still
  // call sdfNormal(x, y, z) keep their existing "new vector returned" contract.
  if (out) { out.set(nx/len, ny/len, nz/len); return out; }
  return new THREE.Vector3(nx/len, ny/len, nz/len);
}

// SDF ray marching: find where a ray hits the wall (SDF crosses from negative to positive)
function sdfRaycast(ox,oy,oz,dx,dy,dz,maxDist) {
  // Sphere tracing through the SDF; finds where ray exits playable space
  let t = 4.0; // start ahead to avoid self-hits near walls
  const MAX_STEPS = 80;
  let prevD = -999;
  for(let i=0;i<MAX_STEPS;i++){
    if(t>=maxDist) return maxDist;
    const px=ox+dx*t, py=oy+dy*t, pz=oz+dz*t;
    const d = worldSDF(px,py,pz);
    // Wall hit: SDF crossed from negative (inside) to positive (outside)
    if(d > 0 && prevD < 0) return t;
    // Also catch near-surface hits when SDF is very small positive
    if(d > 0 && d < 1.5) return t;
    prevD = d;
    // Step by |d| (sphere tracing) but enforce minimum step to avoid stalling
    const step = Math.max(Math.abs(d) * 0.85, 8.0);
    t += step;
  }
  return maxDist;
}


// ----- raycastLevel -----
function raycastLevel(origin, dir, maxDist) {
  // SDF ray march: no CSG awareness needed, the SDF handles junctions naturally
  let nearest = maxDist;
  // (v12) Google Maps mode: SDF is short-circuited (always interior),
  // so sdfRaycast can't find walls. Replace with a raycast against the
  // photoreal tile leaf meshes ; that's what makes projectiles, hitscan,
  // and AI line-of-sight respect real city geometry.
  if (typeof _lssGmaps !== 'undefined' && _lssGmaps && _lssGmaps.active && !_lssGmaps.overlayOnly) {
    const grp = _lssGmaps.tiles && _lssGmaps.tiles.group;
    if (grp && grp.children && grp.children.length > 0) {
      const meshes = _lssGmapsCollectLeaves(grp);
      if (meshes.length > 0) {
        _lssGmapsRaycaster.set(origin, dir);
        _lssGmapsRaycaster.far = maxDist;
        try {
          const hits = _lssGmapsRaycaster.intersectObjects(meshes, false);
          if (hits.length && hits[0].distance < nearest) nearest = hits[0].distance;
        } catch (_) {}
      }
    }
    return nearest;
  }

  // Still check obstacle boxes (if any exist in future)
  const idx = 1/dir.x, idy = 1/dir.y, idz = 1/dir.z;
  for (const box of game.levelBoxes) {
    const t1x = (box.min.x - origin.x) * idx, t1y = (box.min.y - origin.y) * idy, t1z = (box.min.z - origin.z) * idz;
    const t2x = (box.max.x - origin.x) * idx, t2y = (box.max.y - origin.y) * idy, t2z = (box.max.z - origin.z) * idz;
    const enter = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z));
    const exit = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
    if (enter < exit && enter > 0 && enter < nearest) nearest = enter;
  }

  // SDF ray march for sphere/cylinder walls
  const sdfHit = sdfRaycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, nearest);
  if (sdfHit < nearest) nearest = sdfHit;

  return nearest;
}

// Get wall surface normal at a point (for projectile bouncing)
function getWallNormal(point) {
  // SDF gradient gives the exact surface normal; no CSG hole detection needed
  const n = sdfNormal(point.x, point.y, point.z);
  // Negate because we want inward-facing normal (SDF gradient points outward)
  return n.negate();
}


// ----- selectMap / cycleMap -----
function selectMap(mapKey) {
  if (!MAP_DATA[mapKey]) return;
  // (v6.7) Echo guard: receivers re-call selectMap with the new key, which
  // would re-broadcast and bounce back. The early return when the key is
  // already selected stops the storm without needing a per-call suppress flag.
  if (game.selectedMap === mapKey) return;
  game.selectedMap = mapKey;
  const mapData = MAP_DATA[mapKey];

  const nameEl = document.getElementById('map-window-name');
  if (nameEl) nameEl.textContent = mapData.name;
  const descEl = document.getElementById('map-window-desc');
  if (descEl) descEl.textContent = mapData.description;

  // Active dot
  const dots = document.querySelectorAll('#map-indicator .map-dot');
  dots.forEach(d => d.classList.toggle('active', d.dataset.key === mapKey));

  // (v6.7) Pre-match map sync. Map can be changed by anyone in lobby /
  // ship-select; once the world is built (commitLoadout runs), changes affect
  // the next round only. The picker is hidden during gameplay, so no explicit
  // lock is needed beyond the existing UI gating.
  // (v12m) Tag along the typed gmaps overlay so peers stay in sync. If
  // game.pendingGmapsOverlay is set, peers will apply the same lat/lng.
  if (net.active && net.sendEvent) {
    const ov = game.pendingGmapsOverlay;
    net.sendEvent({
      type: 'map_change',
      mapKey,
      gmapsOverlay: ov ? { lat: ov.lat, lng: ov.lng, name: ov.name } : null,
      // (v13r) Tag along the current race-mode flag so peers stay in sync.
      mode: LSS.MODE || 'classic'
    });
  }
}

// Cycle to the prev (-1) or next (+1) map, wrapping at either end.
function cycleMap(dir) {
  // (v13r) Cycle only through maps eligible for the active mode.
  const keys = _visibleMapKeys();
  if (keys.length === 0) return;
  if (!game.selectedMap || !MAP_DATA[game.selectedMap] || keys.indexOf(game.selectedMap) === -1) {
    selectMap(keys[0]);
    return;
  }
  const idx = keys.indexOf(game.selectedMap);
  const next = ((idx + dir) % keys.length + keys.length) % keys.length;
  selectMap(keys[next]);
}


// ----- getNextMap / shuffleMapRotation -----
function getNextMap() {
  const selectedMapKey = game.selectedMap || 'hourglass';
  const mapData = MAP_DATA[selectedMapKey];
  if (!mapData) return MAP_DATA.hourglass;
  return mapData;
}
function shuffleMapRotation() {}


// ----- _cleanupOrphanWallMeshes (used by buildRoomGraphLevel) -----
// (v14) Robust orphan cleanup: walks the scene graph for anything
// tagged isWallMesh and not in keepList, removes from scene + disposes
// geometry. Defends against worker-race conditions and stale snapshots
// where game.mapMeshes loses track of a mesh that's still being rendered.
// Returns the number of orphans removed.
function _cleanupOrphanWallMeshes(keepList) {
  const keep = new Set(keepList || []);
  const toRemove = [];
  scene.traverse(function (n) {
    if (n && n.userData && n.userData.isWallMesh && !keep.has(n)) {
      toRemove.push(n);
    }
  });
  for (const m of toRemove) {
    try { if (m.parent) scene.remove(m); } catch (_) {}
    try { if (m.geometry) m.geometry.dispose(); } catch (_) {}
    // material is shared with potentially-still-live game.levelMaterial,
    // don't dispose it here.
  }
  return toRemove.length;
}


// ----- buildRoomGraphLevel -----
function buildRoomGraphLevel(level) {
  // (v14 round-2 fix) Pre-clean : nuke every wall mesh in the scene
  // AND clear game.mapMeshes BEFORE the gmaps-overlay IIFE has a chance
  // to capture a snapshot. The bug was that the IIFE's first sync check
  // sees the previous round's mesh still in mapMeshes, exits the wait
  // loop immediately, and snapshots that stale mesh as the 'thing to
  // preserve'. Then _lssGmapsBuildLevel clears the round-2 worker's new
  // mesh, the IIFE restores the round-1 leftover, and the user races
  // round 2 with round-1's mesh + a stale material that won't update on
  // P presses.
  // Clearing mapMeshes here means the IIFE's wait loop will block until
  // the new round's worker actually populates a mesh, then it'll
  // snapshot the correct one.
  try {
    _cleanupOrphanWallMeshes([]);
    if (Array.isArray(game.mapMeshes)) game.mapMeshes.length = 0;
    else game.mapMeshes = [];
  } catch (_) {}
  // (v12 patch31) Bump the build sequence so any in-flight overlay
  // IIFE from a prior call knows its captured state is stale and
  // can bail out instead of re-adding old wall meshes to the scene.
  game._buildSeq = (game._buildSeq | 0) + 1;
  // (v12m patch3) Stop any in-flight pivot-refine interval before we
  // start mutating level state. The previous round's refine ticks
  // would otherwise see momentarily-empty levelSpheres and shift
  // the tile group based on the default-extent fallback (0, 500),
  // sliding the city to the wrong place. New round's IIFE starts
  // its own refine interval at end of build with correct state.
  try {
    if (typeof _lssGmaps !== 'undefined' && _lssGmaps && _lssGmaps._refineInterval) {
      clearInterval(_lssGmaps._refineInterval);
      _lssGmaps._refineInterval = null;
    }
  } catch (_) {}
  // (v12) Google Maps levels skip the room / tunnel / SDF pipeline and
  // hand off to the gmaps build path, which streams Photorealistic 3D
  // Tiles from Google's Map Tiles API and spawns ships in open air.
  // Existing wall shader and corridor-AI code in this function would
  // produce zero geometry given empty rooms[]/tunnels[] arrays anyway,
  // but bailing here is faster and keeps that path readable.
  if (level && level.type === 'gmaps') {
    // (v12 patch20) If the user typed a location into DROP, override
    // the level's stored lat/lng with the freshly-typed one. Lets the
    // gmaps_user slot pick up new typed coords without needing to
    // regenerate the MAP_DATA entry every time.
    if (game.pendingGmapsOverlay) {
      level.lat = game.pendingGmapsOverlay.lat;
      level.lng = game.pendingGmapsOverlay.lng;
      if (game.pendingGmapsOverlay.name) level.name = game.pendingGmapsOverlay.name;
    }
    return _lssGmapsBuildLevel(level);
  }
  // (v12 patch22) Tunnel-map + typed-location = overlay. The standalone
  // overlay path (_lssGmapsAttachAtLatLng) silently failed to load tiles
  // even with the tile loader probe + always-on pulse. The build path
  // (_lssGmapsBuildLevel, used by Custom Location maps) DID load tiles.
  // So we route the overlay through the proven build path, wrapped in
  // save/restore of the tunnel SDF / corridor state that _lssGmapsBuildLevel
  // would otherwise clear. After the call we flip overlayOnly=true so
  // worldSDF / raycastLevel defer to the tunnel walls (SDF stays active
  // for combat collision).
  if (game.pendingGmapsOverlay) {
    const ov = game.pendingGmapsOverlay;
    // (v12 patch25) Wait for the marching-cubes worker to finish
    // building tunnel walls before snapshotting / overlay-building.
    // setTimeout(0) was firing before the worker callback ; mapMeshes
    // was empty when we saved it, the worker callback later added
    // walls but they were orphaned by the gmaps build's cleanup pass.
    (async () => {
      // Capture the build sequence at IIFE start. If it changes
      // before we get to the restore, we know a newer buildRoomGraphLevel
      // call has run and our save is stale ; abort instead of reattaching.
      const _mySeq = game._buildSeq | 0;
      const start = Date.now();
      while ((!game.mapMeshes || game.mapMeshes.length === 0) && (Date.now() - start) < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
      const wallCount = (game.mapMeshes && game.mapMeshes.length) || 0;
      console.log('[lss-gmaps] worker wait done : ' + wallCount + ' wall meshes after ' + (Date.now() - start) + 'ms');
      // Snapshot tunnel state.
      const _saveSpheres = game.levelSpheres;
      const _saveCyls    = game.levelCylinders;
      const _saveCPts    = game.corridorPoints;
      const _saveCurr    = game.currentLevel;
      const _saveWord    = game.mapWord;
      const _saveSdf     = game.sdfRoomData;
      const _saveBoxes   = game.levelBoxes;
      // (v12 patch24) Snapshot the wall meshes too. _lssGmapsBuildLevel
      // does scene.remove(m); game.mapMeshes = [] at the top, so without
      // this the tunnel walls would vanish from the scene and never
      // come back even though their SDF arrays were restored.
      const _saveMeshes = game.mapMeshes ? game.mapMeshes.slice() : [];
      try {
        await _lssGmapsBuildLevel({
          type: 'gmaps',
          name: ov.name || ('lat ' + ov.lat + ',' + ov.lng),
          lat:  ov.lat,
          lng:  ov.lng,
          scale: 1,
          rooms: [], tunnels: [],
        });
      } catch (e) {
        console.warn('[lss-gmaps] overlay (via build) failed:', e);
      }
      // (v12 patch31) Stale-seq check : if a newer build started while
      // we were awaiting _lssGmapsBuildLevel, the saved snapshot belongs
      // to the OLD map. Restoring would overwrite the new map's state
      // and re-add the old walls to the scene as a 'ghost'. Bail clean.
      if ((game._buildSeq | 0) !== _mySeq) {
        console.log('[lss-gmaps] overlay IIFE stale (seq ' + _mySeq + ' -> ' + (game._buildSeq|0) + ') ; abandoning restore.');
        return;
      }
      // Restore tunnel state ; the build path cleared it.
      game.levelSpheres   = _saveSpheres;
      game.levelCylinders = _saveCyls;
      game.corridorPoints = _saveCPts;
      game.currentLevel   = _saveCurr;
      game.mapWord        = _saveWord;
      game.sdfRoomData    = _saveSdf;
      game.levelBoxes     = _saveBoxes;
      // (v12 patch24) Re-attach the saved wall meshes to the scene
      // and restore the array. They were detached during the build
      // path's cleanup ; the meshes themselves and their material
      // are still alive (we kept the references), they just need
      // to be parented to the scene again.
      for (const m of _saveMeshes) {
        if (m && !m.parent) {
          try { scene.add(m); } catch(_) {}
        }
        // (v12 patch26) Higher renderOrder so walls draw AFTER tile
        // meshes (default renderOrder 0). At the floor where city
        // geometry and wall surface meet, this stops the per-pixel
        // z-fight that was making the inside read as 'torn up'.
        if (m) m.renderOrder = 2;
      }
      // (v14) Robust orphan cleanup. The gmaps-overlay round 1 -> round 2
      // flow can leave wall meshes in the scene that aren't in
      // game.mapMeshes (because _lssGmapsBuildLevel cleared mapMeshes
      // mid-flight, but worker callbacks added new meshes after, AND
      // a snapshot from the previous round may reference long-gone
      // meshes). _cleanupOrphanWallMeshes walks the scene graph by the
      // userData.isWallMesh tag and removes anything not in _saveMeshes.
      try {
        const removed = _cleanupOrphanWallMeshes(_saveMeshes);
        if (removed) {
          console.log('[lss-gmaps] scene-walk removed', removed, 'orphan wall meshes during overlay build.');
        }
      } catch (e) { console.warn('[lss-gmaps] orphan-mesh cleanup failed:', e); }
      game.mapMeshes = _saveMeshes;
      // Re-point game.levelMaterial at the snapshot's material so
      // setWallPattern updates the visible walls. Has to happen AFTER
      // the orphan cleanup (so we don't re-point at a doomed material)
      // and AFTER the overwrite (so any later worker race that touches
      // game.levelMaterial doesn't fight this).
      try {
        const liveMat = (_saveMeshes[0] && _saveMeshes[0].material) || null;
        if (liveMat && game.levelMaterial !== liveMat) {
          game.levelMaterial = liveMat;
          console.log('[lss-gmaps] re-pointed game.levelMaterial at snapshot mesh material.');
        }
      } catch (_) {}
      console.log('[lss-gmaps] re-attached', _saveMeshes.length, 'wall meshes after overlay build.');
      // Flip overlay flag so SDF / raycastLevel use the tunnel walls
      // instead of the gmaps short-circuit. Combat continues to behave
      // like a normal tunnel match ; tiles are scenery only.
      _lssGmaps.overlayOnly = true;
      console.log('[lss-gmaps] overlay attached via build path ; tunnel SDF preserved.');
      // (v12 patch29) Continuous refine for ~20 s after attach. Two
      // fixed setTimeouts (3.5 s + 9 s) missed cases where round-2
      // tile loads were either nearly-instant (cache hit ; refine
      // fired before transform settled) or slow (refine fired
      // before tiles loaded). 1 Hz polling for 20 s covers both.
      // Stored on _lssGmaps so detach/cleanup can stop it.
      try { if (_lssGmaps._refineInterval) clearInterval(_lssGmaps._refineInterval); } catch(_) {}
      let _refineCount = 0;
      _lssGmaps._refineInterval = setInterval(() => {
        try { _lssGmapsRefinePivot(); } catch(_) {}
        _refineCount++;
        if (_refineCount >= 20) {
          try { clearInterval(_lssGmaps._refineInterval); } catch(_) {}
          _lssGmaps._refineInterval = null;
        }
      }, 1000);
      // Also try an immediate refine in case tiles came from cache
      // and are already populated by the time we got here.
      try { _lssGmapsRefinePivot(); } catch(_) {}
    })();
  } else if (_lssGmaps && _lssGmaps.cleanup) {
    // No pending overlay ; tear down any leftover from a previous match.
    try { _lssGmaps.cleanup(); } catch (_) {}
    _lssGmaps.cleanup = null; _lssGmaps.active = false;
  }
  // Nuke old geometry
  for (const m of game.mapMeshes) { if (m.parent) scene.remove(m); }
  game.mapMeshes = [];
  game.levelBoxes = [];
  game.levelSpheres = [];
  game.levelCylinders = [];
  game.corridorPoints = [];
  game.currentLevel = level;
  game.mapWord = level.name;
  // Minimap caches its extent from the sphere/cylinder arrays; invalidate here
  // so the next updateMinimap() recomputes against the fresh geometry.
  if (typeof invalidateMinimapExtent === 'function') invalidateMinimapExtent();

  // Terminate old worker if still running
  if (game.levelWorker && game.levelWorkerCallbacks.length > 0) {
    game.levelWorkerCallbacks = [];
  }

  // --- READ ROOMS AND TUNNELS FROM LEVEL DATA ---
  const rooms = level.rooms;
  const tunnels = level.tunnels;
  const TR = SU * 1.2; // default tunnel radius (handcrafted maps)

  // --- PRE-COMPUTE CYLINDER SEGMENTS ---
  const cylSegs = [];
  for (const tun of tunnels) {
    const tunR = tun.r || TR; // per-tunnel radius override, or default
    for (let p = 0; p < tun.path.length - 1; p++) {
      const a = tun.path[p], b = tun.path[p + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 10) cylSegs.push({ a, b, dx, dy, dz, len, r: tunR });
    }
  }

  // --- POPULATE SDF DATA (must happen BEFORE marching cubes) ---
  game.sdfSmoothK = 45;
  for (const rm of rooms) {
    game.levelSpheres.push({ cx: rm.x, cy: rm.y, cz: rm.z, r: rm.r });
  }
  for (const seg of cylSegs) {
    game.levelCylinders.push({ ax: seg.a.x, ay: seg.a.y, az: seg.a.z, bx: seg.b.x, by: seg.b.y, bz: seg.b.z, r: seg.r });
  }
  game.sdfRoomData = rooms;

  // --- (v13r) BUILD RACE GRAPH ---
  // Each room becomes a node. Each tunnel becomes an edge between the two
  // rooms that contain its endpoints (start of path and end of path), if any.
  // Used by race-mode bot navigation to BFS toward the champion-flagged room.
  // Rebuilt every level load so a fresh map yields a fresh graph.
  (function _buildRaceGraph() {
    const nodes = {};
    for (const rm of rooms) {
      nodes[rm.id] = {
        id: rm.id, x: rm.x, y: rm.y, z: rm.z, r: rm.r,
        team: rm.team || null,
        champion: !!rm.champion,
        neighbors: []
      };
    }
    function roomContaining(pt) {
      let best = null, bestD = Infinity;
      for (const rm of rooms) {
        const dx = pt.x - rm.x, dy = pt.y - rm.y, dz = pt.z - rm.z;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 <= rm.r * rm.r && d2 < bestD) { best = rm; bestD = d2; }
      }
      return best;
    }
    for (const tun of tunnels) {
      const path = tun.path;
      if (!path || path.length < 2) continue;
      const startPt = path[0], endPt = path[path.length - 1];
      const a = roomContaining(startPt);
      const b = roomContaining(endPt);
      if (!a || !b || a.id === b.id) continue;
      // Midpoint as a steering hint (the geometric heart of the corridor).
      const midIdx = Math.floor(path.length / 2);
      const mid = path[midIdx];
      const na = nodes[a.id], nb = nodes[b.id];
      if (!na.neighbors.find(n => n.id === b.id)) {
        na.neighbors.push({ id: b.id, mid: { x: mid.x, y: mid.y, z: mid.z } });
      }
      if (!nb.neighbors.find(n => n.id === a.id)) {
        nb.neighbors.push({ id: a.id, mid: { x: mid.x, y: mid.y, z: mid.z } });
      }
    }
    // Find the champion-flagged room as the BFS target.
    let finishId = null;
    for (const id in nodes) { if (nodes[id].champion) { finishId = id; break; } }
    game.raceGraph = { nodes, finishId };
  })();

  // --- GENERATE CORRIDOR POINTS (for spawning, bot navigation, dynamic object placement) ---
  // Sample points inside rooms (tagged with team)
  for (const rm of rooms) {
    const numPts = Math.max(8, Math.floor(rm.r / 30));
    for (let i = 0; i < numPts; i++) {
      // Random point inside sphere
      const u = Math.random(), v = Math.random(), theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      const rr = rm.r * 0.7 * Math.cbrt(Math.random());
      game.corridorPoints.push({
        x: rm.x + rr * Math.sin(phi) * Math.cos(theta),
        y: rm.y + rr * Math.sin(phi) * Math.sin(theta),
        z: rm.z + rr * Math.cos(phi),
        team: rm.team || null,
        roomType: 'room',
        roomId: rm.id
      });
    }
  }
  // Sample points along tunnels
  for (const seg of cylSegs) {
    const len = seg.len;
    const steps = Math.max(3, Math.floor(len / 80));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      game.corridorPoints.push({
        x: seg.a.x + seg.dx * t + (Math.random() - 0.5) * seg.r * 0.4,
        y: seg.a.y + seg.dy * t + (Math.random() - 0.5) * seg.r * 0.4,
        z: seg.a.z + seg.dz * t + (Math.random() - 0.5) * seg.r * 0.4,
        team: null,
        roomType: 'tunnel'
      });
    }
  }

  // --- COMPUTE BOUNDS ---
  let bMinX=Infinity,bMinY=Infinity,bMinZ=Infinity;
  let bMaxX=-Infinity,bMaxY=-Infinity,bMaxZ=-Infinity;
  const pad = 50;
  for(const rm of rooms){
    bMinX=Math.min(bMinX,rm.x-rm.r-pad);bMaxX=Math.max(bMaxX,rm.x+rm.r+pad);
    bMinY=Math.min(bMinY,rm.y-rm.r-pad);bMaxY=Math.max(bMaxY,rm.y+rm.r+pad);
    bMinZ=Math.min(bMinZ,rm.z-rm.r-pad);bMaxZ=Math.max(bMaxZ,rm.z+rm.r+pad);
  }
  for(const seg of cylSegs){
    const sr = TR + pad;
    bMinX=Math.min(bMinX,seg.a.x-sr,seg.b.x-sr);bMaxX=Math.max(bMaxX,seg.a.x+sr,seg.b.x+sr);
    bMinY=Math.min(bMinY,seg.a.y-sr,seg.b.y-sr);bMaxY=Math.max(bMaxY,seg.a.y+sr,seg.b.y+sr);
    bMinZ=Math.min(bMinZ,seg.a.z-sr,seg.b.z-sr);bMaxZ=Math.max(bMaxZ,seg.a.z+sr,seg.b.z+sr);
  }
  const bounds={minX:bMinX,minY:bMinY,minZ:bMinZ,maxX:bMaxX,maxY:bMaxY,maxZ:bMaxZ};

  // Show loading UI
  const mapGenHud = document.getElementById('map-gen-hud');
  if (mapGenHud) {
    mapGenHud.textContent = 'GENERATING MAP...';
    mapGenHud.style.display = 'block';
  }

  // Marching cubes tables (same as worker)
  const mcEdgeTable = new Uint16Array([/* 256-entry MC edge table (omitted for brevity; identical to worker copy) */]);
  const mcTriTable = [/* 256-entry MC tri table (omitted for brevity; identical to worker copy) */];
  const mcEdgeVerts=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];


  // ----- createMeshFromPositions (nested inside buildRoomGraphLevel) -----
  function createMeshFromPositions(posArray, gridRes) {
    const levelGeo = new THREE.BufferGeometry();
    levelGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    levelGeo.computeVertexNormals();

    // Wall shader -- VERTEX program (kept for completeness; fragment shader omitted as requested).
    const sdfVertSrc = [
      'varying vec3 vWorldPos;',
      'varying vec3 vNormal;',
      'varying float vAO;',
      'void main() {',
      '  vec4 wp = modelMatrix * vec4(position, 1.0);',
      '  vWorldPos = wp.xyz;',
      '  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);',
      '  vec3 upVec = vec3(0.0, 1.0, 0.0);',
      '  float normalUpDot = dot(vNormal, upVec);',
      '  float aoFromNormal = 0.85 + normalUpDot * 0.15;',
      '  vAO = clamp(aoFromNormal, 0.7, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n');

    // Wall fragment shader (sdfFragSrc) -- OMITTED PER REQUEST.
    // (Original is a multi-pattern cosmic / kali-IFS / Soul Array shader,
    // assembled with `].join('\n');` like the vertex shader above.)
    const sdfFragSrc = /* OMITTED */ '';

    // Dynamic room uniforms (pad to 8 elements for shader array).
    // (v6.7+) ALL eight room slots now share the same wall color rather than
    // each carrying its own palette entry. Each map's palette[0] supplies the
    // BASE HUE for that map's overall identity ; everything else is the same
    // value on every slot. The base hue is drifted through the full spectrum
    // each frame inside gameLoop (see HUE_PERIOD below), so the whole map
    // slowly rotates through the color wheel as the round progresses.
    // legacy: palette[1..7] are no longer read by the wall shader. They're
    // kept on the map definitions in case we want to re-enable per-room
    // palettes later, but they have no current effect.
    const defaultPalette = [
      0x1a3050, 0x3a1010, 0x103a10, 0x351828, 0x183520, 0x2a2040, 0x1a4030, 0x402020
    ];
    const roomPalette = (level && Array.isArray(level.palette) && level.palette.length > 0)
      ? level.palette
      : defaultPalette;
    // Palette brightness boost: lifts the source palette before the shader's
    // dark-tint and AO collapse it. Tweak to globally brighten/darken walls.
    const PALETTE_BOOST = 1.80;
    // Stash the base hue/sat/lit components on the game so gameLoop can
    // hue-rotate the wall each frame without re-deriving from the hex source.
    const baseCol = new THREE.Color(roomPalette[0]);
    const baseHsl = { h: 0, s: 0, l: 0 };
    baseCol.getHSL(baseHsl);
    game.wallBaseHue = baseHsl.h;     // base hue for this map (rotates around the wheel)
    game.wallBaseSat = baseHsl.s;
    game.wallBaseLit = baseHsl.l;
    game.wallPaletteBoost = PALETTE_BOOST;
    const numRooms = Math.min(game.sdfRoomData.length, 8);
    const roomCentersArr = [];
    const roomColorsArr = [];
    const roomRadiiArr = [];
    // (post-v6.9 patch, 2026-04-28) Per-room palette differentiation. Each
    // wall-shader slot now pulls a distinct hue from level.palette so each
    // o has its own color identity, instead of all 8 slots cloning palette[0].
    // The legacy comment near roomPalette explained that palette[1..7] were
    // "no longer read by the wall shader" but kept on the map definitions
    // "in case we want to re-enable per-room palettes later"; this patch is
    // exactly that re-enable. Per-slot base HSL is stashed on game.wallRoomBaseHues
    // so gameLoop can drift each room around its own hue while keeping the
    // shared time offset that rotates the whole map through the spectrum.
    game.wallRoomBaseHues = [];
    const _slotHslTmp = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < 8; i++) {
      if (i < numRooms) {
        const r = game.sdfRoomData[i];
        roomCentersArr.push(new THREE.Vector3(r.x, r.y, r.z));
        const slotCol = new THREE.Color(roomPalette[i % roomPalette.length]);
        slotCol.getHSL(_slotHslTmp);
        game.wallRoomBaseHues.push({ h: _slotHslTmp.h, s: _slotHslTmp.s, l: _slotHslTmp.l });
        const startCol = new THREE.Color(
          Math.min(1.0, slotCol.r * PALETTE_BOOST),
          Math.min(1.0, slotCol.g * PALETTE_BOOST),
          Math.min(1.0, slotCol.b * PALETTE_BOOST)
        );
        roomColorsArr.push(startCol);
        roomRadiiArr.push(r.r);
      } else {
        roomCentersArr.push(new THREE.Vector3(0, 99999, 0));
        roomColorsArr.push(new THREE.Color(0x000000));
        roomRadiiArr.push(0);
        // Empty slot: parked hue so gameLoop's drift loop has a defined entry.
        game.wallRoomBaseHues.push({ h: 0, s: 0, l: 0 });
      }
    }

    // Wall pattern: 0..7 are lab cosmic patterns, 8 is the Soul Array.
    // game.wallPattern is loaded from localStorage by loadSettings(); seed it
    // here in case the shader is built before settings have been read.
    // (v14e) Default to Tile Track (31) instead of pattern 0 so the curated
    // look is what new players see on first load.
    if (typeof game.wallPattern !== 'number') game.wallPattern = 31;
    // Pure Black Base is on by default: wall geometry hides, only the active
    // pattern reads against pure black. User can toggle off in Settings.
    if (typeof game.wallBlackBase !== 'boolean') game.wallBlackBase = true;
    if (!game.wallParams) game.wallParams = {};
    // Pull current values out of the central params table (with defaults) so
    // every uniform has a known starting value.
    const wp = applyWallParamDefaults(game.wallParams);
    // (v16a Potato) Branch on QUALITY here so the procedural Kali-IFS wall
    // shader (multi-layer cosmic composite + AO + fresnel + zone tint + palette
    // drift) is never compiled in Potato mode. The MeshBasicMaterial swap
    // removes the dominant per-fragment cost on no-GPU laptops while still
    // showing the level geometry, transparency, and double-sided walls.
    // Downstream code that touches game.levelMaterial.uniforms already
    // checks .uniforms first (pushWallParamsToUniforms, applyMultiLayerPreset,
    // setWallPattern, wallOpacity sliders) so this is safe ; the one gameLoop
    // uniform write at the bottom of this file is also guarded for v16a.
    let sdfMat;
    if (typeof QUALITY !== 'undefined' && QUALITY.isPotato && QUALITY.isPotato()) {
      // (v16a Potato depth fix) The first Potato wall material rendered every
      // face at the same unlit color ; reads as a flat silhouette because
      // MeshBasicMaterial ignores all lights and faces share a single color.
      // The walls had no sense of "you are inside a room". Fix : bake
      // per-vertex colors onto levelGeo using the vertex normals (faces with
      // normal pointing UP are brighter, faces pointing DOWN are darker,
      // approximating a soft top-down sun) and the nearest-room palette so
      // each chamber gets its own tint. This is a one-time cost at level
      // build ; per-frame cost is zero ; runs through the cheapest possible
      // MeshBasicMaterial(vertexColors: true) path.
      const _vertCount = (levelGeo.attributes.position && levelGeo.attributes.position.count) || 0;
      const _positions = levelGeo.attributes.position ? levelGeo.attributes.position.array : null;
      const _normals = levelGeo.attributes.normal ? levelGeo.attributes.normal.array : null;
      // Brighten each palette color the same way we brightened the single
      // color in the previous pass : floor lightness 0.35, cap saturation
      // 0.45. Pre-allocates an 8-slot palette aligned with roomCentersArr.
      const _brightPalette = [];
      const _hslTmp = { h: 0, s: 0, l: 0 };
      for (let i = 0; i < 8; i++) {
        const src = (roomColorsArr && roomColorsArr[i]) ? roomColorsArr[i] : null;
        const c = src ? src.clone() : new THREE.Color(0x556677);
        c.getHSL(_hslTmp);
        const lift = Math.max(0.35, Math.min(0.65, _hslTmp.l + 0.18));
        const sat  = Math.min(0.45, _hslTmp.s);
        c.setHSL(_hslTmp.h, sat, lift);
        _brightPalette.push(c);
      }
      const _colorAttr = new Float32Array(_vertCount * 3);
      if (_positions && _vertCount > 0) {
        const _rcLen = Math.min(8, (roomCentersArr && roomCentersArr.length) || 0);
        for (let i = 0; i < _vertCount; i++) {
          const px = _positions[i * 3];
          const py = _positions[i * 3 + 1];
          const pz = _positions[i * 3 + 2];
          // Pick nearest room center ; use squared distance, no sqrt.
          let nearest = 0;
          let nearestD2 = Infinity;
          for (let j = 0; j < _rcLen; j++) {
            const rc = roomCentersArr[j];
            const dx = px - rc.x, dy = py - rc.y, dz = pz - rc.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < nearestD2) { nearestD2 = d2; nearest = j; }
          }
          const base = _brightPalette[nearest] || _brightPalette[0];
          // Normal-based shade : ny in [-1, 1] -> shade in [0.55, 1.10].
          // Up-facing (ceiling, ny ~ -1 when viewed from inside) is dim ;
          // down-facing (floor) is bright. Bias toward the brighter half so
          // the rooms don't read as caves.
          let shade = 1.0;
          if (_normals) {
            const ny = _normals[i * 3 + 1];
            // Inside-the-room interior face shading : the wall's outward
            // normal generally points away from the room center, so a
            // floor's normal is +Y (bright) and a ceiling's is -Y (dim).
            shade = 0.65 + (ny + 1.0) * 0.225; // ny=-1 -> 0.65 ; ny=+1 -> 1.10
            if (shade > 1.0) shade = 1.0;
          }
          _colorAttr[i * 3]     = Math.min(1, base.r * shade);
          _colorAttr[i * 3 + 1] = Math.min(1, base.g * shade);
          _colorAttr[i * 3 + 2] = Math.min(1, base.b * shade);
        }
      }
      levelGeo.setAttribute('color', new THREE.BufferAttribute(_colorAttr, 3));

      const _wallOpacity = (typeof game.wallOpacity === 'number') ? game.wallOpacity : 1.0;
      const _wallTransparent = _wallOpacity < 0.999;
      // (webgpu port) Upgraded to MeshStandardMaterial so walls catch the
      // scene lights + dynamic light pool (muzzle flashes, explosions).
      // Still WebGPU-safe ; the BackSide cull keeps interior wall rendering
      // exactly as it would with MeshBasicMaterial.
      sdfMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        transparent: _wallTransparent,
        depthWrite: true,
        opacity: _wallOpacity,
        roughness: 0.7,
        metalness: 0.15,
        emissive: 0x000000,
        emissiveIntensity: 0.0,
        // Emissive vertex colors are not standard ; instead we let the
        // baked vertex colors act as the diffuse and lights modulate them.
      });
      // Tag so later code can tell at a glance this isn't the shader path.
      sdfMat.userData = { isPotatoWallMat: true };
    } else {
    sdfMat = new THREE.ShaderMaterial({
      vertexShader: sdfVertSrc,
      fragmentShader: sdfFragSrc,   // (OMITTED)
      // (v16a Phase X) BackSide so the carved-out shell only draws from inside.
      side: THREE.BackSide,
      transparent: true,
      depthWrite: true,
      uniforms: {
        time: { value: 0 },
        roomCenters: { value: roomCentersArr },
        roomColorsU: { value: roomColorsArr },
        roomRadii: { value: roomRadiiArr },
        roomCount: { value: numRooms },
        uCompositeTint: { value: new THREE.Vector3(0.5, 0.6, 0.85) },
        uPattern:   { value: 21 },
        uBlackBase: { value: 1 },
        uOpacity:   { value: (typeof game.wallOpacity === 'number') ? game.wallOpacity : 1.0 },
        // ---- Wall constants ----
        K_DARK_BASE:         { value: new THREE.Vector3(wp.K_DARK_BASE_R, wp.K_DARK_BASE_G, wp.K_DARK_BASE_B) },
        K_ZONE_TINT:         { value: wp.K_ZONE_TINT },
        K_COSMIC_BRIGHTNESS: { value: 1.0 },
        K_FRESNEL_STRENGTH:  { value: wp.K_FRESNEL_STRENGTH },
        K_DIFF_MIN:          { value: wp.K_DIFF_MIN },
        K_AO_FLOOR:          { value: wp.K_AO_FLOOR },
        K_FLOOR:             { value: wp.K_FLOOR },
        // ---- Pattern math (shared) ----
        u_rings:    { value: wp.u_rings | 0 },
        u_rotSpeed: { value: wp.u_rotSpeed },
        u_off:      { value: new THREE.Vector3(wp.u_off_x, wp.u_off_y, wp.u_off_z) },
        u_valDiv:   { value: wp.u_valDiv },
        // ---- Multi-layer composite (BG / FG1 / FG2) ----
        bgPatternId:   { value: 15 },
        u_iters_bg:    { value: 1 },
        u_scale_bg:    { value: 0.0019 },
        u_invBase_bg:  { value: 2 },
        u_hueSpin_bg:  { value: 0 },
        u_satBase_bg:  { value: 1 },
        K_COSMIC_bg:   { value: 0.2 },
        fgPatternId:   { value: 17 },
        fgAlpha:       { value: 2 },
        fgBlend:       { value: 1 },
        fgHue:         { value: 0 },
        fgTime:        { value: 1 },
        bgTime:        { value: 1 },
        u_iters_fg:    { value: 3 },
        u_scale_fg:    { value: 0.0011 },
        u_invBase_fg:  { value: 9 },
        u_hueSpin_fg:  { value: 0 },
        u_satBase_fg:  { value: 0 },
        K_COSMIC_fg:   { value: 6 },
        fg2PatternId:  { value: 17 },
        fg2Alpha:      { value: 0.8 },
        fg2Blend:      { value: 1 },
        fg2Hue:        { value: 0 },
        fg2Time:       { value: 0 },
        u_iters_fg2:   { value: 8 },
        u_scale_fg2:   { value: 0.0035 },
        u_invBase_fg2: { value: 9 },
        u_hueSpin_fg2: { value: 0.12 },
        u_satBase_fg2: { value: 0.7 },
        K_COSMIC_fg2:  { value: 6 },
        // ---- Texture layer (v14) ----
        uWallTex:      { value: (function(){
          if (typeof THREE === 'undefined') return null;
          const c = document.createElement('canvas'); c.width = c.height = 1;
          const cx = c.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 1, 1);
          const t = new THREE.CanvasTexture(c);
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
          return t;
        })() },
        texBlend:      { value: -1 },
        texAlpha:      { value: 1.0 },
        texHue:        { value: 0.0 },
        texScale:      { value: 0.005 },
        texBrightness: { value: 1.0 },
        // ---- Solo single-pattern controls ----
        u_iters_solo:    { value: 9 },
        u_scale_solo:    { value: 0.0028 },
        u_invBase_solo:  { value: 8.1 },
        u_hueSpin_solo:  { value: 0.28 },
        u_satBase_solo:  { value: 0.75 },
        // ---- Soul Array ----
        SA_CELL_SIZE:      { value: wp.SA_CELL_SIZE },
        SA_DOT_RADIUS:     { value: wp.SA_DOT_RADIUS },
        SA_DOT_DEPTH_TOL:  { value: wp.SA_DOT_DEPTH_TOL },
        SA_WAVE_SPEED:     { value: wp.SA_WAVE_SPEED },
        SA_WAVE_PERIOD:    { value: wp.SA_WAVE_PERIOD },
        SA_WAVE_SHARPNESS: { value: wp.SA_WAVE_SHARPNESS },
        SA_BASE_DOT:       { value: wp.SA_BASE_DOT },
        SA_WAVE_PEAK:      { value: wp.SA_WAVE_PEAK },
        SA_BREATH_AMP:     { value: wp.SA_BREATH_AMP },
        SA_BREATH_RATE:    { value: wp.SA_BREATH_RATE },
        SA_DOT_SAT:        { value: wp.SA_DOT_SAT },
        SA_ZONE_FLOOR:     { value: wp.SA_ZONE_FLOOR }
      }
    });
    }  // (v16a Potato) end of else (full ShaderMaterial path)

    game.levelMaterial = sdfMat;

    // (v8VR 2026-05-01 fix) The wall material's per-layer uniforms are
    // initialized as Lab Composite. When the boot default is a different
    // multi-layer preset (e.g. Digital = 21), pushWallParamsToUniforms is
    // called earlier in loadSettings BEFORE game.levelMaterial exists, so the
    // applyMultiLayerPreset call inside it short-circuits. Call it explicitly
    // here so the active multi-layer preset's per-layer values land on the
    // freshly-built material before its first frame.
    if (typeof applyMultiLayerPreset === 'function') {
      applyMultiLayerPreset((game.wallPattern | 0) % WALL_PATTERN_NAMES.length);
    }
    // (v16a Phase Z) Same bug for SOLO single-pattern presets. Push here so
    // the first frame is correct.
    if (typeof pushWallParamsToUniforms === 'function') {
      pushWallParamsToUniforms();
    }

    const mesh = new THREE.Mesh(levelGeo, sdfMat);
    // (v14) Tag every wall mesh so scene-walk cleanup can identify it.
    mesh.userData = mesh.userData || {};
    mesh.userData.isWallMesh = true;
    scene.add(mesh);
    game.mapMeshes.push(mesh);

    // (v16a Phase Y) Depth-only wall occluder. Solves the "I can still see
    // ships through transparent walls" leak by writing wall depth in the
    // OPAQUE pass BEFORE any ship draws.
    const occluderMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const occluderMesh = new THREE.Mesh(levelGeo, occluderMat);
    occluderMesh.renderOrder = -1;
    occluderMesh.userData = { isWallMesh: true, isWallOccluder: true };
    // (v16a Phase Y) Skip raycasts on the occluder.
    occluderMesh.raycast = function () {};
    scene.add(occluderMesh);
    game.mapMeshes.push(occluderMesh);
    return mesh;
  }

  // ----- Marching-cubes worker handoff (low-res then high-res) -----
  // Worker available and enabled
  if (game.levelWorker && typeof(game.levelWorker) !== 'string') {
    // Dispatch low-res job first (gridRes=48)
    game.levelWorker.onmessage = (e) => {
      const {gridRes, positions} = e.data;

      if (gridRes === 48) {
        const lowResMesh = createMeshFromPositions(positions, 48);
        // Dispatch high-res job (gridRes=96)
        game.levelWorker.postMessage({bounds, gridRes: 96, spheres: game.levelSpheres, cylinders: game.levelCylinders, smoothK: game.sdfSmoothK});
      } else if (gridRes === 96) {
        // Remove low-res, add high-res.
        // (v16a Phase Y) createMeshFromPositions now adds TWO meshes per
        // call (visual + depth-only occluder), so clean out ALL existing
        // wall meshes here instead of only index 0.
        while (game.mapMeshes.length > 0) {
          const oldMesh = game.mapMeshes.shift();
          if (oldMesh && oldMesh.parent) scene.remove(oldMesh);
        }
        createMeshFromPositions(positions, 96);
        // Hide loading UI
        if (mapGenHud) mapGenHud.style.display = 'none';
      }
    };

    // Start with low-res
    game.levelWorker.postMessage({bounds, gridRes: 48, spheres: game.levelSpheres, cylinders: game.levelCylinders, smoothK: game.sdfSmoothK});
  } else {
    // Fallback: synchronous marching cubes (no worker)
    const gridRes = 96;
    const nx=gridRes,ny=gridRes,nz=gridRes;
    const dx=(bounds.maxX-bounds.minX)/nx;
    const dy=(bounds.maxY-bounds.minY)/ny;
    const dz=(bounds.maxZ-bounds.minZ)/nz;

    const vals=new Float32Array((nx+1)*(ny+1)*(nz+1));
    const gi=(i,j,k)=>i+(nx+1)*(j+(ny+1)*k);
    for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      vals[gi(i,j,k)]=worldSDF(bounds.minX+i*dx,bounds.minY+j*dy,bounds.minZ+k*dz);
    }

    function mcInterp(i1,j1,k1,i2,j2,k2){
      const v1=vals[gi(i1,j1,k1)],v2=vals[gi(i2,j2,k2)];
      if(Math.abs(v1)<0.00001)return[bounds.minX+i1*dx,bounds.minY+j1*dy,bounds.minZ+k1*dz];
      if(Math.abs(v2)<0.00001)return[bounds.minX+i2*dx,bounds.minY+j2*dy,bounds.minZ+k2*dz];
      if(Math.abs(v1-v2)<0.00001)return[bounds.minX+i1*dx,bounds.minY+j1*dy,bounds.minZ+k1*dz];
      const t=v1/(v1-v2);
      return[bounds.minX+(i1+t*(i2-i1))*dx,bounds.minY+(j1+t*(j2-j1))*dy,bounds.minZ+(k1+t*(k2-k1))*dz];
    }

    const positions=[];
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const v=[vals[gi(i,j,k)],vals[gi(i+1,j,k)],vals[gi(i+1,j+1,k)],vals[gi(i,j+1,k)],vals[gi(i,j,k+1)],vals[gi(i+1,j,k+1)],vals[gi(i+1,j+1,k+1)],vals[gi(i,j+1,k+1)]];
      let cubeIdx=0;
      for(let c=0;c<8;c++)if(v[c]<0)cubeIdx|=(1<<c);
      if(mcEdgeTable[cubeIdx]===0)continue;
      const ci=[i,i+1,i+1,i,i,i+1,i+1,i];
      const cj=[j,j,j+1,j+1,j,j,j+1,j+1];
      const ck=[k,k,k,k,k+1,k+1,k+1,k+1];
      const ev=new Array(12);
      for(let e=0;e<12;e++){
        if(mcEdgeTable[cubeIdx]&(1<<e)){
          const[a,b]=mcEdgeVerts[e];
          ev[e]=mcInterp(ci[a],cj[a],ck[a],ci[b],cj[b],ck[b]);
        }
      }
      const tris=mcTriTable[cubeIdx];
      for(let t=0;t<tris.length;t+=3){
        if(tris[t]===-1)break;
        const a=ev[tris[t]],b=ev[tris[t+1]],c=ev[tris[t+2]];
        if(a&&b&&c){positions.push(a[0],a[1],a[2],c[0],c[1],c[2],b[0],b[1],b[2]);}
      }
    }

    const posArray = new Float32Array(positions);
    createMeshFromPositions(posArray, gridRes);
    if (mapGenHud) mapGenHud.style.display = 'none';
  }
}


// ----- getValidSpawnPoint -----
// ---- SPAWN HELPERS ----
// Returns a random position guaranteed to be inside a room.
function getValidSpawnPoint(team, spread) {
  spread = spread || 80;
  const pts = game.corridorPoints;
  if (!pts || pts.length === 0) return new THREE.Vector3(0, 0, 0);

  let pool = pts;
  if (team === 'A') {
    pool = pts.filter(p => p.team === 'A');
    if (pool.length === 0) pool = pts.filter(p => p.x < 0).sort((a, b) => a.x - b.x).slice(0, Math.max(10, Math.floor(pts.length * 0.2)));
    if (pool.length === 0) pool = pts.slice(0, Math.max(1, Math.floor(pts.length * 0.25)));
  } else if (team === 'B') {
    pool = pts.filter(p => p.team === 'B');
    if (pool.length === 0) pool = pts.filter(p => p.x > 0).sort((a, b) => b.x - a.x).slice(0, Math.max(10, Math.floor(pts.length * 0.2)));
    if (pool.length === 0) pool = pts.slice(Math.floor(pts.length * 0.75));
  }

  const base = pool[Math.floor(Math.random() * pool.length)];
  return new THREE.Vector3(
    base.x + (Math.random() - 0.5) * spread,
    base.y + (Math.random() - 0.5) * spread,
    base.z + (Math.random() - 0.5) * spread
  );
}


// ----- spawnDynamicObjects (clusters in rooms + tunnels) -----
function spawnDynamicObjects(rooms) {
  // (v15a 2026-05-10 BCS slot leak fix) Dispose every cluster child's
  // _atomSmoke GasCloud before we drop the cluster references. Previously
  // we only removed the scene mesh ; the gasCloud object got orphaned
  // with its BCS slots still marked "in use". After a couple of rounds
  // the slot pool (4096 slots) leaked enough that new clouds couldn't
  // acquire slots → new gas clouds had no visible sprites and looked
  // completely unreactive even though their physics still ran.
  if (game.clusters) {
    for (const cluster of game.clusters) {
      if (!cluster || !cluster.children) continue;
      for (const ch of cluster.children) {
        if (ch && ch._atomSmoke && typeof ch._atomSmoke.dispose === 'function') {
          ch._atomSmoke.dispose();
          ch._atomSmoke = null;
        }
      }
    }
  }
  // Tear down existing cluster children and any standalone debris
  for (const obj of game.dynamicObjects) {
    if (obj.mesh && obj.mesh.parent) scene.remove(obj.mesh);
    if (obj.edgeMesh && obj.edgeMesh.parent) scene.remove(obj.edgeMesh);
  }
  game.dynamicObjects = [];
  game.clusters = [];
  // (v14d Phase 4) Wipe detached gas pockets when the world is rebuilt.
  if (typeof disposeAllDetachedGasPockets === 'function') disposeAllDetachedGasPockets();

  // Place cluster obstacles in non-spawn rooms (center, flanking, etc.)
  const nonSpawnRooms = rooms.filter(r => !r.team);
  for (const rm of nonSpawnRooms) {
    const count = 2 + Math.floor(Math.random() * 2); // 2-3 clusters per room
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = rm.r * (0.15 + Math.random() * 0.45);
      const yOff = (Math.random() - 0.5) * rm.r * 0.6;
      const pos = new THREE.Vector3(
        rm.x + Math.cos(angle) * dist,
        rm.y + yOff,
        rm.z + Math.sin(angle) * dist
      );
      const clusterScale = 35 + Math.random() * 55; // matches prior obstacle footprint
      game.clusters.push(new ClusterObstacle(pos, clusterScale));
    }
  }

  // Place a few clusters in tunnels
  const tunnelPoints = game.corridorPoints.filter(p => p.roomType === 'tunnel');
  const crateCount = Math.min(6, Math.max(3, Math.floor(tunnelPoints.length / 5)));
  for (let c = 0; c < crateCount && tunnelPoints.length > 0; c++) {
    const idx = Math.floor(Math.random() * tunnelPoints.length);
    const pt = tunnelPoints.splice(idx, 1)[0];
    const pos = new THREE.Vector3(pt.x, pt.y, pt.z);
    const clusterScale = 25 + Math.random() * 35;
    game.clusters.push(new ClusterObstacle(pos, clusterScale));
  }

  // (v6.7) Assign stable netIds so cluster destruction events can target the
  // same cluster on every peer. Both peers built game.clusters in the same
  // order under the seed-synced RNG, so index = id is stable across the mesh.
  for (let i = 0; i < game.clusters.length; i++) {
    game.clusters[i].netId = i;
  }
  // (v15a basin clouds) Spawn pooled gas in spheres that don't have a
  // tunnel draining downward from them — gas would naturally settle at
  // the bottom of those "basin" rooms.
  if (typeof _spawnBasinClouds === 'function') _spawnBasinClouds();
}


// ----- spawnOrganics (organic blobs on inner room walls + tunnel sides) -----
function spawnOrganics(rooms) {
  // Clean up old organics
  if (game.organics) {
    for (const org of game.organics) {
      if (org.mesh && org.mesh.parent) scene.remove(org.mesh);
    }
  }
  game.organics = [];

  // Spawn organics in every room (more in larger rooms)
  for (const rm of rooms) {
    const count = Math.max(3, Math.floor(rm.r / 60));
    for (let i = 0; i < count; i++) {
      // Position: on the inner surface of the room sphere (near walls)
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const surfaceDist = rm.r * (0.65 + Math.random() * 0.25); // near wall
      const px = rm.x + surfaceDist * Math.sin(phi) * Math.cos(theta);
      const py = rm.y + surfaceDist * Math.sin(phi) * Math.sin(theta);
      const pz = rm.z + surfaceDist * Math.cos(phi);

      const type = ORGANIC_TYPES[Math.floor(Math.random() * ORGANIC_TYPES.length)];
      const scale = 15 + Math.random() * 40;
      const color = ORGANIC_PALETTE[Math.floor(Math.random() * ORGANIC_PALETTE.length)];
      const mesh = createOrganicMesh(type, scale, color);

      mesh.position.set(px, py, pz);
      // Orient toward room center (growths face inward)
      mesh.lookAt(rm.x, rm.y, rm.z);
      scene.add(mesh);

      game.organics.push({
        mesh: mesh,
        type: type,
        basePos: new THREE.Vector3(px, py, pz),
        pulseSpeed: 0.5 + Math.random() * 2.0,
        pulsePhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.2 + Math.random() * 0.6,
        swayAmount: 1 + Math.random() * 3,
      });
    }
  }

  // Also spawn some along tunnels
  const tunnelPts = game.corridorPoints.filter(p => p.roomType === 'tunnel');
  const tunnelOrgCount = Math.min(20, Math.floor(tunnelPts.length / 2));
  for (let i = 0; i < tunnelOrgCount; i++) {
    const idx = Math.floor(Math.random() * tunnelPts.length);
    const pt = tunnelPts[idx];
    // Offset to sides of tunnel (near walls)
    const offsetAngle = Math.random() * Math.PI * 2;
    const offsetDist = 100 + Math.random() * 60;
    const px = pt.x + Math.cos(offsetAngle) * offsetDist;
    const py = pt.y + Math.sin(offsetAngle) * offsetDist * 0.5;
    const pz = pt.z + Math.sin(offsetAngle) * offsetDist;

    const type = ORGANIC_TYPES[Math.floor(Math.random() * ORGANIC_TYPES.length)];
    const scale = 10 + Math.random() * 25;
    const color = ORGANIC_PALETTE[Math.floor(Math.random() * ORGANIC_PALETTE.length)];
    const mesh = createOrganicMesh(type, scale, color);

    mesh.position.set(px, py, pz);
    scene.add(mesh);

    game.organics.push({
      mesh: mesh,
      type: type,
      basePos: new THREE.Vector3(px, py, pz),
      pulseSpeed: 0.5 + Math.random() * 2.0,
      pulsePhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.2 + Math.random() * 0.6,
      swayAmount: 1 + Math.random() * 3,
    });
  }
}



// (gameLoop hue-drift reference block removed ; lives in the main loop)
