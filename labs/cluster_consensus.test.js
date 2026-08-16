// node labs/cluster_consensus.test.js
// No deps. Exercises the determinism contract and the adversarial paths, since
// those are the parts that quietly break in a real mesh.
import { createClusterConsensus, clusterResults, agree } from './cluster_consensus.js';

let passed = 0, failed = 0;
const ok = (cond, name, extra) => {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '\n       ' + JSON.stringify(extra) : '')); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });
const section = n => console.log('\n' + n);

// helper: run a batch of results through a fresh register, return the verdict
function verdict(results, opts = {}) {
  let out = null;
  const cc = createClusterConsensus({
    similarity: agree.exact, threshold: 1, redundancy: results.length,
    timeoutMs: 0, onResolved: (id, status, detail) => { out = { status, ...detail }; },
    ...opts
  });
  cc.open('t');
  for (const [peer, value, extra] of results) cc.submit('t', peer, value, extra);
  return out;
}

section('exact agreement (classifier path)');
{
  const v = verdict([['p1', 'POSITIVE'], ['p2', 'POSITIVE'], ['p3', 'NEGATIVE']]);
  eq(v.status, 'resolved', 'majority label wins');
  eq(v.result, 'POSITIVE', 'result is the majority label');
  eq(v.cluster, ['p1', 'p2'], 'honest peers form the cluster');
  eq(v.outliers, ['p3'], 'disagreeing peer is flagged as an outlier');
  ok(Math.abs(v.confidence - 2 / 3) < 1e-9, 'confidence is cluster/total');
}
{
  const v = verdict([['p1', 'A'], ['p2', 'B'], ['p3', 'C']]);
  eq(v.status, 'no-consensus', 'three-way disagreement resolves to no-consensus');
  eq(v.cluster, [], 'no cluster is reported');
}

section('cosine agreement (generation path)');
{
  // two honest peers that phrased it differently, one peer answering something else
  const honestA = [0.90, 0.10, 0.05];
  const honestB = [0.88, 0.14, 0.03];   // near honestA
  const liar    = [0.05, 0.20, 0.95];   // orthogonal-ish
  const v = verdict(
    [['p1', 'the cat sat', { key: honestA }],
     ['p2', 'a cat was sitting', { key: honestB }],
     ['p3', 'buy crypto now', { key: liar }]],
    { similarity: agree.cosine, threshold: 0.97 }
  );
  eq(v.status, 'resolved', 'semantically close outputs cluster despite different text');
  eq(v.cluster, ['p1', 'p2'], 'honest pair clusters');
  eq(v.outliers, ['p3'], 'off-topic output is excluded');
  ok(v.result === 'the cat sat' || v.result === 'a cat was sitting', 'winner is a real member output');
}

section('determinism contract');
{
  // Same results, six different arrival orders — every peer must land on the
  // same winner or the mesh forks.
  const rows = [
    ['pC', 'X', { key: [1, 0, 0] }],
    ['pA', 'X', { key: [0.99, 0.01, 0] }],
    ['pB', 'Y', { key: [0, 1, 0] }]
  ];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const seen = new Set();
  for (const p of perms) {
    const v = verdict(p.map(i => rows[i]), { similarity: agree.cosine, threshold: 0.9 });
    seen.add(JSON.stringify([v.status, v.result, v.by, v.cluster]));
  }
  eq(seen.size, 1, 'verdict is identical across all arrival orders');
}
{
  // medoid must be the central member, not the first one to arrive
  const entries = [
    { id: 'a', key: [1, 0] },
    { id: 'b', key: [0.7, 0.7] },   // sits between a and c
    { id: 'c', key: [0, 1] }
  ];
  const [c0] = clusterResults(entries, agree.cosine, 0.5);
  eq(c0.members.length, 3, 'loose threshold groups all three');
  eq(c0.medoid.id, 'b', 'medoid is the most central member');
}

section('average linkage blocks cluster bridging');
{
  // p_bridge is similar to both groups but the groups are not similar to each
  // other. Single linkage would chain all five into one cluster; average
  // linkage must not.
  const entries = [
    { id: 'p1', key: [1, 0] },
    { id: 'p2', key: [0.98, 0.02] },
    { id: 'p4', key: [0, 1] },
    { id: 'p5', key: [0.02, 0.98] },
    { id: 'p3', key: [0.71, 0.71] }   // the bridge
  ];
  const clusters = clusterResults(entries, agree.cosine, 0.93);
  ok(clusters[0].members.length < 5, 'bridging peer does not merge the two groups');
  ok(clusters.length >= 2, 'both groups survive as separate clusters', clusters.map(c => c.members.map(m => m.id)));
}

