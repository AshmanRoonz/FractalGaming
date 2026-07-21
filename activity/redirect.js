// Discord Activity entry shim (loaded by ../index.html as its FIRST script).
//
// Why this exists: the Discord dev-portal URL mapping for app
// 1500305353210855615 points "/" at lss.fractalreality.ca's DOMAIN ROOT, so
// launching the Activity loads the full game inside Discord's iframe. The
// Discord client's CSP blocks the game's external CDN imports (three.js via
// cdn.jsdelivr.net, trystero via esm.sh) -> THREE never arrives -> black
// screen. The launcher stub at /activity/ (ENGAGE -> Embedded App SDK
// openExternalLink) is what should load in there instead.
//
// This shim is a plain SAME-ORIGIN script, which the client's
// script-src 'self' CSP allows (inline scripts are blocked). When -- and only
// when -- the page is served through *.discordsays.com at a non-/activity
// path, it swaps in the /activity/ stub, preserving the query string
// (frame_id, instance_id, ...) the stub forwards to the real game.
//
// Everywhere else (lss.fractalreality.ca, localhost, file://) it is a no-op.
(function () {
  try {
    var h = String(location.hostname || '');
    if (h.length > 16 && h.slice(-16) === '.discordsays.com' &&
        location.pathname.indexOf('/activity') !== 0) {
      location.replace('/activity/' + location.search);
    }
  } catch (_) {}
})();
