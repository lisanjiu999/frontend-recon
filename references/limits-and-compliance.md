# 边界、失败模式与合规

## 技术边界

| 边界 | 说明 | 应对 |
|---|---|---|
| 单次会话快照 | A/B 实验、灰度、个性化、轮播随机序、时间/地区内容每次不同 | 报告注明「单次快照」，必要时隔天复抓对比 |
| 登录 / 付费墙 | 默认不带登录态，只能看到公开部分 | 让用户导出 Playwright `storageState`（`--storage`）或 Cookie；不破解 |
| Cloudflare / 验证码 / 指纹风控 | 可能出现挑战页、空白页、降级内容 | 如实报告；建议用户本地打开后导出 HAR；不引入打码/指纹伪装 |
| Canvas / WebGL | 只能记录存在性（`canvasContexts`）、尺寸与库（THREE/PIXI/OGL），抓不到着色器与场景图 | 报告写明「视觉为 canvas 渲染，需人工逆向或从 assets 里的贴图推断」 |
| 视频 / Lottie / Rive | 记录 URL 与元素参数，不解析动画数据 | 从 `assets/media` 取源文件；Lottie JSON 可直接复用 |
| 音效 | 记录 Web Audio 节点创建与触发时机；不录音、不落波形 | 需要真实音频时从 `sound.networkAudio` 下载；合成音按频率/时长复刻 |
| iframe / 跨域 | 同源 iframe 可注入，跨域 iframe 只记录 URL | 单独对该 iframe URL 再跑一次 recon |
| Shadow DOM | 计算样式与元素扫描已穿透开放 shadow root；封闭 shadow root 不可见 | 在报告里说明 |
| 伪元素动画 | `::before`/`::after` 样式能读，但 `@keyframes` 作用在伪元素上时无法单独截图 | 用 hover 截图 + keyframes 定义对照 |
| 音视频自动播放策略 | 已启动 `--autoplay-policy=no-user-gesture-required` | 仍可能被站点自己的逻辑拦截，表现为「有音频资源但不播」 |
| 元素上限 | 样式扫描 4000 元素、动画 600 条、监听 1200 条、素材 40MB | 超限时报告注明「样本上限」，结论按样本写 |
| 页面高度 | > 14000px 时跳过整页截图 | 用 `03-section-*.png` 与 `10-scroll-*.png` 代替 |
| 持续动画元素 | 永远在动的元素无法被真实指针点击 | 脚本自动降级为 `force` / `dispatchEvent`，结果里 `clickMode` 会标明 |

## 常见的「抓不到」及其含义

- `hovers` 全部没有 diff，但元素有 `cursor:pointer`：交互是 JS 实现的（看 `listeners`、`clicks.waapiCalls`），CSS 里确实没有 hover 规则。
- `scrollDriven` 为空：页面没有滚动动效，或动效由 canvas/视频承载。
- `sound.verdict = no audio detected`：真的没有声音。不要为了「效果更好」在复刻里加背景音。
- `assets` 很少但页面图片很多：图片是 CSS `background-image` 的 data URI、或 canvas 绘制、或 `<img>` 懒加载未触发（可用 `--scroll-steps` 加大采样）。
- `libraries.framework = static/unknown` 但页面明显是 SPA：框架被打包且未留 DOM 标记（服务端渲染后再水合），此时以 `network.requests` 的 chunk 命名与 `listeners` 特征推断。

## 合规与伦理

1. **遵守 robots.txt 与站点条款**：抓取前看一眼 `https://<host>/robots.txt`；站点明确禁止抓取时告知用户并停止。
2. **低频、串行**：默认单页、单次、无并发。整站（`--pages`）只用于用户明确要求的竞品结构分析，且每页间隔应保持默认节奏。
3. **不做访问控制绕过**：不破解登录、不规避付费墙、不打码、不做浏览器指纹伪装。
4. **版权**：`assets/` 中的图片、字体、音频、视频、内联 SVG 版权归原站点。复刻产出必须使用自有素材或占位素材；直接使用原站素材对外发布属于侵权。
5. **设计参考的边界**：版式规律、配色比例、动效参数属于可学习的「方法」；品牌标识、专有插画、成段文案、代码原样复制属于不可搬运的「表达」。
6. **个人信息**：抓到的页面可能含用户数据（评论区、头像、邮箱）。不要写入报告，素材归档前先剔除。
7. **内部使用优先**：这类取证适合学习、审计、内部竞品分析；对外发布复刻作品前应做显著差异化。

## 出问题时的排查顺序

1. 看 `summary.json`：`fatal`、`seconds`、`counts`。
2. `node scripts/inspect.mjs --recon=... --section=errors`：页面自身报错常解释白屏/缺内容。
3. 看 `screenshots/01-hero.png` 是否白屏：白屏 = 导航或水合失败。
4. `network.failed` 里的 URL：资源 403/404 会导致样式缺失。
5. 仍不行就降级：`--no-assets --no-mobile --max-hover=3 --max-click=2`，先拿到令牌与结构，再决定是否重抓。