section('commit-reveal');
{
  let out = null;
  const cc = createClusterConsensus({
    similarity: agree.exact, threshold: 1, redundancy: 3, timeoutMs: 0,
    commitReveal: true, onResolved: (id, s, d) => { out = { status: s, ...d }; }
  });
  cc.open('t');
  ok(cc.commit('t', 'p1', 'hashA'), 'commit accepted');
  ok(!cc.commit('t', 'p1', 'hashB'), 're-commit rejected');
  ok(!cc.submit('t', 'pX', 'A', { digest: 'hashA' }), 'reveal without a prior commit is rejected');
  ok(!cc.submit('t', 'p1', 'B', { digest: 'hashB' }), 'reveal that does not match the commit is rejected');
  ok(cc.submit('t', 'p1', 'A', { digest: 'hashA' }), 'matching reveal accepted');
  ok(!cc.submit('t', 'p1', 'A', { digest: 'hashA' }), 'second reveal from same peer rejected');
  eq(cc.received('t'), 1, 'only the valid reveal counted');
  eq(out, null, 'still pending below redundancy');
}

section('timeout paths');
{
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const run = async () => {
    // enough agreement arrives, but fewer peers than requested
    let out = null;
    const cc = createClusterConsensus({
      similarity: agree.exact, threshold: 1, redundancy: 3, timeoutMs: 30,
      onResolved: (id, s, d) => { out = { status: s, ...d }; }
    });
    cc.open('t1');
    cc.submit('t1', 'p1', 'A');
    cc.submit('t1', 'p2', 'A');
    await wait(60);
    eq(out.status, 'resolved', 'partial-but-agreeing round resolves on timeout');
    ok(out.viaTimeout === true, 'verdict is marked as timeout-driven');
    eq(out.cluster, ['p1', 'p2'], 'the two agreeing peers are the cluster');

    // a single lonely result cannot clear minCluster
    let out2 = null;
    const cc2 = createClusterConsensus({
      similarity: agree.exact, threshold: 1, redundancy: 3, timeoutMs: 30,
      onResolved: (id, s, d) => { out2 = { status: s, ...d }; }
    });
    cc2.open('t2');
    cc2.submit('t2', 'p1', 'A');
    await wait(60);
    eq(out2.status, 'timeout', 'one result alone times out rather than resolving');

    // nothing at all
    let out3 = null;
    const cc3 = createClusterConsensus({
      similarity: agree.exact, threshold: 1, redundancy: 3, timeoutMs: 30,
      onResolved: (id, s, d) => { out3 = { status: s, ...d }; }
    });
    cc3.open('t3');
    await wait(60);
    eq(out3.status, 'timeout', 'empty round times out');
    eq(out3.received, 0, 'no results recorded');
  };
  await run();
}

section('agreement tests');
{
  eq(agree.exact('a', 'a'), 1, 'exact: identical');
  eq(agree.exact('a', 'b'), 0, 'exact: different');
  ok(agree.cosine([1, 0], [1, 0]) === 1, 'cosine: identical vectors score 1');
  ok(agree.cosine([1, 0], [-1, 0]) === 0, 'cosine: opposite vectors score 0');
  ok(Math.abs(agree.cosine([1, 0], [0, 1]) - 0.5) < 1e-9, 'cosine: orthogonal maps to 0.5');
  eq(agree.cosine([1, 0], [1, 0, 0]), 0, 'cosine: mismatched lengths score 0');
  eq(agree.tolerance(0.5)(1.0, 1.4), 1, 'tolerance: within eps');
  eq(agree.tolerance(0.5)(1.0, 1.6), 0, 'tolerance: outside eps');
  eq(agree.editRatio('kitten', 'kitten'), 1, 'editRatio: identical');
  ok(agree.editRatio('kitten', 'sitting') > 0.5, 'editRatio: near miss stays high');
  ok(agree.editRatio('kitten', 'zzzzzzz') < 0.2, 'editRatio: unrelated goes low');
}

section('housekeeping');
{
  const cc = createClusterConsensus({ similarity: agree.exact, threshold: 1, redundancy: 3, timeoutMs: 0 });
  ok(cc.open('t'), 'open returns true for a new task');
  ok(!cc.open('t'), 'open returns false for a duplicate task');
  eq(cc.pending(), ['t'], 'pending lists open tasks');
  cc.cancel('t');
  eq(cc.pending(), [], 'cancel clears the task');
  let threw = false;
  try { createClusterConsensus({}); } catch { threw = true; }
  ok(threw, 'missing similarity function throws');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
