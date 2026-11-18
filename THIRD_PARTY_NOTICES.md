# 第三方数据来源与许可（Third-Party Notices）

本项目**自己的代码与原创文字内容**采用 MIT 许可（见 `LICENSE`）。
下列资产**各自适用上游许可，不在 MIT 授权范围内**。重新分发本项目时，
必须连同 `licenses/` 下的许可原文一起保留。

---

## 一览表

| 资产 | 来源 | 许可 | 是否入库 |
| --- | --- | --- | --- |
| `packages/content/assets/fonts/wenkai-subset.woff2`（808 KB，3623 字形） | [LXGW WenKai / 霞鹜文楷](https://github.com/lxgw/LxgwWenKai) v1.530（2026-10-18） | **SIL Open Font License 1.1** → [`licenses/OFL.txt`](licenses/OFL.txt) | ✅ 入库（子集） |
| `packages/content/fonts-src/LXGWWenKai-Regular.ttf`（24.7 MB） | 同上 | OFL-1.1 | ❌ 不入库（体积大，按下方命令自取） |
| `packages/content/data/strokes.json`（8.99 MB，3500 字笔顺与中线） | [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0.1，其数据源自 [Make Me A Hanzi](https://github.com/skishore/makemeahanzi)，字形取自[芳泽（Arphic）](http://www.arphic.com/)1999 年释出的字体 | **Arphic Public License** → [`licenses/ARPHICPL.TXT`](licenses/ARPHICPL.TXT) | ✅ 入库（派生数据） |
| `characters.json` 的 `radical` / `gloss` 字段 | 新华字典开源数据 `word.json` | **MIT**（按上游声明处理） | ✅ 入库（派生字段） |
| `char-frequency.json`（字频，用于排教学顺序与选词） | 焦久峰 Jun Da《Modern Chinese Word and Character Frequencies》<https://lingua.mtsu.edu/chinese-computing/> | 学术公开数据，**使用前请自行核对上游使用条款** | ❌ 原始抓取件不入库（`data/cache/` 被忽略），派生的排序结果入库 |
| 扫盲字表 592 / 358 / 550 三档分层 | 教育部《扫盲教育课程设置及教学材料编写指导纲要》（教基一〔2011〕1 号）<http://www.moe.gov.cn/srcsite/A06/s3321/201104/t20110425_120118.html> | 国家机关公文 | ✅ 分层结果入库 |
| 3500 字成员集 | 《通用规范汉字表》（国务院 2013 年公布，一级字表 3500 字） | 国家通用语言文字标准 | ✅ 字表入库 |
| `packages/content/assets/audio/**`（14804 个 mp3，166 MB） | 由 [`edge-tts`](https://github.com/rany2/edge-tts) 调用微软 Edge 神经网络语音本地生成 | 工具 MIT；**语音输出受微软语音服务条款约束** | ❌ **不入库**，克隆后本地生成 |
| `packages/content/content/*.csv`（百科 215 条、科普、数学题） | 本项目原创撰写 | MIT | ✅ 入库 |
| React / Vite / Capacitor / Fastify / pinyin-pro / hanzi-writer 等运行时依赖 | npm | 各自开源许可 | ❌ 由 `pnpm install` 取得 |

---

## 为什么有些东西不在仓库里

`pnpm-lock.yaml` 锁定的依赖之外，仓库刻意排除三类大文件——它们要么能从脚本重建，
要么体积超过 GitHub 限制，要么属于隐私：

| 排除项 | 体积 | 原因 | 怎么补回来 |
| --- | --- | --- | --- |
| `packages/content/assets/audio/` | 166 MB / 14804 文件 | 可由脚本重新生成；且微软语音输出的再分发条款需使用者自行确认 | `python packages/content/scripts/build_audio.py` |
| `packages/content/fonts-src/` | 24.7 MB | 原始 TTF；打包实际只需要已入库的子集 woff2 | 从上游 releases 下载 `LXGWWenKai-Regular.ttf` 放到该目录 |
| `packages/content/data/cache/` | 56.4 MB | 上游原始抓取件（字频表、字典 JSON） | `python packages/content/scripts/fetch_frequency.py` 等 |
| `dist-apk/` | 179.8 MB | 单个 APK 176 MB，**超过 GitHub 100 MB 硬限制**，推上去会被拒 | 见 `README` 构建章节 |
| `services/sync/data/` | — | **真实学习记录与配对码，属个人隐私** | 自行启动服务后自动生成 |
| `*.keystore` / `keystore.properties` | — | **签名密钥与口令，绝不入库** | 见下 |

---

## 签名密钥：仓库里没有任何密钥

开源前，`app/build.gradle` 里写死了明文口令，`android/*.keystore` 也在目录里——
那是"只装在两台自家设备的私人项目"时期的做法，公开仓库不能这样。现在：

- `.gitignore` 排除 `*.keystore`、`*.jks`、`keystore.properties`
- `build.gradle` 改为读取 `android/keystore.properties`；**该文件不存在时构建照样成功**，
  产出的是 `app/build/outputs/apk/release/app-release-unsigned.apk`
  （注意文件名不同：**未签名的 APK 安卓装不上**，要装机必须自己签名）
- 仓库只提供 `keystore.properties.example` 模板，里面是占位文字，没有真实口令
- 两条路径都实测过：有 `keystore.properties` → `app-release.apk`，
  `apksigner verify` 通过；无该文件 → `app-release-unsigned.apk`，`BUILD SUCCESSFUL`

自己出可安装的包：

```bash
# 1. 生成你自己的密钥（两个 App 各一份）
keytool -genkeypair -v -alias shizi -keyalg RSA -keysize 2048 -validity 10000 \
        -keystore apps/learner/android/shizi-release.keystore

# 2. 复制模板并填入你的口令
cp apps/learner/android/keystore.properties.example apps/learner/android/keystore.properties
#    编辑 storeFile / storePassword / keyAlias / keyPassword

# 3. 正常构建，gradle 会自动启用签名
```

**给原使用者的提醒**：本项目在私人阶段用过一个固定口令。既然要公开，
请把它当作已泄露处理——重新生成密钥，不要用旧口令的密钥库分发更新。

---

## 字体子集化

子集只保留界面用字 + 3500 教学字（3623 字形），用 `fontTools` 的 `pyftsubset` 生成：

```bash
pip install fonttools brotli
python packages/content/scripts/subset_fonts.py
```

OFL-1.1 允许嵌入与再分发子集，但**要求保留许可声明**，因此 `licenses/OFL.txt`
必须随仓库分发；子集也不得单独改名后当作自有字体销售。

## 笔顺数据

`strokes.json` 是把 3500 个字的 `strokes`（SVG 轮廓）与 `medians`（中线）
从 hanzi-writer-data 抽出合并的派生文件。Arphic PL 第 1、2 条要求
**在所有副本中原样保留 `ARPHICPL.TXT`**，且修改需注明改动方式与时间——
本文件的生成过程记录在 `packages/content/scripts/build-strokes.mjs`。

---

## 免责声明

上表的许可判断依据是各上游项目**当前声明的许可**，由本项目整理，
不构成法律意见。若你要把本项目用于商业分发或二次开源，
请自行向上游核对条款（尤其是字频数据与微软语音输出条款）。
