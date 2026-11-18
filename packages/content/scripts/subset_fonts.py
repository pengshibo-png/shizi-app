"""Subset LXGW WenKai down to the glyphs this app actually renders.

Bundling the full 24.7 MB Kai face is wasteful; the app only ever shows the 1800
taught characters, the interface vocabulary, digits and CJK punctuation.

Output: packages/content/assets/fonts/wenkai-subset.woff2
"""

import json
import subprocess
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent
FONTS = PKG / "assets" / "fonts"
SRC = PKG / "fonts-src" / "LXGWWenKai-Regular.ttf"
CHARS = PKG / "data" / "characters.json"
OUT = FONTS / "wenkai-subset.woff2"

# 界面固定文案 + 标点 + 数字。宁可多带几百字，也别以后为了一个新词重新子集化。
UI_TEXT = (
    "今天的课剩余项学习新字复习我的字数学科普继续开始听一听下一个"
    "正确再想想完成好了太棒了回家休息明天见进度已学在学未学"
    "第天周月年汉字拼音笔画部首组词例句意思是读法"
    "家长留言设置提醒时间目标每日统计正确率用时累计连续中断"
    "关闭返回退出确定取消保存删除重来跳过提示帮助"
    "一二三四五六七八九十百千万零两半几多少大小上下左右前后内外中"
    "早上中午下午晚上今明昨每天每周每月每年春夏秋冬"
    "元角分钱块毛斤两克千克米厘米升毫升度分秒时"
    "对错是不是能不能会不会有没有要不要好不好"
    "知识卡片题问答题选择判断答案解释原因方法注意小心安全"
    "医院药店银行超市市场公交地铁火车飞机电话手机"
    "血压血糖体温心率体重身高年龄性别姓名地址"
)

# 标点与符号
PUNCT = (
    "，。？！、：；“”‘’（）《》【】—…·～"
    "0123456789"
    "％＋－×÷＝／"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " .,:;!?()[]{}<>-_/\\|@#$%^&*+=~`\"'"
)


def main():
    if not SRC.exists():
        sys.exit(f"FATAL: 缺少源字体 {SRC}")

    data = json.loads(CHARS.read_text(encoding="utf-8"))
    chars = "".join(c["char"] for c in data["characters"])
    glyphs = "".join(dict.fromkeys(chars + UI_TEXT + PUNCT))

    textfile = FONTS / "_glyphs.txt"
    textfile.write_text(glyphs, encoding="utf-8")

    subsetter = Path(sys.executable).parent / "pyftsubset.exe"
    if not subsetter.exists():
        subsetter = Path(sys.executable).parent / "Scripts" / "pyftsubset.exe"
    cmd = [
        str(subsetter),
        str(SRC),
        f"--text-file={textfile}",
        f"--output-file={OUT}",
        "--flavor=woff2",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
    ]
    print("running:", " ".join(cmd[:3]), "...")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"pyftsubset failed:\n{r.stdout}\n{r.stderr}")

    src_mb = SRC.stat().st_size / 1024 / 1024
    out_kb = OUT.stat().st_size / 1024
    print(f"✓ 字体子集化完成")
    print(f"  字形数    {len(glyphs)}")
    print(f"  源文件    {src_mb:.2f} MB")
    print(f"  子集      {out_kb:.0f} KB  ({out_kb/1024:.2f} MB)")
    print(f"  压缩比    {src_mb*1024/out_kb:.1f}x")
    print(f"  输出      {OUT}")

    textfile.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
