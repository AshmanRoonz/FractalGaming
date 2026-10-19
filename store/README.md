# Store kit: how to put one of the web apps into an app store

Created: 2026-09-29
Last updated: 2026-09-29
Version: 1.1

A store version of any of these apps is **the live page, opened full screen by a thin store package**. Nothing is copied into the package, so every deploy reaches store players at the same moment it reaches the web. A new store upload is needed only when the name, icon, start URL or package settings change.

Which apps go where is decided in [`PLAN.md`](PLAN.md). Last Ship Sailing is not one of them (owner's decision, 2026-09-29).

This folder sits at the repo root, so it is never deployed.

## Where the apps are hosted

| Origin | Serves | Deployed by |
|---|---|---|
| `lss.fractalreality.ca` | `labs/`, `goopling.html`, `table_legends.html`, `baseball_blitz.html` (next to LSS) | `tools/deploy_cf.py` (Cloudflare Pages, cache rules in `LSS/_headers`) |
| `fractalreality.ca` | the Fractal_Reality `docs/` pages | GitHub Pages workflow `deploy-docs.yml` on push to main |

An Android store app proves ownership of its origin with `/.well-known/assetlinks.json` at that origin's root. One file can list several apps, so all store apps on one origin share it. A Play app's navigation stays in full screen anywhere on its origin, so check that the app has no links into pages you don't want inside it.

## Per-app checklist (what the web side needs)

1. **A manifest file** (`manifest.webmanifest`) linked with `<link rel="manifest">`. It needs `name`, `short_name`, `id`, `start_url`, `scope` (the app's own folder or page), `display` (`standalone` or `fullscreen`), `background_color`, `theme_color`, and icons:
   - 192 and 512 px PNG icons with `"purpose": "any"`.
   - 512 px maskable icons, with the subject inside the central 80 % circle.

   Chrome will not offer to install a page without these, and PWABuilder and Bubblewrap read the manifest by URL.
2. **An offline screen.** Add a small service worker that answers a failed page navigation with a cached `offline.html` and touches nothing else. Without it, an offline launch shows the browser's own error page.
   - Use static routing (`event.addRoutes`) so every subresource goes to the network without waking the worker.
   - Enable navigation preload so the page request doesn't wait for the worker.
   - Write the kill switch into the file's header: a replacement `sw.js` that unregisters itself on activate.
3. **Store mode, if the app shows any payment or donate link.** Launch the package with `?store=<id>` in its start URL. Keep the flag in `sessionStorage` so it never leaks into a browser tab, and hide the payment or donate links while it is set.
   - Two launch signals back up the parameter: a Play TWA's `android-app://<package id>` referrer, and the Microsoft Store's documented `app-info://platform/microsoft-store` referrer on the first navigation.
   - Store rules: outside the US, UK and EEA, Google Play requires Play Billing for digital items and bars links to other payment methods. Microsoft Store policy 10.8.1(a) requires Microsoft's commerce for games. Both allow users to use items they bought elsewhere, as long as the app has no purchase path.
   - Donate buttons: the clear allowance found for donations is registered charities linking out to a browser, and Play Billing itself is not for donations. A developer's own PayPal donate button (DEADDROP's is the current case) is safest hidden in store builds.
4. **A privacy policy URL.** Google Play asks every app for one, and the Microsoft Store requires one when an app transmits personal data (peer-to-peer join does). One studio-wide page can cover all the apps.
5. **Real screenshots.** Every store requires screenshots of the app itself; key art does not count.

## Microsoft Store (recommended first)

Microsoft Store is the easiest first listing:

- Registration is free for individuals (worldwide since 2025-09-10).
- There is no tester gate.
- Review typically takes 24 to 48 hours.
- Its audience has keyboards, mice and gamepads, which suits the labs.

Steps:

1. **Create a Partner Center account as an individual.** You verify with a government ID and a selfie.
   - The publisher name shown to users is then your own name.
   - Policy 10.14: publishing as "FractalReality.ca" requires a **company** account, which needs a D-U-N-S number or business registration documents.
2. **Reserve the app name.** Then go to Product management > Product identity and copy the Package ID, Publisher ID and Publisher display name.
3. **Package the app in PWABuilder** (<https://www.pwabuilder.com/>). Choose Package for stores > Windows, and paste the three identity values.
4. **Submit** the `.msixbundle` and `.classic.appxbundle` files with the listing. The listing needs a category, the IARC age rating, the privacy policy URL and screenshots.

## Google Play

Costs and requirements:

- US$25, one time.
- Legal name and government ID.
- **Proof that you have a physical Android 10+ phone**, done through the Play Console app.

**The gate:** a personal account created after 2023-11-13 must run a **closed test with 12 testers who stay opted in for 14 consecutive days** before it can publish to production. Most sources say this applies to each app.

1. **Package the app in PWABuilder** (Android):
   - Package id: `ca.fractalreality.<app>`
   - Start URL: the app's page, plus `?store=play` if it uses store mode
   - Signing key: **new**

   Download the zip. It contains the `.aab`, the signing key and a sample `assetlinks.json`.
2. **Back up the signing key and its passwords in two places.** Losing the upload key means you cannot ship updates without a support request.
3. **Check the target SDK.** Since 2026-08-31, Play requires new apps to target **API 36**, with an extension available to 2026-11-01. Some PWABuilder builds in mid-2026 still produced 35, so confirm the generated build's `targetSdkVersion`. Bubblewrap CLI v1.25.0 targets 36 if PWABuilder falls short.
4. **Upload to Play Console.** Use Internal testing first, then Closed testing for the 12 x 14 gate. Keep Play App Signing on (the default).
5. **Add Digital Asset Links.** Without this, the app shows a browser URL bar.
   1. In Play Console, open Setup > App signing and copy the **app signing key SHA-256**.
   2. Fill it into `assetlinks.template.json`, together with the upload key's fingerprint.
   3. Publish the result at `https://<origin>/.well-known/assetlinks.json`.
   4. Confirm the URL returns the JSON, not a 404 page. On Cloudflare Pages that also proves the dot-folder was uploaded; on GitHub Pages, check the Actions artifact includes it.
6. **Fill in the listing:** content rating (IARC), target audience, ads (none) and data safety.

## Meta Quest (Horizon Store)

- The Horizon Store accepts WebXR PWAs and 2D PWAs, packaged with Meta's Bubblewrap fork `@meta-quest/bubblewrap-cli`.
- In-app purchases can only use Meta's Digital Goods API.
- None of the current candidates is a WebXR app, so this is optional.

## Apple App Store (later)

Costs and build requirements:

- US$99 per year.
- Uploads must be built with Xcode 26. That can be a Mac, Xcode Cloud (25 free hours a month), a GitHub Actions `macos-26` runner, or Codemagic.

Review rules 4.2 and 2.5.2 put a wrapper that only loads a website at risk of rejection as a "repackaged website". The dependable route is to bundle the app's files inside the build, for example with Capacitor, including local copies of anything loaded from a CDN. The single-file apps (Goopling, the smaller tools) are the easiest to bundle.

## Not a store package

- **itch.io:** HTML5 uploads are capped at 1,000 files and 500 MB. The single-file games fit easily, and the labs could go up as one bundle.
- **Steam:** US$100 per app, refunded after US$1,000 in revenue. It needs a desktop wrapper project (Electron, NW.js or Tauri); not researched further here.
- **Samsung Galaxy Store** needs commercial-seller status even for free apps. **Amazon Appstore** has left non-Amazon Android devices. Skip both.

## Revision history

- 2026-09-29 v1.1: made generic; LSS is not going to a store (owner's decision), so its v49.88 web-side kit was reverted; the checklist now describes what any app needs
- 2026-09-29 v1.0: initial; web side shipped in LSS v49.88, steps for Microsoft Store, Google Play, Meta Quest, notes for Apple, itch.io and Steam
