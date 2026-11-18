"""Parse the three MOE literacy-guideline XLS attachments into tiered character lists.

Source: 教育部《扫盲教育课程设置及教学材料编写指导纲要》(教基一〔2011〕1号)
  http://www.moe.gov.cn/srcsite/A06/s3321/201104/t20110425_120118.html

The three attachments are the frequency tiers we rely on:
  f1 = 592 最高频字
  f2 = 358 次高频字
  f3 = 550 非高频字

Output: packages/content/data/moe-tiers.json
"""

import json
import re
import sys
from pathlib import Path

import xlrd

TMP = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.parent.mkdir(parents=True, exist_ok=True)

CJK = re.compile(r"[\u4e00-\u9fff]")


def harvest(path):
    """Pull every CJK character from Sheet1, in reading order.

    Row 0 is the table title ('附表N 最高频字（592个）…'); it is not data and
    would contribute characters such as 附/表/最/高/频/字/个 to the tier.
    Only Sheet1 holds the list; Sheet2/Sheet3 are empty scratch sheets.
    """
    book = xlrd.open_workbook(str(path))
    chars = []
    sheet = book.sheet_by_index(0)
    for row in range(1, sheet.nrows):
        for col in range(sheet.ncols):
            cell = sheet.cell_value(row, col)
            if isinstance(cell, str):
                chars.extend(CJK.findall(cell))
    # dedupe, keep first occurrence
    seen, out = set(), []
    for c in chars:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


tiers = {}
for idx, key in enumerate(["592", "358", "550"], start=1):
    path = TMP / f"f{idx}.xls"
    got = harvest(path)
    tiers[key] = got
    print(f"f{idx}.xls -> tier {key}: {len(got)} chars")

combined = []
seen = set()
for key in ["592", "358", "550"]:
    for c in tiers[key]:
        if c not in seen:
            seen.add(c)
            combined.append(c)

print(f"combined unique: {len(combined)}")

OUT.write_text(
    json.dumps(
        {
            "source": "教育部《扫盲教育课程设置及教学材料编写指导纲要》附件",
            "url": "http://www.moe.gov.cn/srcsite/A06/s3321/201104/t20110425_120118.html",
            "tiers": tiers,
            "combined": combined,
            "counts": {k: len(v) for k, v in tiers.items()},
        },
        ensure_ascii=False,
        indent=1,
    ),
    encoding="utf-8",
)

# sanity: tier sizes are the documented 592 / 358 / 550
expected = {"592": 592, "358": 358, "550": 550}
for k, want in expected.items():
    if len(tiers[k]) != want:
        print(f"WARN tier {k}: expected {want}, got {len(tiers[k])}")
print("wrote", OUT)
