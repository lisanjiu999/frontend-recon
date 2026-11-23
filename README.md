# frontend-recon

**把一个网址变成可验证的前端证据链**：真实浏览器渲染 → 逐元素快照 → 截图 → 设计令牌 → 报告 → 可运行的复刻脚手架。

A DeepSeek Harness skill that opens a page in a real headless browser and records what it actually does — every element's computed style, every CSS rule, every running animation, every hover/click state, and every breakpoint.

---

## 它抓什么

| 维度 | 产出 |
|---|---|
| 设计系统 | 配色（含透明度/HSL/权重）、字阶、间距、圆角、阴影、CSS 变量、断点 |
| 结构 | `dom/elements.json`：每个可见元素 ~90 项计算样式 + 绝对坐标 + 文本 + 伪元素 + 运行中动画 |
| 样式规则 | `css/rules.json`：逐条规则的选择器、声明、媒体条件、来源 |
| 分层 | `layers.json`：每个层叠上下文及成因（z-index / transform / filter / will-change…） |
| 动效 | `@keyframes` 原文、运行中动画（名称/时长/缓动/目标）、滚动驱动、自播排除 |
| 交互 | CDP 强制 `:hover` / `:active` 的前后计算值差异 + 局部截图；真实点击的新动画/弹层/音效归因 |
| 音效 | Web Audio 节点与触发时机、媒体播放、网络音频文件 |
| 断点 | 按 CSS 里声明的断点逐个切视口实测 + 首屏截图 |
| 素材 | images / fonts / media / css 下载 + 内联 SVG 提取 |
| 交付 | `REPORT.md`、`tokens/design-tokens.json`、`tokens/tokens.css`、`rebuild/tailwind.config.cjs`、`rebuild/motion.js` |

## 快速开始

```bash
git clone <this-repo>
cd frontend-recon
npm install            # 只有 playwright-core，约 10 MB

node scripts/recon.mjs --url="https://example.com" --out="./recon/example"
node scripts/render.mjs --recon="./recon/example/recon.json"
```

浏览器优先用本机 Chrome，其次 Edge，再其次 Playwright 自带缓存 —— **不需要另外下载浏览器**。第一次运行会自动装依赖。

单页约 1.5–3 分钟（deep 模式，含逐元素与断点取证）。

## 常用开关

| 开关 | 用途 |
|---|---|
| `--pages=5` | 额外抓 5 个同源页面（浅采集） |
| `--storage=state.json` | 复用登录态（Playwright storageState） |
| `--dpr=2` | 高清截图 |
| `--no-assets` | 不下载素材 |
| `--no-mobile` | 跳过移动端截图 |
| `--max-hover=12 --max-click=10` | 扩大交互样本 |
| `--max-elements=12000` | 逐元素快照上限（默认 8000） |
| `--no-deep` | 跳过全量结构/规则/图层/断点，快 2–3 倍 |
| `--timeout=60000 --max-seconds=400` | 慢站点 |

## 产物

```
recon/<host>-<时间戳>/
  REPORT.md                 # 报告（洞察区留给 agent 填）
  summary.json              # 先看这个：数量、耗时、失败原因
  recon.json                # 聚合层数据
  page.html / text.txt      # DOM 全文 / 页面全文
  dom/elements.json         # 逐元素快照
  css/bundle.css            # 合并 CSS
  css/rules.json            # 结构化规则
  css/keyframes.json        # 解析出的关键帧
  layers.json               # 层叠上下文
  sections/section-XX.json  # 逐区块：子树 + 文本 + 入场动画
  breakpoints.json          # 断点实测
  screenshots/              # hero / 整页 / 分区 / 滚动 / hover / click / 移动端 / 断点
  svg/  assets/             # 内联 SVG / 下载的素材
  tokens/  rebuild/         # 设计令牌 + 可运行的复刻脚手架
```

## 作为 DSH 技能使用

把整个目录放进 `$DSH_HOME/skills/`（默认 `~/.dsh/skills/`），它就会被识别为技能 `frontend-recon`：

```bash
cp -r frontend-recon ~/.dsh/skills/
```

之后在对话里直接说「抓一下 https://xxx，分析它的设计和动效」，或输入 `/frontend-recon <url>`。

## 辅助工具

```bash
node scripts/inspect.mjs --recon=./recon/x/recon.json --section=hovers
# sections: summary tokens palette type motion hovers clicks scroll sound libs
#           sections assets errors elements layers rules breakpoints
node scripts/selftest.mjs     # 回归测试，40+ 项断言
```

## 边界

- 只抓**一次访问的快照**：A/B 实验、个性化、时间/地区相关内容不会稳定复现。
- 跨域样式表被 CORS 挡住时只记 `blocked` 标记，规则内容以 `css/bundle.css` 为准。
- Canvas / WebGL 只记录存在与参数，抓不到着色器与场景。
- 不绕过登录、付费墙、验证码。抓取前请看目标站 `robots.txt` 与条款；素材版权归原站，仅供分析对照。

## License

MIT（如需其他协议自行替换）。