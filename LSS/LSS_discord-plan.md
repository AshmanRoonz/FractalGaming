# LSS x Discord Integration Plan

Last updated: 2026-05-02
Status: planning / brainstorm

## Why Discord, why now

LSS is already P2P at every layer that matters: Trystero handles matchmaking, WebRTC carries gameplay, the entire game ships as one HTML file. The one thing the architecture is missing is identity, and the one thing the player experience is missing is a frictionless way to get friends into a match together.

Discord solves both at the same time, and goes further: it can also absorb voice chat, presence, social graph, leaderboards-as-channel-content, tournament infrastructure, and community moderation. Building any of those ourselves is months of work; renting them from Discord costs the time it takes to wire up an OAuth app and a bot.

The strategic reason to lean all the way in: the LSS community already lives on Discord. Forcing players to make a separate account for a hobby game is the surest way to lose them at the door. "Sign in with Discord" is one click on a service they already trust, and from there every other Discord-native feature compounds.

## The novel pitch (why Discord might actually want to feature this)

The Activities + Rich Presence + bot + voice combo means LSS would be one of the first games designed Discord-first from day zero, not retrofitted. The voice channel literally IS the lobby. The player base IS the seed swarm (if we add WebTorrent for assets). The leaderboard IS a pinned bot-edited message in a channel. Stats IS a slash command. Friends list IS the Discord roster.

There are big games that integrate with Discord, and there are small games that use Discord OAuth, but very few games have made Discord the primary social runtime end-to-end. Discord's developer relations team would probably find this interesting because it demonstrates the platform's full capability stack in one project, at indie scale, where every feature has a clear "this would not exist without you" story. Worth pitching to them once we have the v1 playable.

## Feature catalog

Grouped by category. Each entry is a one-line description plus the rough integration cost.

### Identity & auth

- **Discord OAuth login.** One-click signin. Returns user_id, display_name, avatar. Cost: low; an afternoon plus a tiny backend endpoint to validate tokens.
- **Linked-account display.** Discord avatar + handle in-game replaces anonymous text. Cost: free once OAuth is in.
- **Optional passkey overlay.** Power users can attach a device passkey for cryptographic identity, with Discord as the cosmetic display layer. Cost: medium; can be deferred indefinitely.

### Presence & passive marketing

- **Rich Presence.** Player's Discord profile shows "Playing Last Ship Sailing ; Slayer ; Hourglass ; Round 2." Friends see this passively in friends list, voice channels, server members. Cost: very low. ROI: very high; every active player becomes a billboard.
- **Party-size + join-button on profile.** "Ashman is in a 3 of 6 game" with a click-to-join button. Cost: low extension of Rich Presence.
- **"Now playing" channel.** A pinned message in a server channel that lists everyone in this server currently in a match, updated by webhook. Cost: low.

### Discord Activities (the keystone)

