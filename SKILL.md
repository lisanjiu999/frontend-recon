---
name: frontend-recon
description: 用真实无头浏览器打开一个网页，抓到它的前端实现细节：设计系统（配色/字体/间距/圆角/阴影/CSS 变量）、UI/UX 结构、动效（CSS @keyframes、WAAPI、滚动驱动、视差、吸顶）、交互状态（hover/active/click 的真实样式差异与截图）、音效（Web Audio 与媒体播放）、技术栈与素材，并产出证据截图、设计令牌、分析报告和可运行的复刻脚手架。
whenToUse: 用户发来一个网页链接，想学习或复刻它的视觉风格、动效、点击特效、音效；或要求做竞品前端分析、设计系统提取、动效逆向、UI 拆解。
user-invocable: true
---

# frontend-recon

把一个 URL 变成可验证的前端证据链：**真实浏览器渲染 → 结构化数据 → 截图证据 → 设计令牌 → 报告 → 复刻脚手架**。

这个 skill 的采集过程是确定性的（脚本负责），判断和写作是你的事（agent 负责）。不要凭印象描述页面，所有结论必须能在 `recon.json` 或 `screenshots/` 里找到依据。

## 硬性规则

- **一次只抓一个站点，串行，不并发。** 默认单页；`--pages` 最多 20，除非用户明确要求整站。
- **不绕过访问控制。** 登录墙、付费墙、验证码、Cloudflare 挑战页一律如实报告「无法访问该区域」，不要尝试破解。需要登录态时让用户提供 `storageState` JSON（见下）。
- **素材只作分析对照。** `assets/` 里的图片、字体、音效、视频版权属于原站点；复刻产出要用自己的素材或占位素材，并提醒用户。
- **先看 robots.txt 与站点条款**（`https://<host>/robots.txt`），禁止抓取或明确限制时告知用户并停止。
- 单次抓取默认 240 秒上限；超时先看 `summary.json` 已产出的部分，不要重跑十次。

## 路径约定

本文件所在目录记为 `<SKILL>`。执行前把 `<SKILL>` 换成本 skill 的实际目录（`skill` 工具报告的 Base directory）。产物写到当前工作区的 `recon/` 下，不要写进 `<SKILL>`。

## 工作流

### 1. 确认目标

从用户消息里取出 URL。若用户只给了站点名，先问清具体页面。同时确认（有歧义时才问）：

- 只是「看懂」它（报告为主），还是要「复刻」它（需要代码）；
- 是否需要登录后的页面；
- 是否包含子页面（`--pages`）。

用户没提就说清默认值然后直接开跑，不要停下来等确认。

### 2. 抓取

```powershell
& node "<SKILL>\scripts\recon.mjs" --url="https://example.com" --out="<CWD>\recon\example"
```

首次运行会自动 `npm install playwright-core`（约 10 秒）。浏览器优先用本机 Chrome，其次 Edge，再其次 Playwright 缓存，最后才报错；不需要额外下载浏览器。

常用开关：

| 开关 | 用途 |
|---|---|
| `--pages=5` | 额外抓取 5 个同源导航页（只做浅采集） |
| `--storage=state.json` | 复用登录态（Playwright storageState 格式） |
| `--headers={"Cookie":"..."}` | 额外请求头 |
| `--dpr=2` | 高清截图（文件更大） |
| `--no-assets` | 不下载素材，只留数据与截图 |
| `--no-mobile` | 跳过 390×844 移动端截图 |
| `--max-hover=12 --max-click=10` | 扩大交互取证样本 |
| `--scroll-steps=14` | 更多滚动采样点（长页面） |
| `--max-elements=12000` | 逐元素快照的节点上限（默认 8000） |
| `--no-deep` | 跳过全量结构/规则/图层/断点取证（只出报告级数据，快 2–3 倍） |
| `--no-breakpoints` | 只跳过断点实测 |
| `--timeout=60000` | 慢站点放宽导航超时 |
| `--max-seconds=400` | 放宽总时长预算 |

脚本会打印一段 JSON summary。**先读它**：`fatal` 非空说明导航失败，先解决访问问题再谈分析。

### 3. 生成报告骨架与令牌

```powershell
& node "<SKILL>\scripts\render.mjs" --recon="<OUT>\recon.json"
```

产出 `REPORT.md`（含数据表格与截图索引）、`tokens/design-tokens.json`、`tokens/tokens.css`、`rebuild/tailwind.config.cjs`、`rebuild/motion.js`、`rebuild/scaffold.css`。

