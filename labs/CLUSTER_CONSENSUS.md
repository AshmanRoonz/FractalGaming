# cluster-consensus

Agreement-by-clustering for work whose honest answers aren't identical.
Companion primitive to [trystero-consensus](https://github.com/AshmanRoonz/trystero-consensus).

- `labs/cluster_consensus.js` — the primitive (ESM, MIT, no deps)
- `labs/cluster_consensus.test.js` — `node labs/cluster_consensus.test.js`
- `labs/mesh_inference.html` — distributed inference demo over a Trystero mesh

## The problem it solves

`createVoteRegister` answers *"did enough peers say yes?"*. That assumes every
honest peer produces the same answer. Model inference breaks that assumption:
two honest peers running identical weights on different GPUs disagree
token-for-token because of driver math, quantization and sampling. Exact-match
quorum rejects everybody.

[Rakis](https://github.com/hrishioa/rakis) solved this by embedding outputs and
clustering them — replacing *equality* with *proximity*. This is that idea
pulled out as a standalone primitive, with the agreement test left pluggable so
one piece of machinery covers every output shape:

| output | agreement test | threshold |
|---|---|---|
| classifier / label / argmax | `agree.exact` | `1` |
| text generation | `agree.cosine` over embeddings | ~0.97 |
| embeddings | `agree.cosine` directly | ~0.99 |
| transcription, structured text | `agree.editRatio` | ~0.9 |
| regression / scores | `agree.tolerance(eps)` | `1` |

With `agree.exact` the whole thing collapses to ordinary majority vote. That's
intended — same machinery, cheaper test.

## Usage

```js
import { createClusterConsensus, agree } from './cluster_consensus.js';

const cc = createClusterConsensus({
  similarity: agree.cosine,   // (a, b) => [0,1]
  threshold: 0.97,            // similarity at which two results "agree"
  redundancy: 3,              // results that constitute a decidable round
  minCluster: 2,              // smallest cluster allowed to win
  timeoutMs: 25000,
  commitReveal: true,
  onResolved: (taskId, status, detail) => { /* ... */ }
});

cc.open(taskId);
cc.commit(taskId, peerId, sha256(result));            // before anyone reveals
cc.submit(taskId, peerId, result, { key: embedding, digest: sha256(result) });
```

`key` is what gets compared, `value` is what gets returned. They're the same
thing for `exact` / `editRatio`; for generation, `key` is the embedding and
`value` is the text.

**Status** is one of `resolved`, `no-consensus`, `timeout`, `cancelled`.
A resolved `detail` carries `result`, `by` (medoid peer), `cluster`,
`outliers`, `confidence` (cluster ÷ received), `cohesion`, and `viaTimeout`.

## The determinism contract

Every peer has to reach the same verdict from the same result set without extra
messaging, or the mesh forks. Three things enforce that:

1. Entries are **sorted by peer id** before clustering, so greedy agglomeration
   is order-independent. This is the one that bites — clustering is
   insertion-order sensitive by nature, and arrival order differs per peer.
2. Cluster ranking breaks size ties by **lowest member id**.
3. The canonical result is the cluster **medoid** (highest mean similarity to
   the rest), tie broken by id — not the first arrival.

The test suite feeds the same three results in all six orders and asserts one
verdict comes out.

## Why average linkage

A result joins a cluster when its mean similarity to *every current member*
clears the threshold, not just to the nearest one. Single linkage lets a peer
sitting between two groups chain them into one cluster — a cheap way to launder
a bad result into an honest group. At realistic redundancy (3–7) the extra
comparisons cost nothing.

## Why commit-reveal

Without it, a lazy peer waits for someone else's answer and echoes it. That
looks exactly like honest agreement to any clustering test, and it's worse than
a liar because it inflates confidence. Committing a digest before reveals open
makes echoing detectable: reveals with no prior commit, or whose digest doesn't
match the commit, are dropped.

Hashing is left to the caller so the primitive stays synchronous and testable —
`crypto.subtle` is async and needs a secure context.

## Tuning the threshold

Set it from observed honest divergence, not from intuition. In the demo's
vector mode, honest peers land around 0.999 cosine and an off-topic answer at
0.60 — a huge margin. Push the threshold to 1.0 and every honest peer becomes
its own cluster, which surfaces as `no-consensus` with N singleton groups. That
failure is the signal you've tuned past honest noise.

The trap: too loose and a liar gets absorbed into the honest cluster; too tight
and honest peers fragment and nothing ever resolves. Loose fails silently, tight
fails loudly — so start tight and back off.

## Known gaps

Deliberately not solved here, because none of them are a clustering problem:

- **Sybil.** One machine can be N peers. If those peers produce *plausible*
  output they dominate the cluster. Commit-reveal stops echoing, not
  manufacturing. Needs stake or identity, which is where these designs usually
  reach for a chain.
- **Model attestation.** You can't prove a peer ran the model it claimed. A peer
  running a *better* model lands outside the honest cluster and gets marked an
  outlier — quality and consensus pull against each other.
- **Redundancy cost.** Verification means running everything R times, so the
  network is at best 1/R efficient.
