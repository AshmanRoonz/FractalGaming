# Store kit: getting Last Ship Sailing into app stores

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.0

The store versions of Last Ship Sailing are **the live site, opened full screen by a thin store package**. Nothing is copied into the package, so every `tools/deploy_cf.py` reaches store players at the same moment it reaches the web. A new store upload is needed only when the name, icon, start URL or package settings change.

This folder sits at the repo root, so it is never deployed. The web side of the kit lives in `LSS/` and shipped in build v49.88 (see `LSS/lss.map.md`, entry v49.88).

## What is already in place (v49.88)

| File | What it does |
|---|---|
| `LSS/manifest.webmanifest` | The app manifest, as a real file. It replaces the inline `data:` URI, which had no icons and so was never installable. |
| `LSS/icons/` | 192 and 512 px icons, plus maskable versions (the ship stays inside the Android safe circle) and the Apple touch icon. They are cropped from `LSS_landscape.png`. |
| `LSS/sw.js` | Shows a branded offline screen when a page cannot load. It caches nothing the game runs on, so the `_headers` cache policy and instant build rollout are unchanged. Its kill switch is written at the top of the file. |
| `LSS/offline.html` | The "No Signal" screen. It reloads itself when the connection returns. |
| `LSS/_headers` | Adds `no-cache` for `sw.js`, the manifest, `offline.html` and `/.well-known/*`, and a one-week cache for `icons/*`. |
| Store mode (`index-working.html`) | When the page runs as a store package, it hides unowned premium liveries and the DONATE link, never opens the buy bar, and never prints a price. Liveries a player already owns still paint. |

### Store mode

A package marks itself with `?store=<id>` in its start URL. The page reads that value, keeps it in `sessionStorage` for the app session, and removes it from the address bar. If a package is ever built without the parameter, two launch signals back it up:

- A Google Play TWA arrives with the referrer `android-app://ca.fractalreality.lss`.
- The Microsoft Store sends the documented referrer `app-info://platform/microsoft-store` on its first navigation.

**Why it hides the shop.** Outside the US, UK and EEA, Google Play requires Play Billing for in-game items. Microsoft Store policy 10.8.1(a) requires Microsoft's commerce for **games** in every market. Both stores allow "consumption-only": using items bought elsewhere, as long as the app has no purchase path. The PayPal checkout that went live on 2026-09-28 therefore stays on the web.

**To test it on the web:** open `https://lss.fractalreality.ca/?store=play`. DONATE and unowned premium liveries disappear. Open `?store=off` to turn store mode off again.

| Store | Package id | Start URL | Status |
|---|---|---|---|
| Microsoft Store | from Partner Center | `https://lss.fractalreality.ca/?store=msstore` | ready to package |
| Google Play | `ca.fractalreality.lss` | `https://lss.fractalreality.ca/?store=play` | ready to package |
| Meta Quest (Horizon Store) | `ca.fractalreality.lss` | `https://lss.fractalreality.ca/?store=quest` | ready to package |
| Apple App Store | n/a | `?store=appstore` | needs design work (see below) |

The Play package id is also written into a regex in `index-working.html`: `Jump: STORE BUILDS AND THE SERVICE WORKER`. If you choose a different id, change the regex too.

## Step 0: before any store

1. Deploy v49.88 with `tools/deploy_cf.py`.
2. Check that `https://lss.fractalreality.ca/manifest.webmanifest` loads.
3. In Chrome, open DevTools > Application > Manifest. It should show no errors, and the address bar should offer **Install**.
4. Run the site through <https://www.pwabuilder.com/>. Its report card should find the manifest, icons and service worker.
5. Capture **real gameplay screenshots**. Every store wants them, and key art does not count. Take landscape shots on desktop (1920x1080) and on a phone.
6. Keep the privacy policy and terms at stable URLs. Every store asks for `https://lss.fractalreality.ca/privacy.html`; terms are at `/terms.html`.

## Step 1: Microsoft Store (recommended first)

Microsoft Store is the easiest first listing:

- Registration is free for individuals (worldwide since 2025-09-10).
- There is no tester gate.
- Review typically takes 24 to 48 hours.
- Its audience has keyboards, mice and gamepads.

Steps:

1. **Create a Partner Center account as an individual.** You verify with a government ID and a selfie.
   - The publisher name shown to players is then your own name.
   - Policy 10.14: publishing as "FractalReality.ca" requires a **company** account, which needs a D-U-N-S number or business registration documents.
2. **Reserve the name "Last Ship Sailing".** Then go to Product management > Product identity and copy the Package ID, Publisher ID and Publisher display name.
3. **Package the app in PWABuilder.** Choose Package for stores > Windows, and paste the three identity values.
   - If the options offer a start URL, use `/?store=msstore`. Otherwise the Store's launch referrer marks the build.
4. **Submit** the `.msixbundle` and `.classic.appxbundle` files. For the listing:
   - Category: Games (Action).
   - Age rating: complete the IARC questionnaire.
   - Privacy policy: the URL from Step 0.
   - Pricing: free.