### 4. 看图，写洞察（关键步骤，不要跳）

1. **如果能读图**：看 `screenshots/01-hero.png`、`02-full.png`、`03-section-*.png`、`20-hover-*.png`、`30-click-*.png`、`40-mobile-hero.png`。至少看首屏、整页、一张 hover、一张移动端。**如果当前模型不支持图像输入**：跳过这一步，改为读 `page.html` 的结构与 `outline.sections` 的文本，并在报告开头如实写一句「本次未做视觉核对，结论基于 DOM 与计算样式」。
2. 读数据时用 `inspect.mjs` 取片段，不要整份读 `recon.json`（可能几 MB）：

```powershell
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=motion --limit=12
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=hovers
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=clicks
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=scroll
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=sound
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=libs
```

可用 `--section`：`summary tokens palette type motion hovers clicks scroll sound libs sections assets errors elements layers rules breakpoints`。

后四个（`elements` / `layers` / `rules` / `breakpoints`）读的是 deep 产物，回答「这个区块有几层、谁压住谁、哪条规则挂了动画、窄屏怎么排」这类问题。

3. 用 `edit` 工具替换 `REPORT.md` 里 `<!-- INSIGHT:START -->` 与 `<!-- INSIGHT:END -->` 之间的占位内容，写成三个小节：一句话判断、风格与设计语言、可借鉴点与风险。
4. 在对应章节补一两句解释性的批注（例如「hover 只改 transform 与 box-shadow，不改尺寸，所以不抖」这种从数据里能证实的判断）。**只写有证据的判断**；数据没有覆盖到的地方，明确写「未捕获」。

字段含义与判读方法见 `references/extraction-map.md`，写作结构见 `references/report-template.md`。

### 5. 复刻（用户要代码时）

按 `references/rebuild-guide.md` 的顺序做：令牌 → 版式骨架 → 组件 → 动效 → 交互态 → 音效。产出可运行的最小工程（纯 HTML/CSS/JS 或 React+Tailwind 二选一，跟用户现有栈一致），并至少验证：首屏与截图一致、hover/click 行为可用、`prefers-reduced-motion` 下不崩。

复刻用的是**设计规律**，不是拷源码：直接用 `rebuild/tailwind.config.cjs` 与 `tokens/tokens.css`，动效用 `rebuild/motion.js` 里的 helper 起步。

### 6. 交付

把 `REPORT.md`、`screenshots/`、`tokens/`、`rebuild/` 的路径告诉用户；文件类交付用 `present`。报告是主交付物，代码是可选加项。

## 产物结构

```
recon/<host>-<时间戳>/
  REPORT.md                 # 报告（你负责写洞察部分）
  summary.json              # 抓取摘要，先读这个
  recon.json                # 聚合层结构化数据
  page.html                 # 水合后的 DOM 全文（deep 模式立刻拍，不会空）
  text.txt                  # 页面全文
  dom/elements.json         # ★ 逐元素：~90 项计算样式、绝对坐标、文本、伪元素、运行中动画
  css/bundle.css            # 合并后的 CSS 全文
  css/rules.json            # ★ 逐条规则：选择器 + 声明 + 媒体条件 + 来源
  css/keyframes.json        # 解析出的 @keyframes
  layers.json               # ★ stacking context：谁压住谁、为什么
  sections/section-XX.json  # ★ 每块的子树结构、文本、进入时动画
  breakpoints.json          # ★ 每个断点实测宽度/高度/grid-flex/截图
  screenshots/              # 01-hero 02-full 03-section 10-scroll 20-hover 30-click 40-mobile 60-bp
  svg/                      # 内联 SVG
  assets/{images,fonts,media,css}/
  tokens/design-tokens.json # 机器可读令牌
  tokens/tokens.css         # CSS 变量
  rebuild/                  # tailorwind 主题 + motion helper + 基础样式
```

## 「100%」能做到什么程度

默认就开 deep：**每个可见元素**的样式与坐标、**每条 CSS 规则**、**每个层叠上下文**、**每个 section**、**每个断点**都落盘。仍然有物理上限，报告里要如实写：

