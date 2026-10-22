#!/usr/bin/env python3
"""Store an API key in DSH's local credential file without echoing it.

Usage: python3 scripts/set-credential.py [NAME]   (default NAME: OPENROUTER_API_KEY)

Writes `refs: { NAME: <value> }` into $DSH_HOME/.credentials.yaml (default
~/.dsh/.credentials.yaml), keeping every other line as is, mode 0600, atomic
replace. DSH reloads the file automatically. The value is read with getpass,
so it never appears on screen, in shell history, or in a chat transcript.
"""
import getpass
import os
import re
import sys
import tempfile

name = sys.argv[1] if len(sys.argv) > 1 else "OPENROUTER_API_KEY"
if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", name):
    sys.exit(f"invalid name: {name}")

home = os.environ.get("DSH_HOME") or os.path.expanduser("~/.dsh")
path = os.path.join(home, ".credentials.yaml")

value = getpass.getpass(f"{name} を貼り付けて Enter（画面には出ません）: ").strip()
if not value:
    sys.exit("空なので何もしません")
if any(c in value for c in "\n\r\"'#: ") or not value.isprintable():
    sys.exit("キーに使えない文字（空白・引用符・#・: など）が含まれています。貼り付け直してください")

lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else ["version: 1"]
if not any(re.match(r"^version:\s*1\s*$", l) for l in lines):
    sys.exit(f"{path} の形式が想定外です（version: 1 がありません）。手で確認してください")

entry = f"  {name}: {value}"
refs_at = next((i for i, l in enumerate(lines) if re.match(r"^refs:\s*$", l)), None)
if refs_at is None:
    # Put refs right after the version line.
    v = next(i for i, l in enumerate(lines) if l.startswith("version:"))
    lines[v + 1:v + 1] = ["refs:", entry]
    action = "追加"
else:
    end = refs_at + 1
    while end < len(lines) and (lines[end].startswith(" ") or not lines[end].strip()):
        end += 1
    existing = next((i for i in range(refs_at + 1, end) if re.match(rf"^\s+{name}:", lines[i])), None)
    if existing is not None:
        lines[existing] = entry
        action = "上書き"
    else:
        lines.insert(refs_at + 1, entry)
        action = "追加"

fd, tmp = tempfile.mkstemp(dir=home, prefix=".credentials.", suffix=".tmp")
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise
print(f"{name} を {path} に{action}しました（値は表示しません、長さ {len(value)} 文字）")
