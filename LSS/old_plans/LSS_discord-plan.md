# LSS x Discord Integration Plan

Last updated: 2026-05-02
Status: SUPERSEDED + ARCHIVED 2026-05-08 (the successor plan, LSS_backend-plan.md, has also shipped ; both are now in old_plans/)

> **Note (2026-05-02 evening):** The architecture in this document
> (Discord channels as the data store, with Tier 0 = no infrastructure)
> has been superseded. The new plan moves persistence to a Cloudflare D1
> database accessed via a Worker API, with a real stats website on
> lss.fractalreality.ca. Discord stays as the OAuth identity provider
> and the community hub ; channels are no longer used as a database.
>
> Reasons for the pivot:
> 1. The "no infrastructure" constraint was already broken when we
>    accepted the Cloudflare Worker proxy ; once any Worker exists,
>    a real database is strictly better than parsing channel history.
> 2. Discord Activities turned out to fight against the popup pattern
>    (sandboxed iframe, no allow-popups), and refactoring the game to
>    live inside the iframe would mean losing WebXR / fullscreen / etc.
> 3. SQL queries beat channel parsing for everything we want to do
>    (top-N, filtering by time period, per-loadout breakdowns,
>    permanent shareable URLs).
>
> See **LSS_backend-plan.md** for the current architecture and roadmap.
>
> What survives from this document:
> - PKCE OAuth signin (shipped in v10, see lobby button).
> - The Cloudflare Worker scaffolding (repurposed for the D1 API).
> - Optional Discord webhook notifications for big moments
>   (#highlights as one-way notifications).
> - The Discord developer app, OAuth scopes, ToS / Privacy URLs.
>
> What is dead:
> - Channels-as-database for stats / leaderboards.
> - Lobby browser via #rooms heartbeat channel.
> - Discord Activities (popup pattern doesn't fit Discord's design).
> - Slash commands as primary stats interface (deferred indefinitely).

The original brainstorm + plan that drove the early Discord integration
work follows below. Kept for historical context.

---



## Why Discord, why now

LSS is already P2P at every layer that matters: Trystero handles matchmaking, WebRTC carries gameplay, the entire game ships as one HTML file. The one thing the architecture is missing is identity, and the one thing the player experience is missing is a frictionless way to get friends into a match together.

Discord solves both at the same time, and goes further: it can also absorb voice chat, presence, social graph, leaderboards-as-channel-content, tournament infrastructure, and community moderation. Building any of those ourselves is months of work; renting them from Discord costs the time it takes to wire up an OAuth app and a webhook.

The strategic reason to lean all the way in: the LSS community already lives on Discord. Forcing players to make a separate account for a hobby game is the surest way to lose them at the door. "Sign in with Discord" is one click on a service they already trust, and from there every other Discord-native feature compounds.

## Architecture: three tiers

This is the most important section. The planned architecture is **bot-less and backend-less by default**, leveraging Discord channels as the database and webhooks as the only write path. Higher tiers are escape hatches for features that truly need them.

### Tier 0: Zero infrastructure (the default)

**The premise:** the game HTML is the only code that exists. Discord is the storage, the social layer, the identity provider, and (transitively) the database. Nothing runs on our side.

**How it works:**

- **Identity** comes from PKCE OAuth, run entirely from the game HTML. PKCE is the OAuth variant designed for browser-only apps that can't keep a secret; no Client Secret needed, no backend needed for the auth flow. The player clicks "Sign in with Discord," gets redirected, comes back authenticated. The game knows their Discord ID, username, avatar.

- **Writes happen via Discord webhooks.** A webhook is a per-channel URL that anything can POST to. The game HTML POSTs match results directly to a `#match-records` webhook ; Discord renders them as channel messages. Every participant's browser fires its own POST at match-end ; the message is the persistent record. Webhook URLs are mild secrets (worst-case, someone spams the channel ; rotate the URL in one click) and can be safely baked into the HTML.

- **Reads happen via Discord's REST API** using the player's user OAuth token. The game HTML can fetch channel history with the user's permission for any channel they have access to. The leaderboard is "fetch the last N messages from `#match-records`, parse, aggregate, sort, render."

- **Consensus is enforced at read time, not write time.** Every participant in a match POSTs their own version of the result. The reader (any browser opening stats) groups posts by `match_id`, validates that all participants agree, and only counts the match if they do. Disagreeing posts get marked disputed and ignored. This is consensus without a server.

- **The "live leaderboard" pinned message** updates via webhook PATCH. The game HTML, on stats-screen open, computes the top 10 and PATCHes a single designated webhook message to refresh it. Limited to ~5 edits per second per webhook ; plenty for low-frequency leaderboard updates.

- **Lobby browser** uses the same pattern: hosts post a heartbeat to a `#rooms` webhook every ~30 seconds with their room code, map, and player count. Game HTML reads recent messages from the channel, filters out stale ones (last seen > 60s ago), shows the live browser. No central registry needed.

**What lives where:**

- **Game HTML on GitHub Pages** (or wherever you host static): the entire game.
- **Discord developer app**: an Application ID for OAuth. That's it ; we never use the Client Secret in Tier 0.
- **Discord webhook URLs**: baked into the HTML, one per write-channel.
- **Discord channels**: the database. `#match-records`, `#rooms`, `#highlights`, `#community-maps`, etc.
- **Player browsers**: the consensus engine, the leaderboard renderer, the stats UI.

**Trust model:**

- Anyone with a webhook URL can post junk. Mitigation: signed result blobs + read-time consensus filter out fake posts because they don't have co-signing peers. Worst case is a cluttered channel, which is recoverable.
- Anyone can read public channel history (with their OAuth token). This is fine; stats are public anyway.
- The game HTML can be modified by determined cheaters. Same caveat as the existing P2P gameplay: trust is social, not enforced.

### Tier 1: One Cloudflare Worker, when needed

When a feature legitimately can't be done in Tier 0, the upgrade is **one tiny piece of code at the edge for one specific job**. Cloudflare Workers free tier covers 100k requests/day, no Pi required, no admin burden, no monthly bill, no machine to own.

Features that justify Tier 1:

- **Slash commands** (`/lss-stats @user`, `/lss-leaderboard`). Discord delivers these to an HTTP Interactions Endpoint URL ; a Worker can be that URL and respond with formatted embeds. The Worker reads the channel via the same path the game does, computes the answer, returns it as the slash command reply.

- **Linked Roles verification.** Discord asks "does this user qualify for the Veteran role?" by GETting your verification URL. A Worker can answer (yes/no based on stats from the channel) without us hosting a full backend.

- **Scheduled tasks** (weekly leaderboard reset, monthly tournament reminder, prune disputed match posts older than X). Cloudflare Workers Cron Triggers run on a schedule, no infrastructure to maintain.

- **Webhook signing/validation** if Tier 0 spam ever becomes a real problem. Worker sits between game and Discord ; verifies cryptographic signatures before relaying.

Each of these is one Worker, one route, one purpose. They don't compose into a "backend" ; each is independent and replaceable.

### Tier 2: Full backend, only if forced

Reserved for features that genuinely require server-side state with low latency:

- Live spectator feeds with sub-second updates (mid-match scoreboard streaming).
- Discord Activities server-side authoritative state (if we choose to do server-validated matches there).
- Replay storage with cryptographic anti-cheat verification.

We may never need this. If we do, it's a Cloudflare Worker + D1 (edge SQLite) before it's a Pi or a VM. Even Tier 2 doesn't have to mean "machine I administer."

### Why this architecture matters

The original draft of this plan (earlier this session) assumed a Postgres + Node API on a home Pi. That's standard, well-trodden, and unnecessary. Discord channels are append-only logs ; that's a database. Webhooks are write endpoints ; that's an API. Discord's REST API is your read endpoint. The only thing missing for most use cases is server-side validation, and that's solvable with read-time consensus and signed payloads.

The result is a multiplayer game with identity, leaderboards, stats, and persistent records, where the entire infrastructure surface is "one HTML file + one Discord developer app." That's a unique posture and probably the right answer for LSS specifically.

## The novel pitch (why Discord might actually want to feature this)

The Activities + Rich Presence + webhook-as-database + read-time-consensus combo means LSS would be one of the first games designed Discord-first from day zero, not retrofitted. The voice channel is the lobby. Channels are the database. The player base is the seed swarm (if we add WebTorrent for assets). The leaderboard is read-time consensus over channel history. Stats are channel posts. Friends list is the Discord roster.

There are big games that integrate with Discord, and there are small games that use Discord OAuth, but very few games have made Discord the **complete substrate** end-to-end ; identity, social, voice, persistence, anti-cheat consensus, all of it. Discord's developer relations team would probably find this interesting because it demonstrates the platform's full capability stack in one project, at indie scale, where every layer has a clear "this would not exist without you" story. Worth pitching to them once we have the v1 playable.

## Feature catalog by tier

### Tier 0 features (ship-today, no infrastructure)

- **Discord OAuth login via PKCE.** Player signs in, game knows their Discord identity. No Client Secret needed, no backend.
- **Avatar + display name in lobby and HUD.** Replaces anonymous handles with real Discord identity.
- **Match results auto-posted to `#match-records`.** Every participant's browser POSTs a signed result via webhook on match-end.
- **Read-time consensus leaderboard.** Stats screen reads channel history, validates per-match consensus, aggregates, renders.
- **Live leaderboard pinned message.** Game HTML PATCHes a designated webhook message on stats-open to refresh public standings.
- **Lobby browser via heartbeat channel.** Hosts post heartbeat to `#rooms` webhook ; readers filter recent messages for live rooms.
- **Highlight reels via webhook.** Game detects "30-kill round," "comeback win," etc. ; POSTs a special embed to `#highlights`.
- **Match archive forum threads.** Each match becomes a thread in `#match-archive` posted by webhook with the scoreboard embed.
- **Community map submissions.** Player attaches a map JSON, game HTML opens a Discord deep-link prefilled with the upload to `#community-maps`. Validation happens at read-time when other players' games fetch and parse the channel.
- **Rich Presence.** Pure client-side; published from the game HTML on game-state transitions. Friends see "Playing Last Ship Sailing — Slayer — Hourglass — Round 2" in their Discord.

### Tier 1 features (add one Cloudflare Worker per feature)

- **Slash commands**: `/lss-stats`, `/lss-leaderboard`, `/lss-rooms`, `/lss-challenge`, `/lss-history`. Worker as the HTTP Interactions Endpoint.
- **Linked Roles**: bot-less role progression. Discord calls the Worker verification URL to check qualification.
- **Stat-driven role progression**: combination of Linked Roles + a scheduled Worker that updates qualifications.
- **Scheduled events**: tournament reminders, weekly leaderboard resets, seasonal challenges. Worker on a Cron Trigger.
- **Webhook abuse mitigation**: Worker validates signed payloads before relaying to the channel webhook. Only relevant if Tier 0 spam becomes a real problem.
- **Tournament bracket coordination**: Worker manages bracket state, posts updates to a `#tournament` channel. Or use an existing bot like Battlefy and skip writing this.

### Tier 2 features (only if absolutely necessary)

- Live mid-match spectator feed.
- Server-validated competitive ranked play with cryptographic anti-cheat.
- Discord Activities with authoritative server-side state.

### Discord Activities (separate workstream, multi-week)

This is a major lift independent of the tier structure: wrapping LSS in Discord's Embedded App SDK so it runs inside a voice channel. Voice channel becomes the lobby ; people in the channel get one-click "join the match." Voice chat is automatic. The keystone feature for the whole Discord-first vision; worth its own dedicated project once Tier 0 is solid.

### Existing-bot infrastructure leverage

Where useful, lean on bots others maintain:

- **Levels/XP bots** (MEE6, Arcane): post a webhook on match-end to award XP ; bot handles the leveling curve and role unlocks.
- **Tournament bots** (Battlefy, Toornament): outsource the bracket UX entirely.
- **Embed renderer bots**: take raw JSON posts and re-render as polished cards.
- **Stats display bots** (Statbot, Server Stats): pin live dashboards we couldn't easily build.

We don't write or run these. We just feed them via webhook posts.

## Roadmap

### Phase 1: Tier 0 foundation (one weekend)

1. Register Discord developer application (done; ID 1500305353210855615).
2. Create webhook URLs in target channels: `#match-records`, `#rooms`, `#highlights`, `#community-maps`. Bake URLs into the game HTML.
3. Implement PKCE OAuth flow in the game HTML (~80 lines). On signin: store user token in localStorage, render avatar + username in lobby.
4. Implement `postMatchResult()`: on match-end, every browser POSTs signed JSON to `#match-records` webhook.
5. Implement `loadLeaderboard()`: stats screen fetches channel messages via Discord API (with user token), groups by match_id, validates consensus, aggregates per-player career stats, renders.
6. Implement `updatePinnedLeaderboard()`: PATCH the designated webhook message with current top 10.

Result after Phase 1: working Discord identity, working leaderboard, working stats UI, zero infrastructure. Game is shippable as a complete experience.

### Phase 2: Passive marketing (one afternoon)

7. **Rich Presence integration.** Highest-ROI hour of work in this whole plan. Every active player's Discord profile starts showing what they're doing in LSS. Free passive recruitment forever.

### Phase 3: More Tier 0 polish (one week)

8. Lobby browser: heartbeat-driven listing of live rooms.
9. Highlight reel webhook posting on detected moments (30-kill round, championship win, longest-range hit).
10. Match-archive forum threads with scoreboard embeds.
11. Community map submission flow via Discord deep-link.

### Phase 4: First Tier 1 features (one to two weeks)

12. **Slash commands via Cloudflare Worker.** Start with `/lss-stats`, `/lss-leaderboard`, `/lss-rooms`. Worker reads the same channels the game reads.
13. **Linked Roles verification.** Discord asks the Worker "does Ashman have 100+ wins?" ; Worker reads the channel, answers yes/no.
14. **Stat-driven role progression**: tied to Linked Roles + a weekly Cron Worker that updates qualifications.

### Phase 5: Community-generated content polish (two weeks)

15. Wall pattern + sound pack submission flows (same Tier 0 webhook pattern).
16. Cartographer / Composer roles + community-leaderboards via Linked Roles (Tier 1).
17. Top-community-map auto-promotion: Cron Worker promotes maps that hit a vote threshold.

### Phase 6: The keystone (multi-week)

18. **Discord Activities.** Wrap the game as an embedded app for voice channels. Voice channel becomes lobby. Big lift but transformative ; centerpiece of any pitch to Discord DevRel.
19. **Voice-aware in-game UI.** Speaking-pip on ships, auto-team by voice channel.

### Phase 7: Community-of-communities (ongoing)

20. **Server template.** Publish an LSS-themed Discord server template anyone can spin up in one click.
21. **Cross-server play and tournaments.** Workers coordinate brackets across multiple LSS servers.

## Technical sketch

### PKCE OAuth flow (Tier 0)

In the game HTML:

```js
async function discordSignin() {
  const verifier = generateRandomString(64);
  const challenge = await sha256base64url(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const authUrl = `https://discord.com/oauth2/authorize?` + new URLSearchParams({
    client_id: APPLICATION_ID,
    redirect_uri: window.location.origin + window.location.pathname,
    response_type: 'code',
    scope: 'identify',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location = authUrl;
}

