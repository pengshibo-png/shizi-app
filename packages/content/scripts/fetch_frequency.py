"""Fetch Jun Da's Modern Chinese character frequency list.

Source: 现代汉语语料库字频表 (Jun Da, MTSU)
  https://lingua.mtsu.edu/chinese-computing/statistics/char/list.php?Which=MO

The page embeds a tab-separated <pre> block:
  rank <TAB> char <TAB> frequency <TAB> cumulative% <TAB> pinyin <TAB> gloss

We only need (rank, char, frequency). Frequency order is what lets us extend the
MOE functional 1500 core up to 1800 with genuinely common characters rather than
falling back to the stroke-ordered 一级字表.

Output: packages/content/data/char-frequency.json
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.parent.mkdir(parents=True, exist_ok=True)

URL = "https://lingua.mtsu.edu/chinese-computing/statistics/char/list.php?Which=MO"

CACHE = OUT.parent / "cache" / "junda-freq.html"


def fetch():
    if CACHE.exists():
        return CACHE.read_bytes()
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=90).read()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(raw)
    return raw


raw = fetch()
text = raw.decode("gb18030", errors="replace")

m = re.search(r"<pre>(.*?)</pre>", text, re.S | re.I)
if not m:
    sys.exit("FATAL: no <pre> block found — page layout changed")

# Rows are separated by literal "<br>" tags, not newlines:
#   1\t的\t7922684\t4.094325317834\tde/di2/di4\t(possessive particle)/of...
#   2\t一\t3050722\t...
block = m.group(1)
rows = []
for rank_s, ch, freq_s in re.findall(r"(\d{1,5})\t([\u4e00-\u9fff])\t(\d+)", block):
    rows.append({"rank": int(rank_s), "char": ch, "freq": float(freq_s)})

# de-duplicate defensively, keeping the best rank
seen = {}
for r in rows:
    if r["char"] not in seen:
        seen[r["char"]] = r
ordered = sorted(seen.values(), key=lambda r: r["rank"])

if len(ordered) < 3000:
    sys.exit(f"FATAL: only parsed {len(ordered)} characters — expected 9000+")

OUT.write_text(
    json.dumps(
        {
            "source": "现代汉语语料库字频表 (Jun Da, MTSU)",
            "url": URL,
            "chars": "".join(r["char"] for r in ordered),
            "entries": ordered,
            "count": len(ordered),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ),
    encoding="utf-8",
)

print(f"parsed {len(ordered)} ranked characters")
print("top 30:", "".join(r["char"] for r in ordered[:30]))
print("wrote", OUT)
