# Reply to Dan (dan@oxism.com)

Suggested subject: Re: Last Ship Sailing + Trystero 0.25.0

---

Hi Dan,

Thanks so much, that really means a lot coming from you. Trystero is the reason LSS exists at all; shipping real multiplayer with nothing but a room code still feels like magic.

On the consensus patterns: I'd like to open source them. Right now they're tangled into one big HTML file and fairly LSS-specific (roughly: host authority with vote-based reconciliation when peers disagree on state, plus some validation on hits), so they need extracting and documenting before they'd be useful to anyone else. I'll pull them into a standalone module and share it; happy to compare notes on what's general enough to belong in core versus what should stay app-side.

On 0.25.0: good timing. I'm currently pinned to trystero@0.22.0. I'd been importing @trystero-p2p/torrent unpinned, and when that rolled onto the rewritten line my connectivity broke, so I pinned back to 0.22.0 to keep the game up. I haven't fully isolated whether it was my code or the new connection-sharing / offer-recycling internals, but LSS keeps the same peers in two rooms at once (a lobby room and a match room), so the shared RTCPeerConnection reuse is my prime suspect. I'll put 0.25.0 on a branch (pinned this time) and send you a proper repro if it breaks again.

Request/response actions look great, and they map almost exactly onto my consensus round: today I broadcast a vote action and hand-roll the collect-and-tally with timeouts. requestMany() with onResult and timeoutMs looks like it would replace a chunk of that bookkeeping. I'll report back once I've tried it.

And yes, I'll send a PR to add LSS to awesome-trystero. Thanks for the nudge, and for building the library.

Best,
Ash
