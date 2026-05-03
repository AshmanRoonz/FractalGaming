# Open letter to Discord, re: Activity sandbox limits for browser games

To the Discord Activities / Embedded Apps team

I'm Ashman Roonz. I'm an indie developer building **Last Ship Sailing** (LSS), a zero-gravity 3D ship-combat game that runs in the browser at https://lss.fractalreality.ca. The game is a hobby project, free to play, designed Discord-first ; we use Discord OAuth for identity, the LSS Discord server is the community hub, and we'd love for Activities to be the way friends play together in voice channels. We've registered our application (id 1500305353210855615), set up URL Mappings, and committed our entire architecture to making Discord the social layer.

I'm writing because, after months of building toward Activities, we've hit a wall that I don't think is intentional ; or at least, I don't think the costs of the current Activity sandbox have been weighed against the games that bounce off it. This letter is a friendly request to revisit those tradeoffs, and a list of the specific restrictions that broke our game when we tried to ship as an Activity. We've left our URL Mapping pointing at the actual game (rather than swapping in a workaround stub) so that whoever reviews our app sees these blocks firsthand.

## What the sandbox blocked when we tried to ship

When we launched LSS as an Activity in a voice channel, the iframe sandbox + Content Security Policy you serve broke six things that are foundational to how a modern browser game works:

1. **WebXR / `xr-spatial-tracking`** is denied by the iframe permissions policy, which kills VR support entirely. LSS supports Meta Quest headsets ; players can fly the ship in VR. Inside an Activity, that capability is silently blocked: `Permissions policy violation: xr-spatial-tracking is not allowed in this document.`
2. **Screen Wake Lock** is denied. Long matches let the screen sleep, breaking the experience: `Access to Screen Wake Lock features is disallowed by permissions policy.`
3. **External CDN fonts** are blocked by `style-src 'self' 'unsafe-inline' blob:`. We were loading Orbitron + Rajdhani from `fonts.googleapis.com` ; the Activity falls back to system fonts, which makes our visual identity disappear.
4. **External CDN scripts** are blocked by `script-src 'self' 'unsafe-eval' 'nonce-...' blob:`. We use html2canvas from jsDelivr for screenshot generation; the Activity blocks it.
5. **Inline `onclick` handlers** in HTML are blocked by the same CSP. Every button in our lobby, ship select, settings panel, and HUD is written as `onclick="someFunction()"` ; this is a 35,000-line single-HTML-file game with hundreds of inline handlers. Inside the Activity, none of them fire. The game silently doesn't respond to clicks.
6. **`window.open()`** is hard-blocked because the iframe sandbox doesn't include `allow-popups`. We tried the obvious workaround ; build a tiny "Activity stub" that runs in the iframe and pops the full game out into a new browser window where it can run without the constraints above ; and even that's denied: *Blocked opening URL in a new window because the request was made in a sandboxed frame whose 'allow-popups' permission is not set.*

We even loaded the Discord Embedded App SDK locally and tried `discordSdk.commands.openExternalLink()`. That's the official escape hatch. It also failed.

## The shape of the problem

Each of these restrictions is, individually, a defensible security choice. CSP without `'unsafe-inline'` prevents a class of XSS attacks. No `allow-popups` keeps malicious Activities from spawning ad windows. Permissions-policy denials prevent fingerprinting / tracking abuse. I get it.

But, taken together, they make Activities **incompatible with any non-trivial existing browser game**. Games written before Activities existed have inline handlers everywhere, fonts on Google's CDN, libraries on jsDelivr, WebXR for VR, fullscreen for immersion. The cost of porting to Activities isn't "wrap it in your SDK." It's "rewrite years of code to a different security model that doesn't match how the rest of the web works." For a hobby project that means abandoning a third of the work.

The popup workaround would let us preserve those games as-is and launch them as full browser windows from a thin Activity launcher. That's a perfectly reasonable pattern; many older Activities do exactly this. Closing that path means the only way to ship a serious game as an Activity is to rewrite it from scratch under the sandbox's constraints.

## What I'd ask Discord to consider

Three concrete asks, in increasing order of effort on your side:

### 1. Allow `allow-popups` in the iframe sandbox by default

This is the single change that would unblock most existing browser games today. The popup pattern is universally understood, the user has to actively click a button to trigger it, browser-level popup blockers still apply, and the Discord client can't be hijacked by it (the popup is a top-level window, fully separate from Discord). The risk surface is tiny; the benefit is enormous. With this one change, every existing browser game can be wrapped as an Activity stub in a few hours instead of weeks.

### 2. Provide a per-app capability opt-in for verified Activities

Have a "capabilities" section in the Discord developer portal where verified app owners can request specific iframe permissions (xr, screen-wake-lock, fullscreen, allow-popups, allow-modals, etc.) with a brief justification. Discord reviews on verification, grants what makes sense. This is the model used by Chrome extensions, Android apps, Apple's TCC permissions, every modern platform. It lets developers build seriously while letting Discord control what's deployed at scale.

### 3. Loosen CSP for verified Activities to allow named CDN origins

Have a list of trusted origins (Google Fonts, jsDelivr, unpkg, cdnjs, the SDK's own CDN) that verified Activities can load from. The CSP can stay strict for unverified apps. Verified apps get a wider safelist. This is how every other developer platform handles "we trust this origin enough to let our verified developers use it."

## Why this matters beyond LSS

I'm one developer with one game, but the people I talk to in indie game dev circles run into this exact wall. They look at Activities, they're excited about voice-channel-as-lobby, they spend a weekend trying to integrate, and they bounce off the sandbox. Most don't write you this letter; they just go back to publishing on itch.io and Steam, and Discord doesn't get the games. That's a missed opportunity for the platform.

The games that DO ship as Activities are mostly small, casual ones that were built specifically for the sandbox. Watch Together, Poker Night, sketch tools. Those are great. But they're not the only kind of game that wants to live inside Discord. There's a whole class of P2P browser games, indie 3D titles, VR experiments, music apps, and creative tools that would meaningfully change Discord's identity as a platform if they could ship as Activities. The current sandbox keeps them out.

## What's at the URL Mapping right now

For this review, we've left our root URL Mapping pointing at the full LSS game, not the popup-stub workaround. Launch it in a voice channel and you'll see the full set of console errors firsthand: CSP blocks, permissions denials, inline-handler failures, the sandbox popup-block on our SDK escape attempt. The game tries to load gracefully (degraded fonts, no WebXR, partial rendering), but the lobby buttons are dead because of the inline-handler CSP. That's the experience players get if they try to launch us as an Activity today.

I'm not making this case angrily. I love what Activities could be. Voice-channel matchmaking is genuinely magical when it works, and I'd love LSS to be one of the games that proves it. But right now the door is closed for serious browser games, and I don't think it's closed on purpose.

If anything in this letter is unclear, or you'd like to test specifics with our team (of one), I'm at ashroney@gmail.com or in the LSS Discord server (linked from https://lss.fractalreality.ca). Happy to be a guinea pig for less-restrictive Activity capabilities, happy to volunteer LSS as a test case for any new opt-in capability scheme. Mostly I just want to ship the game to my friends through the platform we already use to talk to each other.

Thank you for reading this far.

Ashman Roonz
ashroney@gmail.com
https://lss.fractalreality.ca
https://fractalreality.ca

---

**Cc:** This letter is also archived publicly at the LSS repo as a record of the review correspondence and as a reference for any other indie devs who hit the same wall.
