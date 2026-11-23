# recon.json 字段判读

先用 `scripts/inspect.mjs` 取单个片段，不要把几 MB 的 `recon.json` 整份读进上下文。

```powershell
& node "<SKILL>\scripts\inspect.mjs" --recon="<OUT>\recon.json" --section=motion --limit=12
```

可用 section：`summary tokens palette type motion hovers clicks scroll sound libs sections assets errors`。

## 顶层

| 字段 | 含义 / 用法 |
|---|---|
| `requestedUrl` / `finalUrl` | 最终地址。两者不同说明有跳转（地区、语言、登录），报告里要注明 |
| `meta` | 标题、描述、`theme-color`、`lang`、视口、节点/图片/SVG/canvas 计数 |
| `viewport` / `browser` | 采集环境。截图结论必须带上这个前提 |
| `tokens` | 全站计算样式统计（见下） |
| `palette` | 归并后的调色板：`hex`、`alpha`、`kinds`(text/surface/border)、`weight`、`hsl` |
| `outline` | 分区、标题大纲、同源链接、表单样式、正文片段 |
| `css` | `keyframes`、`fontFaces`、`mediaQueries`、`breakpoints`、`rootVarsDeclared`、特性统计 |
| `motion` | 动效清单（见下） |
| `hovers` / `clicks` / `focuses` | 交互取证 |
| `scrollDriven` / `scrollSurfaces` | 滚动驱动效果与吸顶/固定元素 |
| `sound` | 音效证据 |
| `libraries` | 运行时库探测 + 脚本 URL 关键字 |
| `assets` / `network` | 素材与请求统计 |
| `errors` | 页面报错、console error、注入期运行时错误 |
| `screenshots` | 截图文件名列表（相对 `screenshots/`） |

## 深度产物（deep 模式，默认开启）

这些文件不在 `recon.json` 里，量太大；用 `inspect.mjs --section=` 取片段，或直接读文件。

| 文件 | 内容 | 怎么用 |
|---|---|---|
| `dom/elements.json` | 每个可见元素的快照：`t` 标签、`i` id、`c` class、`rect` `[x,y,w,h]`（绝对坐标）、`s` ~90 项计算样式、`x` 直接文本、`b`/`a` 伪元素、`run` 运行中动画；隐藏元素的 `d: 0` | 还原任意一块的版式与状态；查某个 class 到底用了什么值 |
| `css/rules.json` | 逐条规则：`sel` 选择器、`decls` 声明、`media`/`supports` 条件、`src` 来源；`@keyframes` 是 `{keyframes, body}`；跨域表是 `{blocked:true}` | 查「谁给 `.btn` 挂了 animation」「哪个断点里改了栅格」 |
| `layers.json` | 层叠上下文：`tag/cls/z/pos/rect/why`，`why` 说明成因（z-index、transform、filter、will-change…） | 判断谁压住谁；复刻时 z-index 翻车现场 |
| `sections/section-XX.json` | 单块子树（前 500 节点）：层级 `d`、rect、字号字重颜色、文本 + 该块进入视口时的动画快照 | 逐幕复刻；对比两块的排版差异 |
| `breakpoints.json` | 每个断点：宽度、页面高度、grid/flex 元素数、首屏截图 | 确认响应式策略 |
| `text.txt` / `page.html` | 全文 / 水合后 DOM 原文 | 提取文案、核对结构 |

三个上限：元素默认 8000（`--max-elements` 调），动画 600 条，监听 1200 条；超出会在 `recon.deep.truncated` 标记。

## tokens

- `colors` / `backgrounds` / `borders`：按「文字字数」和「面积」加权后的颜色频次。权重高 = 实际用得多，不代表是主色（大面积浅底会压过按钮色），要结合 `palette.kinds` 判断。
- `typeScale`：`family | size | weight | lineHeight | letterSpacing` 组合及其文字量权重。这就是实际的排版层级，比读 CSS 变量可靠。
- `spacing`：`padding-top:24px` 这样的条目 + 频次。用来反推 4px / 8px 网格。
- `radius` / `shadows` / `easings` / `durations`：频次表，`easings` 已经把 `cubic-bezier(...)` 完整保留（不会按逗号切碎）。
- `misc`：`backdropFilter`（毛玻璃）、`mixBlend`、`sticky`、`fixed`、`grid`、`flex`、`customCursor`、`willChange` 等计数——判断风格关键词（玻璃拟态、深浅混合、自定义光标）靠它。
- `cssVars`：`document.documentElement` 上解析后的 CSS 自定义属性（含继承来的）。站点用设计令牌系统时这里是金矿。

