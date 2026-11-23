#!/usr/bin/env node
/*
 * render.mjs — turn recon.json into a readable report, a machine-readable
 * design spec, CSS/Tailwind tokens and a rebuild scaffold.
 *
 * Usage: node scripts/render.mjs --recon=<dir>/recon.json [--out=<dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const hit = argv[i];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const reconPath = flag('recon') || path.join('recon', 'recon.json');
if (!existsSync(reconPath)) {
  console.error(`recon.json not found: ${reconPath}`);
  process.exit(2);
}
const R = JSON.parse(readFileSync(reconPath, 'utf8'));
const outDir = path.resolve(flag('out') || path.dirname(reconPath));
const tokensDir = path.join(outDir, 'tokens');
const rebuildDir = path.join(outDir, 'rebuild');
mkdirSync(tokensDir, { recursive: true });
mkdirSync(rebuildDir, { recursive: true });

/* ------------------------------------------------------------- helpers -- */
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const listOr = (arr, empty = '（无）') => (arr && arr.length ? arr.map((x) => `- ${x}`).join('\n') : empty);

const hexOf = (s) => {
  const m = String(s || '').match(/^#([0-9a-f]{3,8})$/i);
  return m ? '#' + m[1].toUpperCase() : null;
};
const luminance = (hex) => {
  const h = (hex || '').replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255 || 0);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const satOf = (entry) => (entry && entry.hsl ? entry.hsl.s : 0);

/* --------------------------------------------------------------- tokens -- */
const palette = R.palette || [];
const surfaces = palette.filter((p) => p.kinds.includes('surface')).sort((a, b) => b.weight - a.weight);
const texts = palette.filter((p) => p.kinds.includes('text')).sort((a, b) => b.weight - a.weight);
const neutralSurfaces = surfaces.filter((s) => satOf(s) < 30);
const accents = [...palette]
  .filter((p) => satOf(p) > 40 && p.hsl && p.hsl.l >= 18 && p.hsl.l <= 82 && p.alpha > 0.5)
  .sort((a, b) => satOf(b) - satOf(a) || b.weight - a.weight);

const base = neutralSurfaces[0] || surfaces[0];
const surface2 = neutralSurfaces.find((s) => s.hex !== base?.hex) || null;
let textPrimary = texts[0];
for (const t of texts) {
  const contrast = (Math.max(luminance(t.hex), luminance(base?.hex || '#000')) + 0.05) / (Math.min(luminance(t.hex), luminance(base?.hex || '#000')) + 0.05);
  if (contrast >= 4.5) { textPrimary = t; break; }
}
const textSecondary =
  texts.find((t) => t.hex !== textPrimary?.hex && t.weight >= 50 && Math.abs(luminance(t.hex) - luminance(base?.hex || '#000')) > 0.05) ||
  texts.find((t) => t.hex !== textPrimary?.hex) ||
  null;
const accent = accents[0] || null;
const accent2 = accents.find((a) => a !== accent) || null;
const border = palette.find((p) => p.kinds.includes('border')) || null;

const typeScale = (R.tokens.typeScale || []).map((e) => {
  const [family, size, weight, lineHeight, letterSpacing] = e.value.split(' | ');
  return { family, size, weight, lineHeight, letterSpacing, weightCount: e.weight };
});
const sizeGroups = new Map();
for (const t of typeScale) {
  const cur = sizeGroups.get(t.size) || { size: t.size, count: 0, weights: new Set(), families: new Set(), lineHeights: new Set(), letterSpacings: new Set() };
  cur.count += t.weightCount;
  cur.weights.add(t.weight);
  cur.families.add(t.family);
  if (t.lineHeight && t.lineHeight !== 'normal') cur.lineHeights.add(t.lineHeight);
  if (t.letterSpacing && t.letterSpacing !== 'normal') cur.letterSpacings.add(t.letterSpacing);
  sizeGroups.set(t.size, cur);
}
const sizePx = (s) => parseFloat(s) || 0;
const typeSizes = [...sizeGroups.values()].sort((a, b) => sizePx(b.size) - sizePx(a.size));

const spacingValues = (R.tokens.spacing || [])
  .map((e) => ({ kind: e.value.split(':')[0], px: e.value.split(':')[1], weight: e.weight }))
  .filter((s) => /px$/.test(s.px))
  .map((s) => ({ ...s, n: parseFloat(s.px) }))
  .filter((s) => s.n <= 240);
const spacingScale = [...new Set(spacingValues.filter((s) => s.n > 0).map((s) => s.n))].sort((a, b) => a - b);
const gcdLike = (nums) => {
  const usable = nums.filter((n) => n > 0 && n <= 120 && Number.isInteger(n));
  if (!usable.length) return 4;
  const cand = [2, 4, 6, 8, 10, 12];
  for (const c of cand) if (usable.filter((n) => n % c === 0).length / usable.length > 0.6) return c;
  return 4;
};
const baseUnit = gcdLike(spacingScale);

const radiusScale = [...new Set((R.tokens.radius || []).map((r) => r.value))].slice(0, 12);
const shadowScale = [...new Set((R.tokens.shadows || []).map((r) => r.value))].slice(0, 8);
const easings = (R.tokens.easings || []).map((e) => e.value).slice(0, 10);
const durations = (R.tokens.durations || []).map((d) => d.value).slice(0, 12);

const spec = {
  meta: {
    url: R.finalUrl || R.requestedUrl,
    title: R.meta?.title,
    capturedAt: R.capturedAt,
    viewport: R.viewport,
    browser: R.browser,
  },
  color: {
    base: base?.hex || null,
    surface: surface2?.hex || null,
    textPrimary: textPrimary?.hex || null,
    textSecondary: textSecondary?.hex || null,
    accent: accent?.hex || null,
    accentAlt: accent2?.hex || null,
    border: border?.hex || null,
    palette: palette.slice(0, 40).map((p) => ({ hex: p.hex, alpha: p.alpha, kinds: p.kinds, weight: p.weight, hsl: p.hsl })),
    cssVariables: Object.entries(R.tokens.cssVars || {}).slice(0, 200).map(([name, value]) => ({ name, value })),
  },
  typography: {
    families: (R.tokens.fonts || []).map((f) => ({ family: f.value, weight: f.weight })),
    scale: typeSizes.slice(0, 14).map((s) => ({
      size: s.size,
      px: sizePx(s.size),
      weights: [...s.weights],
      families: [...s.families],
      lineHeights: [...s.lineHeights],
      letterSpacing: [...s.letterSpacings],
      usage: s.count,
    })),
    fontFaces: (R.css?.fontFaces || []).slice(0, 20),
    headings: (R.outline?.headings || []).slice(0, 20).map((h) => ({ level: h.level, text: h.text, ...h.style })),
  },
  spacing: { baseUnit, scale: spacingScale.slice(0, 24), frequent: (R.tokens.spacing || []).slice(0, 24).map((s) => s.value) },
  radius: radiusScale,
  shadow: shadowScale,
  motion: {
    easings,
    durations,
    keyframes: (R.css?.keyframes || []).slice(0, 60).map((k) => ({ name: k.name, body: k.body.slice(0, 400) })),
    inventory: (R.motion?.byName || []).slice(0, 40),
  },
  layout: {
    breakpoints: R.css?.breakpoints || [],
    mediaQueries: (R.css?.mediaQueries || []).slice(0, 30),
    gridUsage: R.tokens.misc?.grid,
    flexUsage: R.tokens.misc?.flex,
    sticky: R.tokens.misc?.sticky,
    fixed: R.tokens.misc?.fixed,
    containerQueries: R.tokens.misc?.containerQueries,
  },
};
writeFileSync(path.join(tokensDir, 'design-tokens.json'), JSON.stringify(spec, null, 2));

/* ---------------------------------------------------------- tokens.css -- */
const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const cssLines = [':root {'];
if (spec.color.base) cssLines.push(`  --color-base: ${spec.color.base};`);
if (spec.color.surface) cssLines.push(`  --color-surface: ${spec.color.surface};`);
if (spec.color.textPrimary) cssLines.push(`  --color-text: ${spec.color.textPrimary};`);
if (spec.color.textSecondary) cssLines.push(`  --color-text-muted: ${spec.color.textSecondary};`);
if (spec.color.accent) cssLines.push(`  --color-accent: ${spec.color.accent};`);
if (spec.color.accentAlt) cssLines.push(`  --color-accent-alt: ${spec.color.accentAlt};`);
if (spec.color.border) cssLines.push(`  --color-border: ${spec.color.border};`);
for (const p of palette.slice(0, 12)) cssLines.push(`  --color-${p.hex.replace('#', '')}: ${p.hex}${p.alpha < 1 ? `; /* alpha ${p.alpha} */`.replace('; /*', ' /*') : ';'}`);
if (spec.typography.families[0]) cssLines.push(`  --font-sans: ${spec.typography.families[0].family};`);
for (const s of spec.typography.scale.slice(0, 8)) {
  cssLines.push(`  --text-${s.px}: ${s.size};`);
}
for (const n of spacingScale.slice(0, 16)) cssLines.push(`  --space-${n}: ${n}px;`);
radiusScale.forEach((r, i) => cssLines.push(`  --radius-${i + 1}: ${r};`));
shadowScale.forEach((s, i) => cssLines.push(`  --shadow-${i + 1}: ${s};`));
easings.slice(0, 6).forEach((e, i) => cssLines.push(`  --ease-${i + 1}: ${e};`));
durations.slice(0, 6).forEach((d, i) => cssLines.push(`  --duration-${i + 1}: ${d};`));
cssLines.push('}');
writeFileSync(path.join(tokensDir, 'tokens.css'), cssLines.join('\n') + '\n');

/* ------------------------------------------------------- tailwind config -- */
const twColors = {};
for (const [role, hex] of Object.entries(spec.color)) {
  if (typeof hex === 'string' && hex.startsWith('#')) twColors[kebab(role)] = hex;
}
const twFontSize = {};
for (const s of spec.typography.scale.slice(0, 10)) {
  twFontSize[String(s.px)] = [s.size, { lineHeight: [...s.lineHeights][0] || 'normal', letterSpacing: [...s.letterSpacing][0] || 'normal' }].filter(Boolean);
}
const twRadius = {};
radiusScale.slice(0, 6).forEach((r, i) => { twRadius[i === 0 ? 'sm' : i === 1 ? 'DEFAULT' : 'r' + i] = r; });
const twShadow = {};
shadowScale.slice(0, 5).forEach((s, i) => { twShadow[i === 0 ? 'DEFAULT' : 's' + i] = s; });
const twEase = {};
easings.slice(0, 5).forEach((e, i) => { twEase[i === 0 ? 'DEFAULT' : 'e' + i] = e; });
const twKeyframes = {};
const twAnimation = {};
for (const k of (R.motion?.byName || []).slice(0, 12)) {
  if (!k.cssBody) continue;
  const frames = {};
  for (const m of k.cssBody.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    const decl = {};
    for (const d of m[2].split(';')) {
      const [p, v] = d.split(':');
      if (p && v) decl[p.trim()] = v.trim();
    }
    frames[sel === 'from' ? '0%' : sel === 'to' ? '100%' : sel] = decl;
  }
  const key = k.name.replace(/[^\w-]/g, '');
  twKeyframes[key] = frames;
  twAnimation[key] = `${key} ${k.duration ? k.duration + 'ms' : '1s'} ${k.easing || 'ease'} ${k.iterations === Infinity || k.iterations === null ? 'infinite' : ''}`.trim();
}

const tw = `/** Generated by frontend-recon from ${spec.meta.url} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx,vue,svelte}'],
  theme: {
    extend: {
      colors: ${JSON.stringify(twColors, null, 6).replace(/\n}/, '\n      }')},
      fontSize: ${JSON.stringify(twFontSize, null, 6).replace(/\n}/, '\n      }')},
      borderRadius: ${JSON.stringify(twRadius, null, 6).replace(/\n}/, '\n      }')},
      boxShadow: ${JSON.stringify(twShadow, null, 6).replace(/\n}/, '\n      }')},
      transitionTimingFunction: ${JSON.stringify(twEase, null, 6).replace(/\n}/, '\n      }')},
      spacing: {${spacingScale.slice(0, 16).map((n) => `        '${n}': '${n}px'`).join(',\n')}
      },
      keyframes: ${JSON.stringify(twKeyframes, null, 6).replace(/\n}/, '\n      }')},
      animation: ${JSON.stringify(twAnimation, null, 6).replace(/\n}/, '\n      }')},
    },
  },
  plugins: [],
};
`;
writeFileSync(path.join(rebuildDir, 'tailwind.config.cjs'), tw);

/* ------------------------------------------------------------ rebuild kit -- */
const motionJs = `/* Generated helpers: the interaction patterns observed on ${spec.meta.url}.
 * Vanilla, no dependencies. Respects prefers-reduced-motion.
 */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function revealOnScroll(selector = '[data-reveal]', opts = {}) {
  const els = document.querySelectorAll(selector)
  if (reduced()) { els.forEach((el) => el.classList.add('is-visible')); return }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('is-visible')
      io.unobserve(e.target)
    }
  }, { threshold: opts.threshold ?? 0.2, rootMargin: opts.rootMargin ?? '0px 0px -10% 0px' })
  els.forEach((el) => io.observe(el))
}

export function ripple(selector = '[data-ripple]', opts = {}) {
  for (const host of document.querySelectorAll(selector)) {
    host.addEventListener('pointerdown', (ev) => {
      const r = host.getBoundingClientRect()
      const size = Math.max(r.width, r.height) * 2
      const span = document.createElement('span')
      span.className = 'ripple'
      span.style.cssText = \`position:absolute;border-radius:50%;pointer-events:none;width:\${size}px;height:\${size}px;left:\${ev.clientX - r.left - size / 2}px;top:\${ev.clientY - r.top - size / 2}px;background:currentColor;opacity:.45\`
      host.appendChild(span)
      const anim = span.animate(
        [{ transform: 'scale(0)', opacity: 0.45 }, { transform: 'scale(1)', opacity: 0 }],
        { duration: opts.duration ?? 600, easing: 'cubic-bezier(.22,1,.36,1)' },
      )
      anim.finished.then(() => span.remove())
    })
  }
}

export function magnetic(selector = '[data-magnetic]', strength = 0.3) {
  if (reduced()) return
  for (const el of document.querySelectorAll(selector)) {
    el.addEventListener('pointermove', (ev) => {
      const r = el.getBoundingClientRect()
      const x = (ev.clientX - (r.left + r.width / 2)) * strength
      const y = (ev.clientY - (r.top + r.height / 2)) * strength
      el.style.transform = \`translate(\${x}px, \${y}px)\`
    })
    el.addEventListener('pointerleave', () => { el.style.transform = '' })
  }
}

export function parallax(selector = '[data-parallax]', factor = 0.15) {
  if (reduced()) return
  const els = [...document.querySelectorAll(selector)]
  let ticking = false
  const onScroll = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      for (const el of els) {
        const r = el.getBoundingClientRect()
        const progress = (r.top + r.height / 2 - innerHeight / 2) / innerHeight
        el.style.transform = \`translate3d(0, \${(-progress * factor * 100).toFixed(2)}px, 0)\`
      }
      ticking = false
    })
  }
  addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

export function sound({ src, volume = 0.25 } = {}) {
  let ctx
  return {
    click() {
      if (!src) return
      ctx = ctx || new AudioContext()
      const a = new Audio(src)
      a.volume = volume
      a.play().catch(() => {})
    },
    beep(freq = 880, ms = 160) {
      ctx = ctx || new AudioContext()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      o.connect(g)
      g.connect(ctx.destination)
      g.gain.setValueAtTime(volume / 2, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000)
      o.start()
      o.stop(ctx.currentTime + ms / 1000)
    },
  }
}

export function initAll() {
  revealOnScroll()
  ripple()
  magnetic()
  parallax()
}
`;
writeFileSync(path.join(rebuildDir, 'motion.js'), motionJs);

const scaffoldCss = `@import './tokens.css';

/* Baseline derived from the captured page. Replace with real content. */
:root { color-scheme: light dark; }
body {
  margin: 0;
  background: var(--color-base, #0b0b12);
  color: var(--color-text, #f5f5ff);
  font-family: var(--font-sans, system-ui), system-ui, sans-serif;
}
[data-reveal] { opacity: 0; transform: translateY(24px); transition: opacity .7s var(--ease-1, ease-out), transform .7s var(--ease-1, ease-out); }
[data-reveal].is-visible { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
}
`;
writeFileSync(path.join(rebuildDir, 'scaffold.css'), scaffoldCss);

/* ---------------------------------------------------------------- report -- */
const shots = R.screenshots || [];
const sections = (R.outline?.sections || []).filter((s) => s.rect.h > 60);
const motionRows = (R.motion?.byName || [])
  .filter((m) => !String(m.name).startsWith('scroll:'))
  .slice(0, 24)
  .map((m) => [m.name, m.source, m.duration != null ? `${m.duration}ms` : '—', m.easing || '—', (m.targets || []).slice(0, 3).join(', ') || '—', (m.when || []).join('/')]);
const scrollRows = (R.scrollDriven || []).slice(0, 16).map((s) => [`${s.tag}${s.classes?.length ? '.' + s.classes.join('.') : ''}`, s._kind, s.position, s.pinned ? '是' : '否', (s.transformSeries || []).slice(0, 2).join(' → ') ]);
const hoverRows = (R.hovers || []).filter((h) => h.hoverDiff || h.activeDiff).map((h) => {
  const changed = Object.entries(h.hoverDiff || {}).filter(([k]) => k !== 'cursor').map(([k, v]) => `${k}: ${v.before} → ${v.after}`);
  const active = Object.keys(h.activeDiff || {}).filter((k) => k !== 'cursor');
  return [`${h.tag}${h.text ? ` "${h.text.slice(0, 24)}"` : ''}`, h.cursor, changed.slice(0, 4).join('<br>') || '—', active.join(', ') || '—', (h.animations || []).map((a) => a.name).join(', ') || '—'];
});
const clickRows = (R.clicks || []).filter((c) => c.clicked).map((c) => [
  `${c.tag}${c.text ? ` "${c.text.slice(0, 24)}"` : ''}`,
  c.clickMode || 'pointer',
  (c.newAnimations || []).length ? c.newAnimations.slice(0, 4).join(', ') : '—',
  c.waapiCalls || 0,
  c.audioTriggered ? '是' : '否',
  c.mediaTriggered ? '是' : '否',
  c.dialogOpened ? '是' : '否',
  c.navigated ? '跳转' : '—',
]);
const listenerRows = (() => {
  const counts = new Map();
  for (const l of R.listeners || []) {
    const key = l.type;
    const cur = counts.get(key) || { type: key, targets: new Set(), passive: 0, capture: 0, total: 0 };
    cur.total++;
    if (l.target) cur.targets.add(l.target);
    if (l.passive) cur.passive++;
    if (l.capture) cur.capture++;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total).slice(0, 14).map((c) => [c.type, c.total, [...c.targets].slice(0, 2).join(', '), c.passive ? '是' : '否', c.capture ? '是' : '否']);
})();
const assetGroups = (() => {
  const g = new Map();
  for (const a of R.assets?.files || []) {
    const key = a.type + (a.mime ? ` (${a.mime})` : '');
    const cur = g.get(key) || { key, count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += a.bytes || 0;
    g.set(key, cur);
  }
  return [...g.values()].sort((a, b) => b.bytes - a.bytes);
})();

const libs = Object.keys(R.libraries?.globals || {});
const audio = R.sound || {};

const md = [];
md.push(`# ${R.meta?.title || '页面'} — 前端设计 / 动效 / 交互取证报告`);
md.push('');
md.push(`> 抓取对象：${R.finalUrl || R.requestedUrl}  `);
md.push(`> 抓取时间：${R.capturedAt}  `);
md.push(`> 视口：${R.viewport?.width}×${R.viewport?.height} @${R.viewport?.dpr}x，浏览器：${R.browser}  `);
md.push(`> 采集耗时：${R.timings?.seconds ?? '?'} 秒，证据截图 ${shots.length} 张  `);
md.push('');
md.push('<!-- INSIGHT:START -->');
md.push('## 一句话判断');
md.push('');
md.push('_（待 agent 结合截图填写）_');
md.push('');
md.push('## 风格与设计语言');
md.push('');
md.push('_（待 agent 结合截图与下方令牌填写：气质、几何/排版特征、留白节奏、动效性格）_');
md.push('');
md.push('## 可借鉴点与风险');
md.push('');
md.push('_（待 agent 填写）_');
md.push('<!-- INSIGHT:END -->');
md.push('');
md.push('---');
md.push('');
md.push('## 1. 证据索引');
md.push('');
if (shots.length) {
  md.push(table(['#', '截图'], shots.slice(0, 30).map((s, i) => [i + 1, `[${s}](screenshots/${s})`])));
  md.push('');
  const hero = shots.find((s) => s.includes('hero'));
  if (hero) md.push(`![hero](screenshots/${hero})`);
  md.push('');
}
md.push('## 2. 设计令牌');
md.push('');
md.push(`- 底色 / 表层：\`${spec.color.base || '—'}\` / \`${spec.color.surface || '—'}\``);
md.push(`- 主文字 / 次文字：\`${spec.color.textPrimary || '—'}\` / \`${spec.color.textSecondary || '—'}\``);
md.push(`- 强调色：\`${spec.color.accent || '—'}\`${spec.color.accentAlt ? ` / \`${spec.color.accentAlt}\`` : ''}`);
md.push(`- 描边：\`${spec.color.border || '—'}\``);
md.push(`- 字体：${(spec.typography.families || []).slice(0, 3).map((f) => f.family).join('，') || '—'}`);
md.push(`- 间距基调：${baseUnit}px 网格，常用 ${spacingScale.slice(0, 8).join(' / ')} px`);
md.push(`- 圆角：${radiusScale.slice(0, 5).join(' / ') || '—'}`);
md.push(`- 缓动：${easings.slice(0, 4).join(' / ') || '—'}`);
md.push(`- 时长：${durations.slice(0, 5).join(' / ') || '—'}`);
md.push('');
md.push('### 调色板（按使用面积/文字量加权）');
md.push('');
md.push(table(['色值', '不透明度', '用途', '权重', 'HSL'], palette.slice(0, 14).map((p) => [p.hex, p.alpha.toFixed(2), p.kinds.join('+'), p.weight, `${p.hsl.h}° ${p.hsl.s}% ${p.hsl.l}%`])));
md.push('');
md.push('### 文字层级');
md.push('');
md.push(table(['字号', '字重', '行高', '字距', '用量'], typeSizes.slice(0, 12).map((s) => [s.size, [...s.weights].join('/'), [...s.lineHeights].join('/') || 'normal', [...s.letterSpacings].join('/') || 'normal', s.count])));
md.push('');
md.push('### CSS 变量（页面已声明）');
md.push('');
const varEntries = Object.entries(R.tokens.cssVars || {});
md.push(varEntries.length ? table(['变量', '值'], varEntries.slice(0, 30).map(([k, v]) => [`\`${k}\``, v.slice(0, 60)])) : '（未检测到 CSS 自定义属性）');
md.push('');
md.push('## 3. 页面结构');
md.push('');
md.push(sections.length ? table(['#', '标签', '类名', '高度', '标题 / 文本片段'], sections.slice(0, 18).map((s, i) => [i + 1, `<${s.tag}>`, (s.classes || []).join('.'), s.rect.h + 'px', (s.heading || s.text || '').slice(0, 60)])) : '（未识别出分区）');
md.push('');
if (R.outline?.headingsOutline?.length) {
  md.push('**标题大纲**');
  md.push('');
  md.push('```');
  md.push(R.outline.headingsOutline.slice(0, 30).join('\n'));
  md.push('```');
  md.push('');
}
/* ---- 深度取证：结构 / 规则 / 图层 / 断点 ---- */
const readJson = (rel, fallback) => {
  const p = path.join(outDir, rel);
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; } catch { return fallback; }
};
const elements = readJson(path.join('dom', 'elements.json'), []);
const cssRules = readJson(path.join('css', 'rules.json'), []);
const layerStack = readJson('layers.json', []);
const breakpointRows = readJson('breakpoints.json', []);

