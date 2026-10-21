# Phi Resonance on Google Play: the listing kit

Created: 2026-10-19
Last updated: 2026-10-21
Version: 1.2

Everything to paste or upload in Play Console, in the order Play asks for it. The screenshots are real captures from the owner's Pixel 9, taken over USB on 2026-10-19 with build v1.7; the Presets one was retaken with build v1.8, whose footer is one link to fractalreality.ca. The wording follows "Positioning" in `../README.md`: a sound tool for relaxation, focus and exploration, never a treatment.

## Main store listing

Play Console, Grow users, Store presence, Main store listing:

| Field | Value |
|---|---|
| App name (30) | Phi Resonance (13) |
| Short description (80) | Golden-ratio sound lab: binaural, isochronic and drone tones for calm and focus. (80) |
| Full description (4,000) | paste `play-description.txt` (1,674) |
| App icon, 512 × 512 | `play/icon-512.png` |
| Feature graphic, 1024 × 500 | `play/feature-graphic.png` |
| Phone screenshots, 1080 × 1920, in this order | `play/phone-1-session.png`, `phone-2-composer.png`, `phone-3-breath.png`, `phone-4-visual-beat.png`, `phone-5-together.png`, `phone-6-presets.png` |

Tablet screenshots are optional; leave them out.

## Store settings

- **Category:** Health & Fitness. Music & Audio would also fit; Health & Fitness is what `../README.md` and `../../store/PLAN.md` chose.
- **Tags:** up to five from Play's list, for example meditation, relaxation and sleep sounds, whichever are offered.
- **Contact details:** an email address (Play shows it on the listing) and the website, `https://fractalreality.ca`.
- **Price:** the app is paid. Set the price under Monetize, App pricing, once the payments profile is set up. Keep it paid from the first upload: a free app can never become paid.

## App content

Policy and programs, App content:

| Form | Answer |
|---|---|
| Privacy policy | `https://fractalreality.ca/phi_resonance_privacy.html` |
| App access | All functionality is available without special access (no account). |
| Ads | No ads. |
| Content rating | Fill in the questionnaire: no violence, sexual content, bad language, drugs, gambling or user interaction, no sharing of location, no digital purchases inside the app (the price is paid upfront). |
| Target audience | 18 and over is simplest. Any choice that includes children under 13 brings in the Families policy. |
| Data safety | No data collected, no data shared. The app makes no network requests; saved settings stay on the phone, and exports go only where the owner sends them through the share sheet. |
| Health apps | Declare "Stress management, relaxation, mental acuity". It is not a medical device; the required sentence ends the description and is in the app's About tab. |
| Foreground service | Tick "Media playback". Play asks for a video link: `foreground-service-demo.mp4` (recorded over USB on 2026-10-21 with build v1.9; kept out of git) shows a session starting, the app going to the background, and the notification with its Stop button. Upload it to YouTube as Unlisted and paste the link. |
| Government, financial, health research, news | None of these apply. |

## Release and testing

1. **Build the bundle.** In PowerShell, run `..\scripts\build_release.ps1`.
   - The first run makes the upload key (keytool asks for a new password twice). It keeps the key at `%USERPROFILE%\phi-resonance-keys\phi-resonance-upload.jks`, outside the repo. Back up that file and its password: every future update must be signed with it.
   - Every run asks for the password and builds `android\app\build\outputs\bundle\release\phi-resonance-<versionName>-<versionCode>.aab` (`phi-resonance-1.0.1-2.aab` since 2026-10-21; the 1.0 bundle, code 1, had no playback notification).
   - Google Play re-signs the app for phones with its own key (Play App Signing), which it offers on the first upload.
2. **Closed test.**
   - Testing, Closed testing: create a track and choose the countries.
   - Under Testers, add a Google Group's email address.
   - Upload the `.aab`, write release notes ("First test release"), then review and roll out.
3. **Tester page.** Copy the opt-in link and the Google Group's address. The two buttons on `fractalreality.ca/phi_resonance_testers.html` are waiting for them.
4. **Fourteen days.** At least 12 testers stay opted in for 14 days in a row. Testers of a paid app on a closed track buy it; only internal testing installs a paid app free, and it does not count.
5. **Production.** Dashboard, Apply for production access, then publish.
6. **Every later upload:** raise `versionCode` in `android/app/build.gradle` first (and `versionName` when users should see a new number).

## Remaking the graphics

`python store-listing/make_graphics.py [raw_dir]`, from `phi_resonance/`. With phone captures in `raw_dir` it crops and frames them again; without, it reframes the kept crops in `screens/`. Change a caption or the feature graphic in the script, then run it.

## Revision history

- 2026-10-19 v1.0: initial
- 2026-10-21 v1.2: the foreground-service video (recorded with build v1.9) and the 1.0.1 bundle name
- 2026-10-19 v1.1: the Presets screenshot retaken with the app's one-link footer (build v1.8)