## motion

- `byName[]`：`name`、`source`（`css-keyframes` / `css-transition` / `waapi/js`）、`duration`、`easing`、`iterations`、`count`、`targets`、`when`（`load` / `scroll` / `hover` / `click` / `final`）、`cssBody`（原始关键帧）、`keyframes`（WAAPI 关键帧）。
- `unusedKeyframes`：定义了但当前页面没激活的动画——说明站点有更丰富的动效库/未被触发的交互。
- `rafFrames`：`requestAnimationFrame` 调用次数。数值很大（数千）说明有 JS 驱动的持续动画循环（跟随光标、粒子、Canvas）。
- `stats.selfAnimating` 对应的元素数在 `selfAnimatingCount`：循环自播的动画，**不要**把它们误判为滚动动效。
- `easings` / `durations`：动效「手感」的量化指标，写报告时直接引用具体数值。

## hovers

每条：`tag`、`text`、`classes`、`cursor`、`transition`（原始简写）、`hoverDiff`、`activeDiff`、`animations`、`screenshot`、`pseudo`。

- `hoverDiff` 的 key 是 CSS 属性，`{before, after}` 是强制 `:hover` 前后的计算值。这是复刻 hover 的唯一可信依据。
- `activeDiff` 同理（强制 `:active`）。若 hover 与 active 为空但 `cursor: pointer`，说明交互由 JS 处理，去看 `clicks`。
- `pseudo` 里有 `::before` / `::after` 的 `content`、尺寸、背景、变换——下划线、光斑、边框流光常在这里。
- `screenshot` 是 hover 态局部截图，报告里可作为证据链接。

## clicks

`clicked`、`clickMode`（`pointer` / `force` / `dispatchEvent`，后者说明元素在持续动画中无法真实点击）、`navigated`、`newAnimations`、`waapiCalls`、`nodeDelta`、`dialogOpened`、`audioTriggered`、`mediaTriggered`、`screenshot`。

- `waapiCalls > 0` + `recon.animate[]` 里的关键帧 = 命令式点击特效（涟漪、粒子、抖动）。
- `nodeDelta > 0` 且 `newAnimations` 为空 = DOM 插入型特效（弹出层、临时元素）。
- `dialogOpened` 为真说明点开了菜单/弹窗，截图可用于分析弹层设计。

## scrollDriven

每条：`_kind`（`sticky-pin` / `reveal/enter` / `parallax/translate` / `filter-change`）、`position`、`transformSeries`、`opacitySeries`。

判定时已用「静止双采样」剔除自播动画元素；`selfAnimatingCount` 是被剔除的数量。`reveal/enter` 通常对应 IntersectionObserver 入场，`parallax/translate` 对应滚动进度映射位移。

## sound

- `verdict`：`audio present` / `no audio detected`。
- `audioApiKinds`：`AudioContext`、`createOscillator`、`createBufferSource`、`decodeAudioData`、`createMediaElementSource` 等调用计数——能区分「合成音」与「采样音」。
- `playCalls`：`HTMLMediaElement.play()` 的调用记录（含 src、loop、volume）。
- `networkAudio`：网络里的音频文件 URL（mp3/wav/ogg/m4a…），要复刻音效就从这里取。
- `triggeredByInteraction`：由哪次点击触发了声音。没有这条就等于「页面有音频能力但未在本次点击中触发」。
- `libraries`：Howler / Tone.js / audiojs 探测。

## libraries

`globals` 是运行时 `typeof` 探测（最可信）；`scriptHints` 是脚本 URL 关键字（能发现未挂全局的打包库）；`gsapVersion` 直接给版本。

## 采集本身的可靠性

- 数组都有上限（样式 4000 元素、监听 500 条、动画 300 条），极端页面会截断，报告里注明「样本上限」即可。
- 截图、hover 强制、点击都在真实渲染树上进行，但仍是单次会话：动态内容、随机推荐、时间相关内容会漂移。