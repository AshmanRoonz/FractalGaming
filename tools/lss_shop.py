#!/usr/bin/env python3
"""LSS shop admin - products, grants and purchases, straight against D1 through wrangler.

No admin endpoint and no ADMIN_KEY involved: wrangler's own login is the credential, so this works
wherever `wrangler whoami` does. Every write to PRODUCTION asks first unless --yes is given.

  python tools/lss_shop.py products                           what is premium / on sale
  python tools/lss_shop.py price <skin|sku> <usd> ["TITLE"]   make a livery premium, e.g. price img_diamond 2.99
  python tools/lss_shop.py bundle <sku> <usd> "TITLE" <sku1,sku2,...>
  python tools/lss_shop.py retire <skin|sku>                  stop selling it (owners keep it, still premium)
  python tools/lss_shop.py unretire <skin|sku>
  python tools/lss_shop.py free <skin|sku>                    delete the product: free for everyone again
  python tools/lss_shop.py find <name>                        find a player's discord id by name
  python tools/lss_shop.py owned <discord_id>
  python tools/lss_shop.py grant <discord_id> <skin|sku> [--note "..."] [--paid 2.99]
  python tools/lss_shop.py revoke <discord_id> <skin|sku> [--note "..."]
  python tools/lss_shop.py purchases [--status completed] [--limit 50]

  --local   target the `wrangler dev` D1 in LSS/backend/dev/.state instead of production
  --yes     do not ask before writing to production

A bare name like `img_diamond` means the livery `skin:img_diamond`; it is checked against SHIP_SKINS
in LSS/index-working.html so a typo cannot create a product for a skin that does not exist.

`grant --paid 2.99` is the manual-sale path (someone paid through a plain PayPal link): it records a
'manual' purchase row with the amount, so manual sales show up next to checkout ones in `purchases`.
"""
import json, os, re, secrets, shutil, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(REPO, "LSS", "backend")
SOURCE = os.path.join(REPO, "LSS", "index-working.html")
ID_RE = re.compile(r"^\d{5,25}$")
SKU_RE = re.compile(r"^[a-z0-9][a-z0-9_:\-]{0,63}$")


def die(msg):
    sys.exit("lss_shop: " + msg)


def wrangler_cmd():
    w = shutil.which("wrangler.cmd" if os.name == "nt" else "wrangler") or shutil.which("wrangler")
    if w:
        js = os.path.join(os.path.dirname(w), "node_modules", "wrangler", "bin", "wrangler.js")
        if os.path.exists(js):
            # Calling node on the JS entry directly keeps cmd.exe (and its quoting rules) out of the
            # path - SQL full of quotes goes through argv untouched.
            return [shutil.which("node") or "node", js]
        return [w]
    return [shutil.which("npx.cmd" if os.name == "nt" else "npx") or "npx", "--yes", "wrangler"]


def d1(sql, local):
    where = ["--local", "--persist-to", "dev/.state"] if local else ["--remote"]
    cmd = wrangler_cmd() + ["d1", "execute", "lss-stats", "--json", "--command", sql] + where
    r = subprocess.run(cmd, cwd=BACKEND, capture_output=True, text=True, encoding="utf-8")
    out = r.stdout or ""
    if r.returncode != 0 or "[" not in out:
        die("wrangler failed:\n" + (r.stderr or out)[-2000:])
    data = json.loads(out[out.index("["):])
    rows = []
    for block in data:
        rows.extend(block.get("results") or [])
    return rows


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def skin_ids():
    try:
        src = open(SOURCE, encoding="utf-8").read()
        a = src.index("const SHIP_SKINS = {")
        b = src.index("const SHIP_SKIN_DEFAULT", a)
        return set(re.findall(r"\bid:\s*'([a-z0-9_]+)'", src[a:b]))
    except Exception:
        return None


def to_sku(arg):
    arg = arg.strip()
    sku = arg if ":" in arg else "skin:" + arg
    if not SKU_RE.match(sku):
        die("not a valid sku: " + arg)
    if sku.startswith("skin:"):
        ids = skin_ids()
        if ids is not None and sku[5:] not in ids:
            die(f"no SHIP_SKINS entry '{sku[5:]}' (have: {', '.join(sorted(ids))})")
    return sku


def cents(usd):
    try:
        c = round(float(usd) * 100)
    except ValueError:
        die("not a price: " + usd)
    if c <= 0 or c > 100000:
        die("price out of range: " + usd)
    return c