// On callback (URL has ?code=...):
async function handleDiscordCallback(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLICATION_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: window.location.origin + window.location.pathname,
      code_verifier: verifier,
    }),
  });
  const { access_token } = await tokenRes.json();
  localStorage.setItem('discord_token', access_token);
  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const user = await userRes.json();
  // user.id, user.username, user.global_name, user.avatar
  return user;
}
```

No Client Secret. Pure browser flow. ~80 lines including the SHA-256 helper.

### Match result post (Tier 0)

```js
async function postMatchResult(match) {
  const payload = {
    match_id: deterministicMatchId(match),
    reporter: currentUser.id,
    timestamp: Date.now(),
    result: {
      winner_team: match.winnerTeam,
      participants: match.participants.map(p => ({
        discord_id: p.discordId,
        loadout: p.loadoutKey,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        damage_dealt: p.damageDealt,
        score: p.score,
      })),
      map: match.map,
      duration: match.duration,
    },
    signature: await signWithUserKey(payload),
  };
  await fetch(MATCH_RECORDS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '',
      embeds: [renderMatchEmbed(payload.result)],
      // raw payload also embedded as a hidden code-fenced JSON for parsing on read
      attachments: [],
    }),
  });
}
```

### Leaderboard load (Tier 0)

```js
async function loadLeaderboard() {
  const messages = await fetchChannelMessages(MATCH_RECORDS_CHANNEL_ID);
  const matchesById = groupByMatchId(messages);
  const validatedMatches = matchesById.filter(m => allParticipantsAgreed(m));
  const careerStats = aggregateByPlayer(validatedMatches);
  return rankByScore(careerStats);
}
```

### Lobby browser (Tier 0)

```js
// Host periodically posts heartbeat:
async function postRoomHeartbeat(room) {
  await fetch(ROOMS_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({
      content: '',
      embeds: [{ title: room.code, fields: [/* map, players, version */] }],
    }),
  });
}
setInterval(() => postRoomHeartbeat(currentRoom), 30000);

