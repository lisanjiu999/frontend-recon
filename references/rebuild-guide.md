# 复刻指南

目标不是复制源码，而是用**抓到的参数**重建同等手感。顺序不能乱：先静态，再动效，最后交互与声音。

## 0. 起步

```powershell
Copy-Item "<OUT>\tokens\tokens.css"        ".\src\" -Force
Copy-Item "<OUT>\rebuild\tailwind.config.cjs" ".\" -Force
Copy-Item "<OUT>\rebuild\motion.js"        ".\src\" -Force
```

- 纯 HTML 项目：引 `tokens.css` + `scaffold.css`，把 `motion.js` 改成普通 `<script type="module">`。
- React / Vue / Next：`motion.js` 是原生 ESM，可直接 import；在 `useEffect` 里调 `initAll()`，或在 root layout 里挂一次。
- 没有构建工具时，Tailwind 主题可以不用，直接用 `tokens.css` 的变量写 CSS。

## 1. 静态骨架

1. 用 `REPORT.md` 的「页面结构」表决定 section 顺序与高度感（远不用像素级还原，先把内容宽度与留白节奏对上）。
2. 内容宽度：抓 `outline.sections[].rect.w` 里最常出现的宽度，作为 `--container`。
3. 断点：用 `css.breakpoints` 里的值，不要自己发明。

```css
.wrap { width: min(100% - 48px, var(--container, 1120px)); margin-inline: auto; }
.section { padding-block: clamp(64px, 9vw, 128px); }
```

## 2. 组件与状态

按钮/卡片/输入的初始样式来自 `tokens`，状态来自 `hovers[].hoverDiff`：

```css
.btn {
  border-radius: 999px;
  transition: transform .12s linear, box-shadow .35s var(--ease-1, cubic-bezier(.22,1,.36,1));
}
.btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-1); }   /* 只动 hoverDiff 里出现过的属性 */
.btn:active { transform: scale(.96); }                                     /* 取自 activeDiff */
.card:hover { transform: translateY(-6px) scale(1.015); }                  /* 取自 hoverDiff 的矩阵值 */
```

规则：

- **只改 `hoverDiff` 里出现过的属性**。没出现的不加，加了就不是同一个手感。
- 矩阵值换算：`matrix(1, 0, 0, 1, 0, -3.67)` = `translateY(-3.67px)`；`matrix(1.015, 0, 0, 1.015, 0, -6)` = `translateY(-6px) scale(1.015)`。
- `::before` / `::after` 的变化在 `hovers[].pseudo`，常用手法是 `scaleX(0) → scaleX(1)` 的下划线、`opacity` 光斑、`translate` 流光。
- 过渡曲线优先用 `tokens.easings[0]`，时长用 `tokens.durations` 里对应量级的那个；不要在复刻里自创 `ease-in-out`。

## 3. 动效

`motion.byName[].cssBody` 就是原始 `@keyframes`，可以直接用（那是描述性数据，不属于受版权保护的表达）：

```css
@keyframes floaty { from { transform: translateY(0) } to { transform: translateY(-14px) } }
.float { animation: floaty 5000ms ease-in-out infinite alternate; }
```

按 `when` 决定挂载方式：

| 观测 | 复刻做法 |
|---|---|
| `when: load` + 无限循环 | 装饰元素直接挂 CSS animation，别用 JS |
| `when: scroll` + class 切换 | `IntersectionObserver` 加 `.is-visible`，CSS 负责过渡（`motion.js` 的 `revealOnScroll`） |
| `scrollDriven._kind = parallax/translate` | 用 `parallax()`，位移幅度按 `transformSeries` 前后差值估 |
| `sticky-pin` | `position: sticky` + 顶栏高度变量，不要用 JS 锁定 |
| `waapi/js`（`recon.animate[]`） | 用 `element.animate(keyframes, opts)` 照抄关键帧与时长 |
| `rafFrames` 很大 | 说明存在 JS 循环（跟随光标/粒子），用 rAF + `transform` 实现，别碰 layout 属性 |

时长与缓动一律从 `tokens` 取，保证整套动效「同源」。

## 4. 点击特效

- 涟漪：`ripple()`（pointerdown → 插入 span → WAAPI 扩散 → 结束移除）。
- 弹层/菜单：用 `<dialog>` 或 `[popover]`，配 `clicks[].dialogOpened` 的截图对齐进出场动画。
- 如果有 `nodeDelta > 0` 但没有新动画，说明是「插入即完成」的效果（toast、临时标签），复刻时补一个 150–250ms 的入场过渡会更接近真实体验。

## 5. 音效

先看 `sound.verdict`：

- `no audio detected` → 不要凭想象加背景音。
- `audio present` + `audioApiKinds.createOscillator` → 合成音。按频率与时长复刻：

```js
const ctx = new AudioContext();
const o = ctx.createOscillator(), g = ctx.createGain();
o.type = 'sine'; o.frequency.value = 880;
g.gain.setValueAtTime(.12, ctx.currentTime);
g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .18);
o.connect(g).connect(ctx.destination);
o.start(); o.stop(ctx.currentTime + .2);
```

- `networkAudio` 有文件 → 用 `sound({ src })` 播放采样音，音量默认压到 0.2–0.3。
- 一律要求用户手势后再 `new AudioContext()`，否则浏览器会挂起；并在 UI 上给静音开关。

## 6. 无障碍与降级

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
```

`motion.js` 里所有 helper 都自带 reduced-motion 短路；自己写的循环动画也要加。焦点样式不要用 `outline: none` 抹掉——抓 `hovers[].activeDiff`/`focuses` 没覆盖的部分，至少保留 2px 可见描边。

## 7. 验收清单

- [ ] 首屏截图与 `01-hero.png` 并排看，版式重心、留白、字阶一致
- [ ] 主色/强调色与 `palette` 里权重最高的几个一致
- [ ] 按钮 hover 前后只变化 `hoverDiff` 里列出的属性
- [ ] 卡片 hover 不引起周围元素位移
- [ ] 滚动入场动画只播一次，回滚不重播（除非原站会重播）
- [ ] 移动端 390px 下无横向滚动
- [ ] 开 `prefers-reduced-motion` 后页面可正常使用
- [ ] 音效有开关，且不自动循环播放

## 8. 常见偏差

| 偏差 | 原因 | 修正 |
|---|---|---|
| 复刻看起来「更飘」 | 复制了缓动但没复制时长，或用了 `ease` | 严格用 `tokens.durations` + `tokens.easings` |
| 动效有轻微抖动 | hover 改了 `width/height/margin` | 只改 `transform` / `opacity` / `box-shadow` |
| 字体观感不同 | 原站用可变字体或商业字体 | 用最接近的开源替代（Inter / Geist / Noto），并在报告里说明替换 |
| 滚动动画触发太早 | `rootMargin` 与原站不一致 | 调 `rootMargin: '0px 0px -10% 0px'` 到观感一致 |
| 图片发虚 | 抓的是 1x 截图，原站 2x 图源 | 用 `--dpr=2` 重抓，或从 `assets/images` 取原图尺寸 |