- **LSS as a Discord Activity (embedded app in a voice channel).** Voice channel becomes lobby. People in the voice channel get one-click "join the match" prompt. No room codes, no link sharing, no "where do I click." Voice chat is automatic because everyone is already in the channel. Cost: high (substantial integration with Discord's Embedded App SDK); ROI: transforms the entire game's social shape.
- **Voice-aware in-game UI.** Game queries Discord for who is speaking; ship of speaking player gets a glowing pip above it. Friends in the same voice channel auto-team. Cost: medium, only after Activities is in.
- **Spectator mode for voice-channel members.** Anyone in the voice channel who doesn't want to play gets a spectator camera view. Tournament-casting becomes free. Cost: medium.

### Bot & slash commands

- **`/lss-stats [@user]`.** Returns the user's career stats as an embed.
- **`/lss-leaderboard [loadout|map|all]`.** Top 10 by category, embed.
- **`/lss-rooms`.** Lists currently open rooms with player counts and maps; click to join.
- **`/lss-challenge @user`.** DMs the user a one-click challenge link.
- **`/lss-history [@user]`.** Last 10 matches with thumbnail.
- **`/lss-match <id>`.** Detailed scoreboard for any past match.
- **`/lss-bug`, `/lss-feedback`, `/lss-suggest-map`.** Funnel community signal directly into developer-side issue tracking.
- **`/lss-tournament create|join|bracket`.** Tournament organizer commands.
- **`/lss-mute @user`.** Cross-platform mute; the bot syncs the mute to the game backend.

Cost per command: low. Cost as a body of work: medium. Each command shipped is its own friction-reducer for both players and the dev.

### Channels as live data surfaces

- **`#leaderboards` with auto-updating pinned message.** Bot edits the message every 5 minutes with current standings. Multiple pinned messages for season / loadout / map slices.
- **`#highlights` with webhook-driven match recaps.** Big moments (30-kill round, championship win, longest-range hit, MVP performance) auto-post as embeds. Players covet appearances.
- **`#match-archive` forum channel.** Each completed match becomes a thread with replay attached, post-match scoreboard, comments.
- **`#community-maps` forum channel.** Players submit maps via `/lss-submit-map`; community votes via emoji; threshold-passing maps auto-promote into the in-game rotation.
- **`#community-walls`, `#community-sounds`.** Same loop for wall presets and sound packs.
- **`#patch-notes` with role-pinged announcements.** Subscribers get notified on new versions.

### Roles, ranks, recognition

- **Stat-driven role progression.** Rookie, Veteran, Ace, Master, etc. Bot assigns based on win counts, ELO, accuracy. Roles publicly visible in user lists; gamification loop without separate UI.
- **Per-loadout mastery roles.** "Slayer Master," "Tracker Sniper." Filterable in the server's user list.
- **Tournament-winner roles.** Permanent badges with custom colors. Optionally seasonal.
- **Cartographer / Composer roles.** For users whose community maps / sound packs got promoted in-game.
- **Server-booster cosmetic flair in-game.** Boost the server, get a gold trail on your ship. Aligns Discord's monetization with our community.

### Tournament infrastructure

- **Stage-channel casting.** Casters speak in a Stage channel; audience listens; competitors play in regular voice channels per match. Bot manages bracket and posts updates.
- **`/lss-tournament create` with bracket generation.** Round-robin or single-elim, signup window, auto-pairing.
- **Live match links in bracket channel.** Click to spectate any match in progress.
- **Cross-server tournaments.** Same bot runs in multiple servers; bracket spans all of them. Each server sends champions; final on a designated host server.

### Community pipeline (the user-generated content loop)

This is one of the higher-leverage subsystems. Right now there is no path from "I made a cool map in `map_lab.html`" to "it appears in the game." Discord becomes that path:

1. Player exports JSON from `map_lab.html`.
2. `/lss-submit-map <attached.json>` posts it as a thread in `#community-maps`.
3. Bot validates the JSON server-side (rejects malformed; size cap; profanity check on title/description).
4. Thread becomes the community review surface; emoji votes, screenshots, playtest reports.
5. At threshold (e.g. 25 👍), bot promotes the map into a "Community Curated" tier visible in-game.
6. The map's in-game success metrics (avg match duration, replay rate, exit-survey rating) flow back into the thread as bot replies.
7. Top community map creators each season get a Cartographer role and a leaderboard slot of their own.

Same loop for `wall_pattern_lab.html` exports and `sound_lab` sound packs. Discord absorbs the entire moderation + voting + promotion stack; we just consume the JSON when it passes the threshold.

### Newcomer onboarding

- **Auto-DM on server join.** Bot welcomes the user, links to a 90-second how-to-play video, lists currently active rooms they can join immediately, points them at a `#help-newcomers` channel.
- **Mentor matchmaking.** Veteran players opt into a "willing to mentor" role; bot pairs newcomers with available mentors.
- **Tutorial channel walkthrough.** Threads or pinned messages stepping through ship loadouts, ability combos, map etiquette.

### Streaming integration

- **Twitch/YouTube linked-account auto-pings.** When a player who linked Twitch in Discord goes live, bot announces in `#streams`.
- **Streamer role with visibility.** Linked streamers get a special role + appear at the top of voice channels they join.
- **Embedded stream widgets.** Twitch streams playable directly inside a designated Discord channel.

### Anti-toxicity & moderation

- **Cross-platform ban sync.** Discord server ban → in-game ban. In-game report → Discord moderation queue. One identity, one set of consequences.
- **`/lss-report @user <reason>`.** Players file reports as slash commands; tickets land in a mod-only forum channel.
- **Auto-mute lists.** Repeated reports trigger auto-mutes that propagate game-side.

### Server template (force-multiplier for community growth)

- Publish an LSS-flavored Discord server template with channels for matches, strategy, recordings, the bot pre-installed, leaderboards configured, role progression set up.
- Anyone wanting to start an LSS-focused community (clan, regional, language-specific) gets the whole infrastructure in one click.
- Bot federation lets these servers share data with the central LSS server (cross-server tournaments, shared leaderboards if desired).
- Result: communities of communities, with our bot as connective tissue.

## Roadmap (priority order)

The order optimizes for impact-per-hour and dependency unblocking.

### Phase 1: Foundation (one weekend)

1. Register Discord developer application; OAuth client ID, secret, redirect URI configured.
2. Tiny Node API on the home Pi (or Cloudflare Worker): `/auth/discord` to validate tokens and create/update player rows; `/stats/me`; `/leaderboard`; `/match` (POST results).
3. Postgres schema: `players (discord_id, display_name, avatar_url, created_at)`, `matches (id, started_at, players[], scores, map, duration)`.
4. In-game "Sign in with Discord" button replaces the anonymous-handle entry.

### Phase 2: Passive marketing (one afternoon)

5. **Rich Presence integration.** Maybe the highest ROI hour of work in this whole plan. Every active player's Discord shows what they're doing.

### Phase 3: Discord-native UX (one week)

6. **Bot with slash commands.** Start with `/lss-stats`, `/lss-leaderboard`, `/lss-rooms`, `/lss-challenge`. Discord becomes a viable LSS client without opening the game.
7. **Auto-updating `#leaderboards` channel.** Pinned message edited every 5 minutes. Server feels alive.
8. **Stat-driven role progression.** Rookie / Veteran / Ace / Master ranks; bot toggles roles on stat thresholds.

### Phase 4: Social loops (one to two weeks)

9. **Webhook highlight reels.** `#highlights` channel auto-posts big moments. Players covet appearances; engagement loop closes.
10. **Newcomer onboarding DM bot.** First-touch experience for every new server member.
11. **`#match-archive` forum.** Each match gets a thread with scoreboard.

### Phase 5: Community-generated content (two to three weeks)

12. **`/lss-submit-map` pipeline.** Validation, voting, threshold-based auto-promotion into in-game rotation.
13. **Same for wall presets and sound packs.**
14. **Cartographer / Composer roles + leaderboards.**

### Phase 6: The keystone (multi-week)

15. **Discord Activities.** LSS as an embedded app in voice channels. Voice channel = lobby. This is the one that changes the game's social shape forever and should be the centerpiece of any pitch to Discord's DevRel team.
16. **Voice-aware in-game UI.** Speaking-pip on ships, auto-team by voice channel, proximity voice (ambitious).
17. **Spectator mode through Activities.** Voice-channel members who don't want to play get spectator cameras.

### Phase 7: Tournament & community-of-communities (ongoing)

18. **Tournament bot with Stage-channel casting.** Brackets, signups, live links.
19. **Cross-server tournaments via bot federation.** Shared brackets across multiple LSS-themed servers.
20. **Server template publish.** One-click LSS-themed Discord server creation.

## Technical sketch

### Auth + stats backend

- Runtime: Node (or Bun) on the home Pi, behind Cloudflare Tunnel.
- DB: Postgres in Docker, ~50 MB initial size, grows linearly with match count.
- API surface (~10 endpoints total):
  - `POST /auth/discord` ; verify Discord token, upsert player row, return session JWT.
  - `GET /stats/me` ; return calling player's career.
  - `GET /stats/:discord_id` ; return any player's career (public).
  - `GET /leaderboard?slice=...` ; paginated leaderboard.
  - `POST /match` ; submit a completed match (consensus required from all participants).
  - `GET /match/:id` ; return a match record.
  - `GET /rooms` ; list currently active rooms (heartbeat-driven).
  - `POST /rooms/heartbeat` ; ping from a host indicating room is still alive.
  - `POST /webhook/discord/:secret` ; outbound trigger for highlight reels (if separated from main API).
- Schema:
  - `players (discord_id PK, display_name, avatar_url, created_at, updated_at, banned bool)`
  - `matches (id PK, started_at, ended_at, map, host_player_id, winner_team, raw_json)`
  - `match_participants (match_id FK, player_id FK, team, loadout, kills, deaths, damage_dealt, damage_taken, accuracy, is_mvp, signed_by_player_sig, signed_by_peer_sig)`
  - `rooms (code PK, host_id FK, map, max_players, last_seen_at, version)`
  - `achievements (id PK, player_id FK, type, achieved_at, match_id FK nullable)`
- Stats are append-only; aggregations computed on read.
- Match submissions require consensus: every participant POSTs; only when all submissions agree do the stats commit.

### Bot architecture

- Discord.js v14 or similar.
- Single bot process running alongside the API on the Pi.
- Slash command registration on bot startup.
- Talks to the same Postgres directly (no API hop).
- Webhook outbound for highlight posts (separate webhook URL per channel).
- ~500 lines of code for the v1 command set.

### Rich Presence

- Discord SDK in the game HTML.
- Update presence on game-state transitions (ship-select, warmup, playing, roundEnd, matchEnd).
- Fields: state, details, party_size, party_max, start_timestamp, large_image_key, large_image_text, small_image_key, small_image_text.
- Estimated work: 4 hours including testing.

### Activities (when we tackle it)

- Discord's Embedded App SDK loaded inside the game HTML.
- App registered as an Activity in the Discord developer portal.
- Voice-channel API: `discordSDK.commands.getInstanceConnectedParticipants()` returns the live list.
- Estimated work: two to three weeks for a polished v1, longer if we go deep on voice-aware features.

## Open questions

- **Backend hosting choice.** Home Pi + Cloudflare Tunnel as outlined in the broader infra plan, or Cloudflare Workers + D1 + KV for the auth/stats layer? Home is cheaper and the operational story is good for the sub-thousand-active-user range. Workers wins if we want global low latency for slash commands.
- **Match consensus threshold.** Strict (all participants must agree) or majority (most participants agree)? Strict means a single dropped peer ruins the stat record. Majority opens an attack vector if a majority of peers in a small match are colluding. Probably strict for ranked, majority with a flag for casual.
- **Identity portability.** Do we want to enable players to claim their Discord-keyed history under a passkey identity later, in case they leave Discord? Probably yes; design the player_id schema with a portable internal UUID and Discord ID as a linkable account, not the primary key.
- **Activities region availability.** Discord Activities are still being rolled out region-by-region. Verify the integration works across our actual player base before making it the sole onboarding path.
- **Bot hosting separate from API?** Easier to ship as one process, but if the bot crashes it can take the API down. Probably split eventually; one process is fine for v1.
- **Pitch to Discord DevRel.** When and how to approach. Probably wait until we have v1 of Activities working and a small but real player base demonstrating engagement. The pitch writes itself once there's a demo: "every layer of this game integrates with your platform; we built it Discord-first."

## Appendix: Why this might be unique

There are widely-played games that integrate with Discord (Rich Presence is common, OAuth is common). There are Discord Activities that exist (Watch Together, Poker Night, etc.). What does not yet exist (as far as we know) is a multiplayer game where:

- The voice channel is the lobby (Activities does this for some games, but rarely for combat games).
- The community pipeline for user-generated content runs entirely through Discord (slash command submission, emoji voting, threshold-based promotion into the live game).
- Stats, leaderboards, ranks, tournaments, mentor matching, anti-toxicity, all live in Discord channels and roles instead of a separate app or website.
- The game is otherwise serverless P2P (Trystero gameplay, possibly WebTorrent assets), so Discord's social and identity layers are the only "infrastructure" the game touches.

The result is a game with effectively no platform of its own. It lives inside Discord. The only thing we run is a tiny stats backend and a bot. That's a unique architectural posture, and it's the kind of thing Discord's DevRel team should want to amplify because it showcases the entire platform stack at indie scale.

---

License: same as the rest of LSS-related design docs in this repo. The framework concepts are CC-BY-4.0; the LSS-specific implementation plan is internal.