// Browser reads recent room posts:
async function listOpenRooms() {
  const messages = await fetchChannelMessages(ROOMS_CHANNEL_ID, { limit: 50 });
  const now = Date.now();
  const fresh = messages.filter(m => now - new Date(m.timestamp).getTime() < 60000);
  return parseRoomsFromMessages(fresh);
}
```

### Tier 1 example: slash command Worker

```js
// Cloudflare Worker
export default {
  async fetch(request) {
    const sig = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    const body = await request.text();
    if (!verifyDiscordSignature(sig, timestamp, body, DISCORD_PUBLIC_KEY)) {
      return new Response('Bad signature', { status: 401 });
    }
    const interaction = JSON.parse(body);
    if (interaction.type === 1) return Response.json({ type: 1 }); // PING
    // Slash command handler
    if (interaction.data.name === 'lss-leaderboard') {
      const top10 = await loadLeaderboardFromChannel();
      return Response.json({
        type: 4,
        data: { embeds: [renderLeaderboardEmbed(top10)] },
      });
    }
    // ...
  },
};
```

One Worker, one purpose. Free tier covers all expected use.

## Open questions

- **Webhook URL rotation policy.** If a URL leaks and gets spammed, we rotate. Should we rotate proactively (monthly) or reactively (only on incident)? Reactive is simpler.
- **Read-time consensus thresholds.** All-participants-must-agree (strict) or majority-must-agree (lenient)? Strict for ranked, lenient with a "disputed" flag for casual? Probably strict everywhere ; the cost of a disputed match being thrown out is low.
- **Identity portability if a user leaves Discord.** If we ever want users to migrate off Discord identity, the player_id schema should use a portable internal UUID with Discord ID as a linkable account, not the primary key. Implication: on signin, we generate or look up an internal UUID derived from the Discord ID, and that UUID is what gets signed into match results. Easier to do correctly from day one than to migrate later.
- **Discord Activities region availability.** Activities are still rolling out region-by-region. Verify the integration works across our actual player base before making it the sole onboarding path.
- **Pitch to Discord DevRel.** Wait until v1 of Activities is working and there's a small but real player base. The pitch writes itself once there's a demo: "every layer of this game integrates with your platform; we built it Discord-first; here's what serverless multiplayer infrastructure looks like in 2026."

## Appendix: why this architectural posture is unique

There are widely-played games that integrate with Discord (Rich Presence is common, OAuth is common). There are Discord Activities that exist (Watch Together, Poker Night, etc.). What does not yet exist (as far as we know) is a multiplayer game where:

- The voice channel is the lobby (Activities does this for some games, but rarely for combat games).
- The persistence layer IS Discord channels (no separate database, no backend, channels as append-only logs).
- The validation/anti-cheat layer is read-time consensus over signed channel posts (no server-side validator).
- The community pipeline for user-generated content runs entirely through webhook-and-read patterns (slash command submission via Tier 1 Worker, channel-based voting, threshold-based read-time promotion).
- Stats, leaderboards, ranks, lobby browser, all live as channel content read by the game itself.
- The game is otherwise serverless P2P (Trystero gameplay, possibly WebTorrent assets), so Discord's social and identity layers + the channel-as-database model are the only "infrastructure" the game touches.

The result is a game with effectively no platform of its own, no servers to maintain, and persistent state nonetheless. It lives inside Discord. The only thing we ship is one HTML file. That's a unique architectural posture, and it's the kind of thing Discord's DevRel team should want to amplify because it showcases the entire platform stack at indie scale, while pioneering a pattern (channels-as-database for game state with read-time consensus) that other indie devs could adopt.

---

License: same as the rest of LSS-related design docs in this repo. The framework concepts are CC-BY-4.0 ; the LSS-specific implementation plan is internal.
