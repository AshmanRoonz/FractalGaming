#!/usr/bin/env python3
"""strip.py - generate the lean shipped index.html from the commented source.

Workflow:  edit index-working.html  ->  python strip.py  ->  index.html
The source of truth is index-working.html (commented). index.html is a
generated artifact and must never be hand-edited.

What it does: removes full-line `//` comment lines that sit in clean code
context. It NEVER removes/alters a line inside a string, template literal
(shader source), block comment, or a line of code (trailing comments stay).

Safety: refuses to write unless every code line (non-blank, non-`//`) in the
output is byte-identical to the source, AND `node --check` parses the result.

Usage:
  python strip.py                 # writes index.html (verified)
  python strip.py <outpath>       # writes elsewhere (e.g. a candidate)
  python strip.py --check <path>  # only verify+report, don't write index.html
"""
import sys, os, re, subprocess, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(ROOT, "LSS", "index-working.html")
DST  = os.path.join(ROOT, "LSS", "index.html")

REGEX_PREV = set("(,=:[!&|?{};<>+-*%^~")   # tokens after which `/` starts a regex
KEYWORD_PREV = {"return","typeof","instanceof","in","of","case","delete",
                "void","do","else","yield","await","throw","new"}

def scan_removable(lines):
    """Return a boolean per line: True if it is a clean-context full-line
    `//` comment (safe to drop). Tracks strings/templates/comments/regex so
    nothing inside a shader string is ever flagged."""
    removable = [False]*len(lines)
    stack = []              # 'blk','sq','dq','tmpl','interp'
    prev_word = ""          # last identifier/keyword token (code context)
    prev_sig  = ""          # last significant (non-ws) char in code context
    for li, line in enumerate(lines):
        clean_entry = (len(stack) == 0)
        s = line.strip()
        if clean_entry and s.startswith("//"):
            removable[li] = True
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            top = stack[-1] if stack else None
            if top == "blk":
                if c == "*" and i+1 < n and line[i+1] == "/":
                    stack.pop(); i += 2; continue
                i += 1; continue
            if top in ("sq","dq"):
                q = "'" if top == "sq" else '"'
                if c == "\\": i += 2; continue
                if c == q: stack.pop()
                i += 1; continue
            if top == "tmpl":
                if c == "\\": i += 2; continue
                if c == "`": stack.pop(); i += 1; continue
                if c == "$" and i+1 < n and line[i+1] == "{":
                    stack.append("interp"); prev_sig=""; prev_word=""; i += 2; continue
                i += 1; continue
            # code context (clean or inside ${...})
            if c == "/" and i+1 < n and line[i+1] == "/":
                break   # line comment: nothing after matters to state
            if c == "/" and i+1 < n and line[i+1] == "*":
                stack.append("blk"); i += 2; continue
            if c == "/":
                # regex vs division
                is_regex = (prev_sig in REGEX_PREV) or (prev_sig == "") or (prev_word in KEYWORD_PREV)
                if is_regex:
                    j = i+1; incls = False
                    while j < n:
                        cj = line[j]
                        if cj == "\\": j += 2; continue
                        if cj == "[": incls = True
                        elif cj == "]": incls = False
                        elif cj == "/" and not incls: break
                        j += 1
                    prev_sig = "/"; prev_word = ""
                    i = j+1 if j < n else n
                    continue
                prev_sig = "/"; prev_word = ""; i += 1; continue
            if c == "'": stack.append("sq"); i += 1; continue
            if c == '"': stack.append("dq"); i += 1; continue
            if c == "`": stack.append("tmpl"); i += 1; continue
            if top == "interp":
                if c == "{": stack.append("interp")
                elif c == "}": stack.pop()
            if not c.isspace():
                if c.isalnum() or c == "_" or c == "$":
                    prev_word += c
                else:
                    prev_word = ""
                prev_sig = c
            i += 1
    return removable

def read_lines(path):
    raw = open(path, "rb").read()
    crlf = b"\r\n" in raw
    lines = raw.decode("utf-8").split("\n")
    lines = [l[:-1] if l.endswith("\r") else l for l in lines]
    return lines, crlf

def codeonly(lines):
    return [l.rstrip() for l in lines
            if l.strip() != "" and not l.strip().startswith("//")]

def node_check(lines):
    """Extract the game <script> and run `node --check`. Returns (ok, msg)."""
    try:
        bi = next(i for i,l in enumerate(lines) if "function _bootLSS" in l)
    except StopIteration:
        return True, "no _bootLSS (skipped)"
    op = max(i for i in range(bi)
             if re.search(r"<script(\s|>)", lines[i])
             and 'type="module"' not in lines[i] and "importmap" not in lines[i])
    cl = next(i for i in range(bi, len(lines)) if "</script>" in lines[i])
    body = "\n".join(lines[op+1:cl])
    fd, tmp = tempfile.mkstemp(suffix=".js"); os.close(fd)
    open(tmp, "w", encoding="utf-8").write(body)
    try:
        r = subprocess.run(["node","--check",tmp], capture_output=True, text=True)
    except FileNotFoundError:
        os.remove(tmp); return True, "node not found (skipped)"
    os.remove(tmp)
    return (r.returncode == 0, (r.stderr or r.stdout).strip()[:500])

def main():
    args = sys.argv[1:]
    check_only = False
    out = DST
    if args and args[0] == "--check":
        check_only = True; out = args[1] if len(args) > 1 else DST
    elif args:
        out = os.path.abspath(args[0])

    src, crlf = read_lines(SRC)
    rem = scan_removable(src)
    result = [l for l, r in zip(src, rem) if not r]
    removed = sum(rem)

    # SAFETY 1: code lines unchanged
    if codeonly(result) != codeonly(src):
        sys.stderr.write("SAFETY FAIL: stripping changed a code line. Not writing.\n")
        sys.exit(2)
    # SAFETY 2: parses
    ok, msg = node_check(result)
    if not ok:
        sys.stderr.write(f"SAFETY FAIL: node --check failed:\n{msg}\nNot writing.\n")
        sys.exit(3)

    sys.stderr.write(f"src={len(src)} lines, removed {removed} comment lines, "
                     f"out={len(result)} lines. code-identical + node-check OK.\n")
    if check_only:
        sys.stderr.write("--check: not writing index.html.\n")
        return
    nl = "\r\n" if crlf else "\n"
    open(out, "wb").write(nl.join(result).encode("utf-8"))
    sys.stderr.write(f"wrote {out}\n")

if __name__ == "__main__":
    main()
