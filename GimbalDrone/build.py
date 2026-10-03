#!/usr/bin/env python3
"""build.py - build the Gimbal Drone copy: the drone twin of the repo-root strip.py.

    python GimbalDrone/build.py            # from the repo root

    GimbalDrone/index-working.html  (commented source, the copy to mod)
        -> GimbalDrone/index.html   (lean shell)
        +  GimbalDrone/gd.js        (the engine script, cache-busted with GD_BUILD)

It IMPORTS LSS's strip.py read-only and reuses its comment scanner and its
safety checks (every code line byte-identical to the source, `node --check`
passes, the split is lossless). strip.py itself is never modified or run.

The one difference from strip.py's split: the copy's <head> sets
<base href="../LSS/"> so the engine finds LSS's assets, which means the
engine script has to be addressed as ../GimbalDrone/gd.js (relative to that
base). Bump GD_BUILD in index-working.html on every build so browsers fetch
the new gd.js.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.dont_write_bytecode = True        # do not leave a __pycache__ beside LSS's strip.py
sys.path.insert(0, ROOT)
import strip as lss_strip              # read-only reuse of the LSS stripper

SRC = os.path.join(HERE, "index-working.html")
DST = os.path.join(HERE, "index.html")
JS = os.path.join(HERE, "gd.js")


def split_game_script(lines):
    """Lift the engine <script> (the block holding _bootLSS) into gd.js."""
    bi = next(i for i, l in enumerate(lines) if "function _bootLSS" in l)
    op = max(i for i in range(bi)
             if re.search(r"<script(\s|>)", lines[i])
             and 'type="module"' not in lines[i] and "importmap" not in lines[i])
    cl = next(i for i in range(bi, len(lines)) if "</script>" in lines[i])
    if lines[op].strip() != "<script>" or lines[cl].strip() != "</script>":
        sys.exit("build: engine script tags are not on their own lines; refusing to split.")
    js = lines[op + 1:cl]
    m = next((re.search(r"const GD_BUILD = ['\"]([^'\"]+)['\"]", l) for l in js if "const GD_BUILD = " in l), None)
    if not m:
        sys.exit("build: no `const GD_BUILD = \"...\"` in the engine script (fork.py adds it).")
    build = m.group(1)
    tag = '<script src="../GimbalDrone/gd.js?v=%s"></script>' % build
    return lines[:op] + [tag] + lines[cl + 1:], js, build, tag


def main():
    src, crlf = lss_strip.read_lines(SRC)
    rem = lss_strip.scan_removable(src)
    result = [l for l, r in zip(src, rem) if not r]
    if lss_strip.codeonly(result) != lss_strip.codeonly(src):
        sys.exit("SAFETY FAIL: stripping changed a code line. Not writing.")
    ok, msg = lss_strip.node_check(result)
    if not ok:
        sys.exit("SAFETY FAIL: node --check failed:\n%s\nNot writing." % msg)
    html, js, build, tag = split_game_script(result)
    i = html.index(tag)
    if html[:i] + ["<script>"] + js + ["</script>"] + html[i + 1:] != result:
        sys.exit("SAFETY FAIL: the gd.js split is not lossless. Not writing.")
    nl = "\r\n" if crlf else "\n"
    open(JS, "wb").write(nl.join(js).encode("utf-8"))
    open(DST, "wb").write(nl.join(html).encode("utf-8"))
    sys.stderr.write("src=%d lines, removed %d comment lines; wrote %s (%d lines, GD build %s) and %s (%d lines)\n"
                     % (len(src), sum(rem), JS, len(js), build, DST, len(html)))


if __name__ == "__main__":
    main()
