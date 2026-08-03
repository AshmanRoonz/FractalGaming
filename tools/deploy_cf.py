"""Deploy LSS to Cloudflare Pages.

Mirrors the repo into a staging dir (robocopy /MIR = incremental, fast after
the first run), excluding dev-only weight (.git, .claude worktrees, backups,
old_versions), then runs `wrangler pages deploy`. Cloudflare dedupes uploads
by content hash, so only changed files transfer on repeat deploys.

Usage:  py -3.11 tools/deploy_cf.py            (deploys)
        py -3.11 tools/deploy_cf.py --stage    (staging copy only, no upload)
"""
import subprocess, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE = os.path.join(os.path.dirname(REPO), "FractalGaming_deploy")
PROJECT = "lss"
EXCLUDE_DIRS = [".git", ".claude", "backups", "old_versions", "old_plans",
                "__pycache__", "node_modules"]

def run(cmd, ok_codes=(0,)):
    print(">", " ".join(cmd))
    r = subprocess.run(cmd, shell=False)
    if r.returncode not in ok_codes:
        sys.exit(f"FAILED ({r.returncode}): {' '.join(cmd)}")
    return r.returncode

# robocopy exit codes 0-7 are success variants.
xd = []
for d in EXCLUDE_DIRS:
    xd += ["/XD", os.path.join(REPO, d)]
run(["robocopy", REPO, STAGE, "/MIR", "/NFL", "/NDL", "/NJH", "/NP"] + xd,
    ok_codes=(0, 1, 2, 3, 4, 5, 6, 7))
print("staged ->", STAGE)

if "--stage" not in sys.argv:
    run(["wrangler.cmd" if os.name == "nt" else "wrangler",
         "pages", "deploy", STAGE,
         "--project-name", PROJECT, "--branch", "main",
         "--commit-dirty=true"])
    print("deployed. Preview: https://lss-61y.pages.dev")