def confirm(local, yes, what):
    if local or yes:
        return
    ans = input(f"PRODUCTION: {what}\nProceed? [y/N] ").strip().lower()
    if ans not in ("y", "yes"):
        die("cancelled")


def flag(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            die(name + " needs a value")
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def fmt_time(ms):
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(ms) / 1000)) if ms else "-"


def main():
    args = sys.argv[1:]
    local = "--local" in args
    yes = "--yes" in args
    args = [a for a in args if a not in ("--local", "--yes")]
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd, rest = args[0], args[1:]
    now = int(time.time() * 1000)

    if cmd == "products":
        rows = d1("SELECT p.sku, p.title, p.price_cents, p.currency, p.active, p.grants_json, "
                  "(SELECT COUNT(*) FROM entitlements e WHERE e.sku = p.sku AND e.revoked_at IS NULL) AS owners "
                  "FROM products p ORDER BY p.sort, p.sku", local)
        if not rows:
            print("(no products - every livery is free)")
        for r in rows:
            extra = json.loads(r["grants_json"] or "[]")
            print(f"{r['sku']:<32} {r['price_cents']/100:>7.2f} {r['currency']}  "
                  f"{'ON SALE' if r['active'] else 'retired':<8} owners={r['owners']:<4} {r['title']}"
                  + (f"  +{','.join(extra)}" if extra else ""))

    elif cmd in ("price", "bundle"):
        if len(rest) < 2:
            die(f"usage: {cmd} <sku> <usd> [\"TITLE\"]" + (" <sku1,sku2>" if cmd == "bundle" else ""))
        sku, c = to_sku(rest[0]), cents(rest[1])
        title = rest[2] if len(rest) > 2 else sku.split(":", 1)[-1].replace("img_", "").replace("_", " ").upper()
        grants = []
        if cmd == "bundle":
            if len(rest) < 4:
                die('usage: bundle <sku> <usd> "TITLE" <sku1,sku2,...>')
            grants = [to_sku(s) for s in rest[3].split(",") if s.strip()]
        kind = "bundle" if grants else "skin"
        confirm(local, yes, f"{sku} = {c/100:.2f} USD '{title}'" + (f" granting {grants}" if grants else ""))
        d1("INSERT INTO products (sku, kind, title, price_cents, currency, active, grants_json, sort, created_at, updated_at) "
           f"VALUES ({q(sku)}, {q(kind)}, {q(title)}, {c}, 'USD', 1, {q(json.dumps(grants))}, 0, {now}, {now}) "
           "ON CONFLICT(sku) DO UPDATE SET title = excluded.title, price_cents = excluded.price_cents, "
           "kind = excluded.kind, grants_json = excluded.grants_json, active = 1, updated_at = excluded.updated_at", local)
        print(f"{sku} is premium at {c/100:.2f} USD")

    elif cmd in ("retire", "unretire"):
        if len(rest) != 1:
            die(f"usage: {cmd} <sku>")
        sku = to_sku(rest[0])
        confirm(local, yes, f"{cmd} {sku}")
        d1(f"UPDATE products SET active = {0 if cmd == 'retire' else 1}, updated_at = {now} WHERE sku = {q(sku)}", local)
        print(f"{sku}: {'retired (owners keep it, nobody can buy it)' if cmd == 'retire' else 'on sale again'}")

    elif cmd == "free":
        if len(rest) != 1:
            die("usage: free <sku>")
        sku = to_sku(rest[0])
        confirm(local, yes, f"delete product {sku} - it becomes FREE for every player")
        d1(f"DELETE FROM products WHERE sku = {q(sku)}", local)
        print(f"{sku} is free for everyone (entitlement rows are kept as history)")

    elif cmd == "find":
        if len(rest) != 1:
            die("usage: find <name>")
        like = "%" + rest[0].replace("%", "").replace("_", "\\_") + "%"
        rows = d1("SELECT discord_id, username, display_name, total_matches, last_seen FROM players "
                  f"WHERE username LIKE {q(like)} ESCAPE '\\' OR display_name LIKE {q(like)} ESCAPE '\\' "
                  "ORDER BY last_seen DESC LIMIT 25", local)
        for r in rows:
            print(f"{r['discord_id']:<22} {r['display_name'] or '':<24} @{r['username']:<24} "
                  f"matches={r['total_matches']:<5} last seen {fmt_time(r['last_seen'])}")
        if not rows:
            print("(nobody by that name has signed in)")

    elif cmd == "owned":
        if len(rest) != 1 or not ID_RE.match(rest[0]):
            die("usage: owned <discord_id>")
        rows = d1("SELECT sku, source, purchase_id, granted_at, revoked_at, note FROM entitlements "
                  f"WHERE discord_id = {q(rest[0])} ORDER BY granted_at", local)
        for r in rows:
            state = "REVOKED " + fmt_time(r["revoked_at"]) if r["revoked_at"] else "owned"
            print(f"{r['sku']:<32} {state:<24} via {r['source']:<7} {fmt_time(r['granted_at'])}  "
                  f"{r['purchase_id'] or ''} {r['note'] or ''}")
        if not rows:
            print("(owns nothing)")

    elif cmd == "grant":
        note = flag(rest, "--note")
        paid = flag(rest, "--paid")
        if len(rest) != 2 or not ID_RE.match(rest[0]):
            die('usage: grant <discord_id> <sku> [--note "..."] [--paid 2.99]')
        who, sku = rest[0], to_sku(rest[1])
        pid = None
        stmts = []
        if paid is not None:
            c = cents(paid)
            pid = "pur_manual_" + secrets.token_hex(6)
            stmts.append("INSERT INTO purchases (id, discord_id, sku, provider, provider_order, provider_capture, status, "
                         "amount_cents, currency, created_at, updated_at, completed_at, note) VALUES "
                         f"({q(pid)}, {q(who)}, {q(sku)}, 'manual', NULL, NULL, 'completed', {c}, 'USD', {now}, {now}, {now}, {q(note)})")
        stmts.append("INSERT INTO entitlements (discord_id, sku, source, purchase_id, granted_at, revoked_at, note) VALUES "
                     f"({q(who)}, {q(sku)}, 'grant', {q(pid)}, {now}, NULL, {q(note)}) "
                     "ON CONFLICT(discord_id, sku) DO UPDATE SET revoked_at = NULL, source = excluded.source, "
                     "purchase_id = COALESCE(excluded.purchase_id, entitlements.purchase_id), "
                     "note = COALESCE(excluded.note, entitlements.note), "
                     "granted_at = CASE WHEN entitlements.revoked_at IS NULL THEN entitlements.granted_at ELSE excluded.granted_at END")
        known = d1(f"SELECT display_name, username FROM players WHERE discord_id = {q(who)}", local)
        name = (known[0]["display_name"] or known[0]["username"]) if known else "(has never signed in - it will be waiting for them)"
        confirm(local, yes, f"grant {sku} to {who} {name}" + (f", recording a manual sale of {paid} USD" if paid else ""))
        d1("; ".join(stmts), local)
        print(f"granted {sku} to {who} {name}")

    elif cmd == "revoke":
        note = flag(rest, "--note")
        if len(rest) != 2 or not ID_RE.match(rest[0]):
            die('usage: revoke <discord_id> <sku> [--note "..."]')
        who, sku = rest[0], to_sku(rest[1])
        confirm(local, yes, f"revoke {sku} from {who}")
        d1(f"UPDATE entitlements SET revoked_at = {now}, note = COALESCE({q(note)}, note) "
           f"WHERE discord_id = {q(who)} AND sku = {q(sku)} AND revoked_at IS NULL", local)
        print(f"revoked {sku} from {who}")

    elif cmd == "purchases":
        status = flag(rest, "--status")
        limit = flag(rest, "--limit", "50")
        if not limit.isdigit():
            die("--limit must be a number")
        where = f"WHERE p.status = {q(status)}" if status else ""
        rows = d1("SELECT p.id, p.discord_id, pl.display_name, p.sku, p.provider, p.status, p.amount_cents, p.currency, "
                  "p.created_at, p.provider_order, p.note FROM purchases p LEFT JOIN players pl ON pl.discord_id = p.discord_id "
                  f"{where} ORDER BY p.created_at DESC LIMIT {int(limit)}", local)
        for r in rows:
            print(f"{fmt_time(r['created_at'])}  {r['status']:<10} {r['amount_cents']/100:>7.2f} {r['currency']}  "
                  f"{r['sku']:<28} {r['display_name'] or r['discord_id']:<20} {r['provider']:<6} "
                  f"{r['provider_order'] or r['id']} {r['note'] or ''}")
        if not rows:
            print("(no purchases)")
    else:
        die("unknown command: " + cmd + " (try --help)")


if __name__ == "__main__":
    main()
