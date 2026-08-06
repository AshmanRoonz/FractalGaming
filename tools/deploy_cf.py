"""Deploy LSS to Cloudflare Pages.

Mirrors the LSS/ directory (the site root since the v36.09 restructure) into
a staging dir (robocopy /MIR = incremental, fast after the first run),
excluding dev-only weight (old_versions, old_plans, __pycache__), then runs
`wrangler pages deploy`. Cloudflare dedupes uploads by content hash, so only
changed files transfer on repeat deploys.

Usage:  py -3.11 tools/deploy_cf.py            (deploys)
        py -3.11 tools/deploy_cf.py --stage    (staging copy only, no upload)
"""
import subprocess, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "LSS")          # site root: LSS/ is what deploys
STAGE = os.path.join(os.path.dirname(REPO), "FractalGaming_deploy")
PROJECT = "lss"
EXCLUDE_DIRS = [".git", ".claude", "backups", "old_versions", "old_plans",
                "__pycache__", "node_modules"]
# Dev-only files that live in LSS/ but have no business on the live site.
# index-working.html is the commented SOURCE (4.2 MB) that strip.py turns into
# the shipped index.html; lss.map.md is the internal architecture map. Together
# they were 4.6 MB of every upload — and on the v36.48 deploy the run died with
# ECONNRESET three times in a row, always at 389/392, i.e. on exactly the
# changed big files. Dropping these more than halves the changed-byte payload.
# (/MIR means robocopy also DELETES them from the staging dir on the next run.)
EXCLUDE_FILES = ["index-working.html", "lss.map.md"]

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
print("staged ->", STAGE)

if "--stage" not in sys.argv:
    run(["wrangler.cmd" if os.name == "nt" else "wrangler",
         "pages", "deploy", STAGE,
         "--project-name", PROJECT, "--branch", "main",
         "--commit-dirty=true"])
    print("deployed. Preview: https://lss-61y.pages.dev")
