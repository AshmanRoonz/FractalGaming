#!/usr/bin/env python3
"""
Bake announcer lines into static MP3 files using ElevenLabs.

Usage:
    ELEVENLABS_API_KEY=sk_... python3 bake.py            # idempotent (skip existing)
    ELEVENLABS_API_KEY=sk_... python3 bake.py --force    # re-bake everything
    python3 bake.py --dry                                # print the plan, no API calls

Optional env vars:
    ELEVENLABS_VOICE_ID  - override lines.json voice.id
    ELEVENLABS_MODEL_ID  - override model_id (default eleven_turbo_v2_5)

Output (next to this script):
    <sha256-16>.mp3      one per unique text
    manifest.json        { hash: { key, text, bytes } }  used by the client snippet

Requires only the Python 3 standard library; no pip install needed.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-bake every line even if the MP3 exists")
    ap.add_argument("--dry",   action="store_true", help="print the plan without calling ElevenLabs")
    args = ap.parse_args()

    config_path = HERE / "lines.json"
    if not config_path.exists():
        sys.stderr.write(f"error: {config_path} not found\n")
        return 1
    config = json.loads(config_path.read_text(encoding="utf-8"))

    api_key  = os.environ.get("ELEVENLABS_API_KEY")
    if not args.dry and not api_key:
        sys.stderr.write("error: ELEVENLABS_API_KEY env var is required (or pass --dry to preview)\n")
        return 1

    voice_cfg = config.get("voice") or {}
    voice_id  = os.environ.get("ELEVENLABS_VOICE_ID") or voice_cfg.get("id")
    model_id  = os.environ.get("ELEVENLABS_MODEL_ID") or voice_cfg.get("model_id") or "eleven_turbo_v2_5"
    settings  = voice_cfg.get("settings") or {"stability": 0.45, "similarity_boost": 0.75, "speed": 1.0}
    ships     = config.get("ships") or []

    if not voice_id:
        sys.stderr.write("error: no voice id (set voice.id in lines.json or pass ELEVENLABS_VOICE_ID env var)\n")
        return 1

    # Expand templates ({ship} -> one entry per ship).
    expanded = []
    for line in config.get("lines", []):
        key  = line["key"]
        text = line["text"]
        if line.get("template") and "{ship}" in text:
            for ship in ships:
                expanded.append({"key": f"{key}__{ship}", "text": text.replace("{ship}", ship)})
        else:
            expanded.append({"key": key, "text": text})

    # Deduplicate by exact text (content-addressed -> same text, same file).
    by_hash = {}
    for entry in expanded:
        h = sha16(entry["text"])
        if h not in by_hash:
            by_hash[h] = {"hash": h, "key": entry["key"], "text": entry["text"]}

    print(f"voice id:     {voice_id}")
    print(f"model id:     {model_id}")
    print(f"unique lines: {len(by_hash)}")
    print(f"total chars:  {sum(len(e['text']) for e in by_hash.values())}")
    print()

    if args.dry:
        for e in by_hash.values():
            preview = json.dumps(e["text"])[:80]
            print(f"  {e['hash']}.mp3  [{e['key']:<28}] {preview}")
        print("\ndry run; no files written, no API calls made.")
        return 0

    HERE.mkdir(parents=True, exist_ok=True)

    baked = 0
    skipped = 0
    total_bytes = 0
    manifest = {}

    for e in by_hash.values():
        out = HERE / f"{e['hash']}.mp3"
        if out.exists() and not args.force:
            bytes_ = out.stat().st_size
            manifest[e["hash"]] = {"key": e["key"], "text": e["text"], "bytes": bytes_}
            total_bytes += bytes_
            skipped += 1
            print(f"skip  {e['hash']}.mp3  ({bytes_} bytes)  [{e['key']}]")
            continue

        print(f"bake  {e['hash']}.mp3  [{e['key']}] ... ", end="", flush=True)
        try:
            audio = synth(api_key, voice_id, model_id, settings, e["text"])
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")[:300]
            sys.stderr.write(f"\n  HTTP {err.code}: {body}\n")
            return 2
        except Exception as err:  # noqa: BLE001
            sys.stderr.write(f"\n  failed: {err}\n")
            return 2
        out.write_bytes(audio)
        manifest[e["hash"]] = {"key": e["key"], "text": e["text"], "bytes": len(audio)}
        total_bytes += len(audio)
        baked += 1
        print(f"{len(audio)} bytes")

    # Sort manifest by key for stable diffs in git.
    sorted_manifest = dict(sorted(manifest.items(), key=lambda kv: kv[1]["key"]))
    (HERE / "manifest.json").write_text(
        json.dumps(sorted_manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print()
    print(f"done. baked={baked} skipped={skipped} totalBytes={total_bytes}")
    print(f"wrote manifest.json ({len(sorted_manifest)} entries)")
    return 0


def sha16(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def synth(api_key: str, voice_id: str, model_id: str, settings: dict, text: str) -> bytes:
    payload = json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": settings,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(voice_id, safe='')}",
        data=payload,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "content-type": "application/json",
            "accept": "audio/mpeg",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


if __name__ == "__main__":
    # urllib.parse is used inside synth() ; make sure it is imported even when
    # running with -B / module-cache disabled.
    import urllib.parse  # noqa: F401
    sys.exit(main())