if (elements.length || cssRules.length) {
  const visible = elements.filter((e) => e.rect && e.rect[2] > 0 && e.rect[3] > 0);
  const SVG_TAGS = new Set(['rect', 'path', 'g', 'svg', 'circle', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'use', 'clippath', 'lineargradient', 'stop', 'text', 'title', 'mask', 'pattern', 'filter', 'feblend', 'fegaussianblur', 'symbol', 'image']);
  const htmlNodes = visible.filter((e) => !SVG_TAGS.has(e.t));
  const svgNodes = visible.length - htmlNodes.length;
  const byTag = new Map();
  for (const e of htmlNodes) byTag.set(e.t, (byTag.get(e.t) || 0) + 1);
  const tagRows = [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  const hasDur = (e) => { const d = e.s && e.s['transition-duration']; return !!d && !/^0m?s$/.test(d); };
  const withAnim = visible.filter((e) => e.s && e.s['animation-name']);
  const withTrans = visible.filter(hasDur);
  const withPseudo = visible.filter((e) => e.b || e.a);
  const clipped = visible.filter((e) => e.s && e.s['clip-path']);
  const blurred = visible.filter((e) => e.s && (e.s['backdrop-filter'] || e.s.filter));
  const stickyFixed = visible.filter((e) => e.s && (e.s.position === 'sticky' || e.s.position === 'fixed'));
  const hashed = new Set(visible.map((e) => e.c).filter(Boolean)).size;

  md.push('## 3.1 结构快照（逐元素）');
  md.push('');
  md.push(`页面上共 **${R.deep?.elementCount ?? visible.length}** 个元素，抓到 **${visible.length}** 个可见节点（含计算样式、绝对坐标、伪元素、运行中动画）；其中 HTML ${htmlNodes.length} 个、内联 SVG 图形 ${svgNodes} 个。`);
  md.push('');
  md.push(`- 唯一 class 组合：${hashed}；带 \`animation\`：${withAnim.length}；有实际过渡（时长>0）：${withTrans.length}；画了 \`::before/::after\`：${withPseudo.length}`);
  md.push(`- \`clip-path\`：${clipped.length}；\`filter/backdrop-filter\`：${blurred.length}；\`position: sticky|fixed\`：${stickyFixed.length}`);
  md.push('');
  md.push(table(['HTML 标签', '数量'], tagRows.map(([t, n]) => [`<${t}>`, n])));
  md.push('');
  md.push('> 逐元素原始数据在 `dom/elements.json`（每个节点含 ~90 项计算样式、`rect`、文本、伪元素与运行中动画）。');
  md.push('');
}

if (Array.isArray(R.sectionDetails) && R.sectionDetails.length) {
  md.push('## 3.2 逐区块取证');
  md.push('');
  md.push(table(
    ['#', '区块', '尺寸', '子节点', '文本字数', '入场动画', '截图'],
    R.sectionDetails.slice(0, 14).map((s) => [
      s.index,
      `\`${s.selector}\``,
      `${s.rect?.[2]}×${s.rect?.[3]}`,
      s.nodes,
      s.textChars,
      s.animations,
      `[section-${String(s.index).padStart(2, '0')}.png](screenshots/03-section-${String(s.index).padStart(2, '0')}.png)`,
    ]),
  ));
  md.push('');
  md.push('> 每块滚动到视口后单独取证：子树结构、文本、进入时的动画快照，存在 `sections/section-XX.json`。');
  md.push('');
}

if (cssRules.length) {
  const kinds = cssRules.reduce((m, r) => {
    const k = r.blocked ? 'blocked（跨域）' : r.keyframes ? '@keyframes' : r.fontface ? '@font-face' : '样式规则';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const selText = cssRules.map((r) => r.sel || '').join('\n');
  const count = (re) => (selText.match(re) || []).length;
  const animRules = cssRules.filter((r) => r.decls && (r.decls.animation || r.decls['animation-name'] || r.decls.transition || r.decls['transition-property']));
  const varRules = cssRules.filter((r) => r.decls && Object.keys(r.decls).some((k) => k.startsWith('--')));

  md.push('## 3.3 CSS 规则全量');
  md.push('');
  md.push(table(['类型', '条数'], Object.entries(kinds).map(([k, v]) => [k, v])));
  md.push('');
  md.push(`- 带 \`:hover\` 的选择器：${count(/:hover/g)} 条；\`:focus\`：${count(/:focus/g)} 条；\`:active\`：${count(/:active/g)}；\`:has(\`：${count(/:has\(/g)}`);
  md.push(`- 声明了 \`animation/transition\` 的规则：${animRules.length} 条；声明自定义属性的规则：${varRules.length} 条`);
  md.push('');
  if (animRules.length) {
    md.push(table(['选择器', '动效声明'], animRules.slice(0, 16).map((r) => {
      const d = r.decls;
      const v = ['animation', 'animation-name', 'transition', 'transition-property']
        .map((k) => (d[k] ? `${k}: ${d[k]}` : null)).filter(Boolean).join('；');
      return [`\`${(r.sel || '').slice(0, 70)}\``, v.slice(0, 140)];
    })));
    md.push('');
  }
  md.push('> 结构化全文在 `css/rules.json`（选择器 + 逐条声明 + 媒体条件 + 来源），未压缩的原始 CSS 在 `css/bundle.css`。');
  md.push('');
}

if (layerStack.length) {
  md.push('## 3.4 图层栈（stacking context）');
  md.push('');
  md.push(table(
    ['元素', 'z-index', 'position', '尺寸', '成因'],
    layerStack.slice(0, 18).map((l) => [
      `${l.tag}${l.cls ? '.' + l.cls : ''}`,
      l.z === null ? 'auto' : l.z,
      l.pos,
      `${l.rect?.[2]}×${l.rect?.[3]}`,
      (l.why || []).join(', ') || '—',
    ]),
  ));
  md.push('');
  md.push(`> 共 ${layerStack.length} 个层叠上下文；完整数据在 \`layers.json\`。这决定了谁压住谁——复刻时最容易翻车的地方。`);
  md.push('');
}

if (breakpointRows.length) {
  md.push('## 3.5 断点实测');
  md.push('');
  md.push(table(
    ['宽度', '页面高度', '节点', '文本字数', 'grid/flex', '截图'],
    breakpointRows.map((b) => [
      b.error ? `${b.width}（失败）` : `${b.width}px`,
      b.error ? '—' : b.scrollHeight + 'px',
      b.nodes ?? '—',
      b.textLen ?? '—',
      b.error ? '—' : `${b.columns?.grid ?? '—'}/${b.columns?.flex ?? '—'}`,
      b.screenshot ? `[${b.screenshot}](screenshots/${b.screenshot})` : '—',
    ]),
  ));
  md.push('');
  md.push('> 每个断点都真的切换视口重测（不是从 CSS 里猜的），首屏截图一并留证。');
  md.push('');
}

md.push('## 4. 动效清单');
md.push('');
md.push(`运行中动画（首屏）：${(R.animationsBaseline || []).length} 个；结束时：${(R.animationsFinal || []).length} 个；\`@keyframes\` 定义：${R.css?.keyframes?.length || 0} 个；rAF 帧调用：${R.rafFrames || 0}；自播动画元素：${R.selfAnimatingCount || 0}。`);
md.push('');
md.push(motionRows.length ? table(['动画名', '来源', '时长', '缓动', '目标', '触发时机'], motionRows) : '（未捕获到名字可辨的动画）');
md.push('');
md.push('### 滚动驱动效果');
md.push('');
md.push(scrollRows.length ? table(['元素', '类型', 'position', '吸顶', '位移序列'], scrollRows) : '（未检测到滚动驱动的位移/显隐）');
md.push('');
md.push('## 5. 交互取证（悬停 / 按下 / 点击）');
md.push('');
md.push(hoverRows.length ? table(['元素', 'cursor', 'hover 变化', 'active 变化', 'hover 动画'], hoverRows) : '（未捕获到 hover/active 样式变化）');
md.push('');
md.push(clickRows.length ? table(['元素', '点击方式', '新动画', 'WAAPI 次数', '音效', '媒体', '弹层', '导航'], clickRows) : '（未执行点击取证）');
md.push('');
md.push('### 事件监听（注入期抓取）');
md.push('');
md.push(listenerRows.length ? table(['事件', '次数', '代表绑定目标', 'passive', 'capture'], listenerRows) : '（未捕获）');
md.push('');
md.push('## 6. 音效');
md.push('');
md.push(`- 结论：**${audio.verdict || '未知'}**`);
md.push(`- Web Audio 节点：${JSON.stringify(audio.audioApiKinds || {})}`);
md.push(`- 媒体播放调用：${(audio.playCalls || []).length} 次${(audio.playCalls || []).length ? `（首个：${esc((audio.playCalls[0].src || '').slice(0, 80))}）` : ''}`);
md.push(`- 网络音频资源：${(audio.networkAudio || []).length} 个`);
md.push(`- 由交互触发：${(audio.triggeredByInteraction || []).map((t) => `${t.tag}${t.text ? `(${t.text.slice(0, 16)})` : ''}`).join('、') || '无'}`);
md.push(`- 音频库：${Object.entries(audio.libraries || {}).filter(([, v]) => v).map(([k]) => k).join('、') || '无'}`);
md.push('');
if ((audio.networkAudio || []).length) {
  md.push(listOr(audio.networkAudio.slice(0, 12).map((u) => `\`${u}\``)));
  md.push('');
}
md.push('## 7. 技术栈信号');
md.push('');
md.push(`- 框架判定：${R.libraries?.framework || '未识别'}`);
md.push(`- 全局对象：${libs.join('、') || '未识别'}`);
md.push(`- 脚本关键字：${(R.libraries?.scriptHints || []).join('、') || '无'}`);
md.push(`- CSS-in-JS / 样式方案：${(() => {
  const c = R.libraries?.cssInJs || {};
  const parts = [];
  if (c.tailwindRatio) parts.push(`Tailwind 类名占比 ${c.tailwindRatio}%`);
  if (c.styledComponents) parts.push('styled-components');
  if (c.emotion) parts.push('emotion');
  if (c.jss) parts.push('JSS');
  if (c.radix) parts.push('Radix UI');
  if (c.vaul) parts.push('Vaul drawer');
  return parts.join('、') || '未识别';
})()}`);
md.push(`- GSAP 版本：${R.libraries?.gsapVersion || '—'}`);
md.push(`- CSS 特性：scroll-timeline 规则 ${R.css?.stats?.scrollTimelineRules || 0} 条，:has() ${R.css?.stats?.hasSelectors || 0} 处，container query ${R.css?.stats?.containerQueries || 0} 条，@layer ${R.css?.stats?.layers || 0} 条，prefers-reduced-motion ${R.css?.stats?.reducedMotionRules || 0} 处`);
md.push('');
md.push('## 8. 布局与响应式');
md.push('');
md.push(`- 断点：${(R.css?.breakpoints || []).join(', ') || '未从 CSS 中解析到'}  `);
md.push(`- 媒体查询：${(R.css?.mediaQueries || []).length} 条  `);
md.push(`- grid / flex 元素：${R.tokens.misc?.grid} / ${R.tokens.misc?.flex}  `);
md.push(`- 吸顶 / 固定定位：${R.tokens.misc?.sticky} / ${R.tokens.misc?.fixed}  `);
md.push(`- 移动端（390×844）页面高度：${R.mobile?.scrollHeight ?? '—'}px`);
md.push('');
md.push('## 9. 素材清单');
md.push('');
md.push(assetGroups.length ? table(['类型', '数量', '体积'], assetGroups.map((g) => [g.key, g.count, (g.bytes / 1024).toFixed(0) + ' KB'])) : '（未下载素材）');
md.push('');
md.push(`- 内联 SVG：${(R.screenshots || []).length ? (R.assets?.files || []).filter((f) => f.type === 'svg-inline').length : 0} 个，已存入 \`svg/\``);
md.push(`- 网络请求：${R.network?.total || 0} 个（第三方域：${(R.network?.thirdPartyHosts || []).length}）`);
md.push('');
md.push('## 10. 复刻建议');
md.push('');
md.push('已生成可直接使用的复刻脚手架：');
md.push('');
md.push('- `tokens/design-tokens.json` — 机器可读的设计令牌');
md.push('- `tokens/tokens.css` — CSS 变量');
md.push('- `rebuild/tailwind.config.cjs` — Tailwind 主题（含 keyframes/animation）');
md.push('- `rebuild/motion.js` — reveal / ripple / magnetic / parallax / sound 工具');
md.push('- `rebuild/scaffold.css` — 基础样式');
md.push('');
md.push('复刻顺序建议：先还原版式与字色（tokens），再套动效（motion 清单），最后补交互态与音效。');
md.push('');
md.push('## 11. 局限与合规');
md.push('');
md.push('- 抓取结果为「单次访问的静态快照 + 交互重放」，登录态、A/B 实验、随机内容、实时数据不会复现。');
md.push('- 音效只在触发瞬间被记录（Web Audio 波形不落盘）；若站点需要用户手势才初始化音频，请结合 `--storage` 与真实点击复测。');
md.push('- 素材版权归原站点所有；仓库中的 `assets/` 仅用于分析对照，不要直接用于对外发布。');
md.push('- 请遵守目标站点 robots.txt、服务条款与当地法律；默认单页低频访问，不要并发压站。');
md.push('');
if (R.errors && ((R.errors.page || []).length || (R.errors.console || []).length)) {
  md.push('## 12. 页面运行时报错（参考）');
  md.push('');
  md.push(listOr([...(R.errors.page || []).slice(0, 5), ...(R.errors.console || []).slice(0, 5)].map((e) => `\`${String(e).slice(0, 120)}\``)));
  md.push('');
}

const reportPath = path.join(outDir, 'REPORT.md');
writeFileSync(reportPath, md.join('\n'));
console.log(JSON.stringify({
  report: reportPath,
  tokens: path.join(tokensDir, 'design-tokens.json'),
  css: path.join(tokensDir, 'tokens.css'),
  tailwind: path.join(rebuildDir, 'tailwind.config.cjs'),
  motion: path.join(rebuildDir, 'motion.js'),
  palette: palette.length,
  typeSizes: typeSizes.length,
  motionItems: motionRows.length,
  hoverItems: hoverRows.length,
}, null, 2));