| 能拿到 | 拿不到 |
|---|---|
| 所有可见元素的计算样式（~90 项）与绝对坐标 | 源码里的类名语义、组件边界 |
| 逐条 CSS 规则（含媒体条件、嵌套、@keyframes 原文） | 跨域样式表的规则（被 CORS 挡住，只留 `blocked` 标记与 `bundle.css` 里的原文） |
| 每个 section 的子树、文本、入场动画 | 未触发的交互（要登录、要滚动到特定位置才出现的） |
| 每个断点的实际布局与截图 | 用户真实设备上的字体回退差异 |
| 运行中的动画（名称、时长、缓动、目标） | Canvas/WebGL 内部绘制、视频帧 |
| hover/active/click 的计算值差异 | 依赖服务端状态才渲染的内容（个性化、A/B） |
| stacking context 与 z-index 关系 | 浏览器默认 UA 样式之外的伪类状态（`::selection` 等视觉效果） |

元素超过 `--max-elements`、动画超过 600 条、监听超过 1200 条时会截断并在 `recon.deep.truncated` 标出。

## 判读要点

- **`scrolledDriven` 与 `selfAnimating` 要分开看**：脚本用「静止状态下两次采样」作对照，排除自带循环动画的元素，剩下的才是真正由滚动触发的位移/显隐。
- **`hovers[].hoverDiff`** 是强证据：它列出 hover 前后变化的属性与值（用 CDP 强制 `:hover` 伪类，不靠猜选择器）。`::before`/`::after` 的变化单独放在 `pseudo`。
- **`clicks[].newAnimations` / `waapiCalls` / `audioTriggered`** 说明点击特效的机制：CSS 类切换、WAAPI 命令式动画，还是音频反馈。
- **`sound.verdict`**：`audio present` 表示确实检测到 Web Audio 或媒体播放；很多站点是「有音频文件但需交互才播放」，此时看 `triggeredByInteraction`。
- **`motion.unusedKeyframes`**：定义了但当前页面没用到的关键帧，说明站点有未激活的动效库，值得在报告里点一句。
- **`libraries.framework`** 给出框架判定（Next.js / Nuxt / Astro / React / Vue / 静态），`globals` 是运行时探测（gsap/THREE/Lenis…），`cssInJs.tailwindRatio` 是 Tailwind 类名占比。三者合起来才能说清技术栈，别只看 `globals` 为空就断言「没用框架」。
- **要做 1:1 复刻时，先读 `layers.json` 再读 `dom/elements.json`**：图层关系错了，z-index 会一直打架；元素快照里 `s` 是计算值（不是 CSS 声明值），拿它当基准最准。
- **`css/rules.json` 里 `media` 非空的规则**才是响应式差异；`decls` 里出现 `animation`/`transition` 的，配上 `@keyframes` 的 `body` 就能还原整条动效。

## 失败处置

| 现象 | 处置 |
|---|---|
| `fatal` 含 `ERR_NAME_NOT_RESOLVED` / 超时 | 检查网络与 URL；换 `--timeout=90000` 重试一次 |
| 页面是空壳、`screenshots` 全白 | SPA 未水合：加 `--timeout`、去掉 `--no-*`，或让用户提供登录态 |
| 出现验证码 / Cloudflare 页 | 如实报告，不绕过；建议用户本地导出 HAR 或提供 `storageState` |
| `hoverDiff` 全为 null | 站点用 JS 而非 CSS 做交互：看 `listeners` 与 `clicks`，并参考 `waapiCalls` |
| `assets` 为空 | 素材是 canvas 绘制或 data URI：看 `svg/`、`network.requests` 与 `canvasContexts` |
| 截图过大 / 整页失败 | 页面超过 14000px 时脚本会跳过整页图，改用 `03-section-*` |

## 边界

- 抓的是「一次访问的快照」：A/B 实验、个性化推荐、时间/地理位置相关内容不会稳定复现。
- WebGL/Canvas 视觉（Three.js 场景、shader 背景）只能记录存在性与参数，抓不到几何与着色器源码。
- Web Audio 只记录节点创建与触发，不落盘波形；需要实际音频时从 `audio.networkAudio` 里的 URL 取。
- 站点若检测自动化会降级内容；`--storage` 与真实 UA 能缓解，但不要用于绕过访问控制。

更细的限制与合规说明见 `references/limits-and-compliance.md`。

## 维护本 skill

改了 `extract.mjs` / `instrument.js` / `recon.mjs` 之后跑一次回归测试（用内置 fixture 页面，约 40 秒）：

```powershell
& node "<SKILL>\scripts\selftest.mjs"
```

它校验 40 多项：关键帧解析、CSS 变量、hover 差异、WAAPI 点击特效、Web Audio 触发、吸顶与滚动入场、自播动画排除、**逐元素快照 / CSS 规则 / 图层栈 / 逐区块取证 / 断点产物**、报告与令牌产出。全绿再交付。