5. **Commerce.** The Store build sells nothing. To sell there later, use the Digital Goods API with `https://store.microsoft.com/billing`. Microsoft commerce is required for games (policy 10.8.1(a)).

## Step 2: Google Play

Costs and requirements:

- US$25, one time.
- Legal name and government ID.
- **Proof that you have a physical Android 10+ phone**, done through the Play Console app.

**The gate:** a personal account created after 2023-11-13 must run a **closed test with 12 testers who stay opted in for 14 consecutive days** before it can publish to production. Start recruiting on the Discord and r/LastShipSailing early, because this is the long pole.

1. **Package the app in PWABuilder** (Android):
   - Package id: `ca.fractalreality.lss`
   - App name: Last Ship Sailing
   - Launcher name: Last Ship
   - Start URL: `/?store=play`
   - Display: fullscreen
   - Signing key: **new**

   Download the zip. It contains the `.aab`, the signing key and a sample `assetlinks.json`.
2. **Back up the signing key and its passwords in two places.** Losing the upload key means you cannot ship updates without a support request.
3. **Check the target SDK.** Since 2026-08-31, Play requires new apps to target **API 36**, with an extension available to 2026-11-01. Some PWABuilder builds in mid-2026 still produced 35, so confirm the generated build's `targetSdkVersion`. Bubblewrap CLI v1.25.0 targets 36 if PWABuilder falls short.
4. **Upload to Play Console.** Use Internal testing first, then Closed testing for the 12 x 14 gate. Keep Play App Signing on (the default).
5. **Add Digital Asset Links.** Without this, the app shows a browser URL bar.
   1. In Play Console, open Setup > App signing and copy the **app signing key SHA-256**.
   2. Put it into `store/assetlinks.template.json`, together with the upload key's fingerprint from the PWABuilder zip.
   3. Save the result as `LSS/.well-known/assetlinks.json` and deploy.
   4. Confirm that `https://lss.fractalreality.ca/.well-known/assetlinks.json` returns the JSON and not the 404 page. This also confirms that `wrangler` uploaded the dot-folder.
6. **Fill in the listing:**
   - Content rating: IARC.
   - Target audience: pick an age band that matches the combat.
   - Ads: none.
   - Data safety: match `privacy.html`. Discord sign-in is optional, and match stats go to the Worker.
7. **Commerce.** The Play build sells nothing. To sell later, add the `playBilling` feature (Digital Goods API) to the TWA. A US-only or UK/EEA link-out is possible under the 2026 programs, but it needs native Play Billing Library work that a plain TWA does not have.

**Test on a real device before release:**

- Discord sign-in. It is a full-page redirect, so it should come back into the app. If the Discord app is installed, confirm that the OAuth hand-off returns to the TWA.
- Touch controls in fullscreen.
- Launching offline shows "No Signal".
- `?store=play` behaviour: no DONATE, no locked liveries.

## Step 3: Meta Quest (Horizon Store)

LSS already runs WebXR, and the Horizon Store accepts WebXR PWAs.

- Package with Meta's Bubblewrap fork, `@meta-quest/bubblewrap-cli` (v1.24.1 as of 2026-05), using start URL `/?store=quest`.
- In-app purchases can only use Meta's Digital Goods API, so the Quest build sells nothing, like the others.

## Later: Apple App Store (needs a decision first)

Costs and build requirements:

- US$99 per year.
- Uploads must be built with Xcode 26. That can be a Mac, Xcode Cloud (25 free hours a month), a GitHub Actions `macos-26` runner, or Codemagic.

Two review rules shape the design:

- **4.2 and 2.5.2:** a wrapper that only loads the live site is at risk of rejection as a "repackaged website". The dependable route is to bundle the game inside the app, for example with Capacitor. That is a separate build of roughly 193 MB of assets.
- **3.1.3(b):** a multiplatform game may honour items bought elsewhere only if those items are **also sold through in-app purchase** in the iOS app. An iOS build must therefore either sell the liveries through StoreKit, or not paint web purchases. Store mode currently still paints owned liveries, which is correct for Play, Microsoft and Quest but not for Apple.

## Not a store package

- **itch.io.** The launcher page in `itch/` can go up now. A full upload is capped at 1,000 files and 500 MB. The deployable `LSS/` is 461 files and 473 MB, which fits, but only just. The bigger problem is that Discord sign-in, the Worker API and the PayPal return all expect the `lss.fractalreality.ca` origin, so a copy hosted on itch would lose them. Keep the launcher.
- **Steam.** US$100 per app, refunded after US$1,000 in revenue. It suits this game's keyboard, mouse and gamepad audience. It needs a desktop wrapper project (Electron, NW.js or Tauri); not researched further here.
- **Samsung Galaxy Store** needs commercial-seller status even for free apps. **Amazon Appstore** has left non-Amazon Android devices. Skip both.

## Revision history

- 2026-09-29 v1.0: initial; web side shipped in LSS v49.88, steps for Microsoft Store, Google Play, Meta Quest, notes for Apple, itch.io and Steam
