"""Deploy LSS to Cloudflare Pages.

Mirrors the LSS/ directory (the site root since the v36.09 restructure) into
a staging dir (robocopy /MIR = incremental, fast after the first run),
excluding dev-only weight (old_versions, old_plans, __pycache__), then copies
the repo-root extras that also live on the public site (see EXTRA_* below) and
runs `wrangler pages deploy`. Cloudflare dedupes uploads by content hash, so
only changed files transfer on repeat deploys.

Usage:  py -3.11 tools/deploy_cf.py            (deploys)
        py -3.11 tools/deploy_cf.py --stage    (staging copy only, no upload)
"""
import subprocess, sys, os, shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "LSS")          # site root: LSS/ is what deploys
STAGE = os.path.join(os.path.dirname(REPO), "FractalGaming_deploy")
PROJECT = "lss"
EXCLUDE_DIRS = [".git", ".claude", "backups", "old_versions", "old_plans",
                "__pycache__", "node_modules",
                # (v37.67) the hi-poly ship SOURCES (~195 MB) lived in LSS/ships_original and
                # then in a hand-made "New folder" - both inside the site root, both would have
                # uploaded. They now live in assets_base/ships_original ; these stay as a guard.
                "ships_original", "New folder",
                # (v38.45) LSS/old_files - retired art that stays in the repo and off the CDN.
                # The painted PNG cockpit frames (34 MB) and the mock folder's unreferenced
                # source/scratch images (28 MB) were 19% of the deploy for something the ghost
                # seat view replaced. The mock *.json geometry the circumpunct HUD still fetches
                # stays where it is - only the images moved.
                "old_files"]
# Dev-only files that live in LSS/ but have no business on the live site.
# index-working.html is the commented SOURCE (4.2 MB) that strip.py turns into
# the shipped index.html; lss.map.md is the internal architecture map. Together
# they were 4.6 MB of every upload — and on the v36.48 deploy the run died with
# ECONNRESET three times in a row, always at 389/392, i.e. on exactly the
# changed big files. Dropping these more than halves the changed-byte payload.
# (/MIR means robocopy also DELETES them from the staging dir on the next run.)
EXCLUDE_FILES = ["index-working.html", "lss.map.md"]

# (2026-08-16) LINK ROT FIX. The v36.09 restructure made LSS/ the deploy root,
# which silently took labs/ and the standalone root games OFF the live site.
# That is not a quiet 404: the Pages project answers every unknown path with
# index.html (200), so fractalreality.ca's ~40 lss.fractalreality.ca/labs/*.html
# links, the game's own in-HUD goopling.html link, and every old
# ashmanroonz.github.io/FractalGaming/... URL (GitHub 301s them here via the
# root CNAME) all started loading LSS instead of the page they asked for.
# These extras get staged NEXT TO LSS/ so those URLs resolve again — nothing
# moves in the repo, the layout documented in lss.map.md stays as it is.
EXTRA_DIRS = ["labs"]                        # repo-root dir -> /<name>/ on the site
EXTRA_FILES = ["goopling.html", "table_legends.html", "baseball_blitz.html"]

def run(cmd, ok_codes=(0,)):
    print(">", " ".join(cmd))
    r = subprocess.run(cmd, shell=False)
    if r.returncode not in ok_codes:
        sys.exit(f"FAILED ({r.returncode}): {' '.join(cmd)}")
    return r.returncode

# robocopy exit codes 0-7 are success variants.
xd = []
for d in EXCLUDE_DIRS:
    xd += ["/XD", os.path.join(SRC, d)]
xf = []
for f in EXCLUDE_FILES:
    xf += ["/XF", os.path.join(SRC, f)]
# The extras are absent from SRC, so /MIR's purge would delete them from STAGE
# on every run (then the extras pass below re-copies them — churn, and a window
# where the staging dir is wrong). Exclude their DEST paths from the mirror.
for d in EXTRA_DIRS:
    xd += ["/XD", os.path.join(STAGE, d)]
for f in EXTRA_FILES:
    xf += ["/XF", os.path.join(STAGE, f)]
run(["robocopy", SRC, STAGE, "/MIR", "/NFL", "/NDL", "/NJH", "/NP"] + xd + xf,
    ok_codes=(0, 1, 2, 3, 4, 5, 6, 7))
# ⚠ /MIR does NOT purge these. Its purge only removes dest files that are ABSENT
# from source; an /XF file is present-but-skipped, so a copy left over from an
# earlier deploy would sit in the staging dir forever and keep getting uploaded.
# Delete them explicitly.
for f in EXCLUDE_FILES:
    p = os.path.join(STAGE, f)
    if os.path.exists(p):
        os.remove(p)
        print("purged from staging:", f)

# Repo-root extras -> staging root. Each EXTRA_DIRS entry gets its own /MIR
# (safe: it owns its subdir). The loose files are copied WITHOUT /MIR — a /MIR
# rooted at REPO would mirror the whole repository over the staging dir and
# purge everything LSS just wrote. Dropping a name from EXTRA_FILES later
# leaves its stale copy in STAGE (it is /XF-excluded above, so nothing purges
# it); delete it by hand or wipe the staging dir.
for d in EXTRA_DIRS:
    xdd = []
    for x in EXCLUDE_DIRS:
        xdd += ["/XD", os.path.join(REPO, d, x)]
    run(["robocopy", os.path.join(REPO, d), os.path.join(STAGE, d),
         "/MIR", "/NFL", "/NDL", "/NJH", "/NP"] + xdd,
        ok_codes=(0, 1, 2, 3, 4, 5, 6, 7))
if EXTRA_FILES:
    run(["robocopy", REPO, STAGE] + EXTRA_FILES + ["/NFL", "/NDL", "/NJH", "/NP"],
        ok_codes=(0, 1, 2, 3, 4, 5, 6, 7))
print("staged ->", STAGE)

if "--stage" not in sys.argv:
    # (2026-08-23) wrangler is no longer globally installed on this machine;
    # fall back to `npx --yes wrangler` (uses the npm cache, auth comes from
    # the saved wrangler OAuth config either way).
    wr = shutil.which("wrangler.cmd" if os.name == "nt" else "wrangler")
    cmd = [wr] if wr else [shutil.which("npx.cmd" if os.name == "nt" else "npx") or "npx", "--yes", "wrangler"]
    run(cmd + ["pages", "deploy", STAGE,
               "--project-name", PROJECT, "--branch", "main",
               "--commit-dirty=true"])
    print("deployed. Preview: https://lss-61y.pages.dev")
