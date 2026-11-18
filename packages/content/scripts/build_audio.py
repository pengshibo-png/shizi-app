"""build_audio.py — 预生成全部语音资产

为什么必须预生成：中国 Android 的 WebView 经常没有 zh-CN 系统语音包，UC/百度
浏览器根本不支持 speechSynthesis。对一位不认字的老人，"听"就是唯一的入口，
不能赌设备。所以全部音频在构建期生成并打进 APK，运行期零网络、零 TTS 依赖。

## 多音字问题（会直接教错人）

单字合成时 TTS 可能选错读音（"重"读 chóng 而不是 zhòng）。原计划用 edge-tts 的
WordBoundary 事件做"词组触发 + 精确切片"，但**实测该事件已被微软停用**（短词和
整句都返回 0 条 boundary），所以切片方案不可行。

改用「上下文优先」策略：
  - 每个多音字都额外生成一条**载波词**音频（如 重 → 重要）。TTS 在词语上下文里
    读对读音的概率远高于孤立单字。
  - App 教多音字时**优先播放载波词**（同时高亮该字），单字音频作为辅助。
  - 构建产出 review/polyphone.csv 列出全部多音字及其载波词，供人工听测一遍。

## 音频格式

直接保存 edge-tts 返回的 MP3 字节，不再转码（本机没有可用的 ffmpeg，
且原始输出已是 48kHz 单声道 MP3，对老人听读完全够用）。MP3 帧本身可顺序播放。

输出：
  assets/audio/c/<char>.mp3        单字读音
  assets/audio/cw/<char>.mp3       多音字的载波词读音
  assets/audio/w/<word>.mp3        词组读音
  data/audio-manifest.json         清单（文件、字节、类型）

用法：
  python build_audio.py                 # 增量生成
  python build_audio.py --force         # 全部重来
  python build_audio.py --only chars    # 只做单字
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

import edge_tts

PKG = Path(__file__).resolve().parent.parent
DATA = PKG / "data"
AUDIO = PKG / "assets" / "audio"

VOICE_CHAR = "zh-CN-YunjianNeural"   # 男声，沉稳，适合单字示范
VOICE_WORD = "zh-CN-XiaoxiaoNeural"  # 女声，温暖，适合词组/讲解
RATE_CHAR = "-10%"
RATE_WORD = "-15%"

CONCURRENCY = 6
MAX_RETRY = 4


async def synth(text, voice, rate):
    """合成文本，返回 MP3 字节。失败按指数退避重试。"""
    last = None
    for attempt in range(MAX_RETRY):
        try:
            com = edge_tts.Communicate(text, voice, rate=rate)
            audio = bytearray()
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
            if not audio:
                raise RuntimeError("empty audio")
            return bytes(audio)
        except Exception as e:  # noqa: BLE001
            last = e
            await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{text!r} 合成失败（{MAX_RETRY} 次）: {last}")


async def synth_pool(items, worker, concurrency=CONCURRENCY):
    sem = asyncio.Semaphore(concurrency)
    stats = {"ok": 0, "fail": 0, "skip": 0}
    failures = []
    lock = asyncio.Lock()

    async def run(it):
        async with sem:
            try:
                res = await worker(it)
                async with lock:
                    stats["skip" if res == "skip" else "ok"] += 1
            except Exception as e:  # noqa: BLE001
                async with lock:
                    stats["fail"] += 1
                    failures.append((it.get("id"), str(e)))
                print(f"  ✗ {it.get('id')}: {e}", file=sys.stderr)

    await asyncio.gather(*(run(it) for it in items))
    return stats, failures


def pick_carrier(rec, words_by_id):
    """为多音字挑载波词：优先以该字开头、且该字确实在词里。"""
    for wid in rec.get("wordIds", []):
        w = words_by_id.get(wid)
        if w and w["word"].startswith(rec["char"]):
            return w["word"]
    for wid in rec.get("wordIds", []):
        w = words_by_id.get(wid)
        if w and rec["char"] in w["chars"]:
            return w["word"]
    return None


async def build_chars(recs, words_by_id, force):
    out_dir = AUDIO / "c"
    cw_dir = AUDIO / "cw"
    out_dir.mkdir(parents=True, exist_ok=True)
    cw_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}

    async def worker(it):
        rec = it["rec"]
        ch = rec["char"]
        dst = out_dir / f"{ch}.mp3"
        is_poly = len(rec.get("readings") or []) > 1
        carrier = pick_carrier(rec, words_by_id) if is_poly else None
        cw_dst = cw_dir / f"{ch}.mp3" if carrier else None

        done_char = dst.exists() and not force
        done_carrier = (cw_dst is None) or (cw_dst.exists() and not force)
        if done_char and done_carrier:
            return "skip"

        if not done_char:
            dst.write_bytes(await synth(ch, VOICE_CHAR, RATE_CHAR))
        if carrier and not done_carrier:
            cw_dst.write_bytes(await synth(carrier, VOICE_WORD, RATE_WORD))

        manifest[ch] = {
            "audioKey": rec["audioKey"],
            "file": f"c/{ch}.mp3",
            "bytes": dst.stat().st_size,
            "polyphonic": is_poly,
            "carrierWord": carrier,
            "carrierFile": f"cw/{ch}.mp3" if carrier else None,
        }
        return "ok"

    items = [{"id": r["char"], "rec": r} for r in recs]
    return await synth_pool(items, worker)


async def build_words(words, force):
    out_dir = AUDIO / "w"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}

    async def worker(it):
        w = it["word"]
        dst = out_dir / f"{w['word']}.mp3"
        if dst.exists() and not force:
            return "skip"
        dst.write_bytes(await synth(w["word"], VOICE_WORD, RATE_WORD))
        manifest[w["word"]] = {
            "audioKey": w["audioKey"],
            "file": f"w/{w['word']}.mp3",
            "bytes": dst.stat().st_size,
        }
        return "ok"

    items = [{"id": w["word"], "word": w} for w in words]
    return await synth_pool(items, worker)


# ---------------------------------------------------------------- 数学 / 科普讲解

async def build_lessons(items, force, subdir, voice, rate):
    """数学讲解与科普朗读。文本较长，语速放慢。"""
    out_dir = AUDIO / subdir
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}

    async def worker(it):
        key = it["id"]
        dst = out_dir / f"{key}.mp3"
        if dst.exists() and not force:
            return "skip"
        dst.write_bytes(await synth(it["text"], voice, rate))
        manifest[key] = {
            "audioKey": it["audioKey"],
            "file": f"{subdir}/{key}.mp3",
            "bytes": dst.stat().st_size,
        }
        return "ok"

    return await synth_pool(items, worker)


def write_polyphone_review(chars, words_by_id):
    """产出多音字听测清单，供人工确认首教读音。"""
    rows = ["char,day,readings,carrierWord,carrierFile,correct_reading,note"]
    n = 0
    for rec in chars:
        readings = rec.get("readings") or []
        if len(readings) < 2:
            continue
        n += 1
        carrier = pick_carrier(rec, words_by_id) or ""
        rows.append(
            f"{rec['char']},{rec['day']},\"{' / '.join(readings)}\",{carrier},"
            f"cw/{rec['char']}.mp3,,"
        )
    out = PKG / "review" / "polyphone.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\ufeff" + "\n".join(rows), encoding="utf-8")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", choices=["chars", "words", "lessons", "enc"])
    args = ap.parse_args()

    chars_data = json.loads((DATA / "characters.json").read_text(encoding="utf-8"))
    words_data = json.loads((DATA / "words.json").read_text(encoding="utf-8"))
    words_by_id = {w["id"]: w for w in words_data["words"]}

    manifest_path = DATA / "audio-manifest.json"
    manifest = {"chars": {}, "words": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    AUDIO.mkdir(parents=True, exist_ok=True)

    if args.only in (None, "chars"):
        print(f"生成单字音频 {len(chars_data['characters'])} 条（多音字附带载波词）...")
        stats, fails = asyncio.run(build_chars(chars_data["characters"], words_by_id, args.force))
        manifest["chars"].update(collect_manifest_chars(chars_data["characters"]))
        print(f"  完成 ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
        if fails:
            print(f"  失败示例: {fails[:5]}")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.only in (None, "words"):
        print(f"生成词组音频 {len(words_data['words'])} 条 ...")
        stats, fails = asyncio.run(build_words(words_data["words"], args.force))
        manifest["words"].update(collect_manifest_words(words_data["words"]))
        print(f"  完成 ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
        if fails:
            print(f"  失败示例: {fails[:5]}")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.only in (None, "lessons"):
        # 数学讲解：只念 script，题干与选项由界面大字展示
        math_path = DATA / "math.json"
        sci_path = DATA / "science.json"
        if math_path.exists():
            math_data = json.loads(math_path.read_text(encoding="utf-8"))
            items = [
                {
                    "id": str(l["day"]),
                    "text": l["script"],
                    "audioKey": f"m/{l['day']}",
                }
                for l in math_data["lessons"]
            ]
            print(f"生成数学讲解音频 {len(items)} 条 ...")
            stats, fails = asyncio.run(build_lessons(items, args.force, "m", VOICE_WORD, "-20%"))
            manifest.setdefault("math", {}).update(collect_manifest("m", items))
            print(f"  完成 ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
            if fails:
                print(f"  失败示例: {fails[:5]}")
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

        if sci_path.exists():
            sci_data = json.loads(sci_path.read_text(encoding="utf-8"))
            items = [
                {
                    "id": str(c["day"]),
                    "text": f"{c['title']}。{c['body']}",
                    "audioKey": f"s/{c['day']}",
                }
                for c in sci_data["cards"]
            ]
            print(f"生成科普朗读音频 {len(items)} 条 ...")
            stats, fails = asyncio.run(build_lessons(items, args.force, "s", VOICE_WORD, "-18%"))
            manifest.setdefault("science", {}).update(collect_manifest("s", items))
            print(f"  完成 ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
            if fails:
                print(f"  失败示例: {fails[:5]}")
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    # 生活百科新增条目：只生成 audioKey 以 e/ 开头的（旧 90 条复用 s/{day}.mp3）
    if args.only in (None, "enc"):
        enc_path = DATA / "encyclopedia.json"
        if enc_path.exists():
            enc_data = json.loads(enc_path.read_text(encoding="utf-8"))
            todo = [
                {
                    # id 当文件名用，不能再带 "/"（否则拼成 audio/e/e/x.mp3）
                    "id": c["audioKey"].split("/", 1)[1],
                    "text": f"{c['title']}。{c['body']}",
                    "audioKey": c["audioKey"],
                }
                for c in enc_data["cards"]
                if str(c.get("audioKey") or "").startswith("e/")
            ]
            if todo:
                print(f"生成百科朗读音频 {len(todo)} 条 ...")
                stats, fails = asyncio.run(build_lessons(todo, args.force, "e", VOICE_WORD, "-18%"))
                manifest.setdefault("encyclopedia", {}).update(collect_manifest("e", todo))
                print(f"  完成 ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
                if fails:
                    print(f"  失败示例: {fails[:5]}")
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
                )
            else:
                print("百科音频无新增条目（全部复用既有 s/*.mp3）")

    n = write_polyphone_review(chars_data["characters"], words_by_id)
    print(f"  多音字听测清单: {n} 条 → review/polyphone.csv")

    files = list(AUDIO.rglob("*.mp3"))
    total = sum(f.stat().st_size for f in files)
    print(f"\n✓ 音频总计 {len(files)} 个文件, {total/1024/1024:.1f} MB")


def collect_manifest_chars(chars):
    m = {}
    for rec in chars:
        p = AUDIO / "c" / f"{rec['char']}.mp3"
        if not p.exists():
            continue
        m[rec["char"]] = {
            "audioKey": rec["audioKey"],
            "file": f"c/{rec['char']}.mp3",
            "bytes": p.stat().st_size,
            "polyphonic": len(rec.get("readings") or []) > 1,
            "carrierFile": f"cw/{rec['char']}.mp3" if (AUDIO / "cw" / f"{rec['char']}.mp3").exists() else None,
        }
    return m


def collect_manifest(subdir, items):
    m = {}
    for it in items:
        p = AUDIO / subdir / f"{it['id']}.mp3"
        if p.exists():
            m[it["id"]] = {
                "audioKey": it["audioKey"],
                "file": f"{subdir}/{it['id']}.mp3",
                "bytes": p.stat().st_size,
            }
    return m


def collect_manifest_words(words):
    m = {}
    for w in words:
        p = AUDIO / "w" / f"{w['word']}.mp3"
        if p.exists():
            m[w["word"]] = {"audioKey": w["audioKey"], "file": f"w/{w['word']}.mp3", "bytes": p.stat().st_size}
    return m


if __name__ == "__main__":
    main()
