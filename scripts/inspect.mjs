#!/usr/bin/env node
/*
 * inspect.mjs — print one bounded slice of recon.json so the agent never has to
 * read a multi-megabyte file into context.
 *
 * Usage: node scripts/inspect.mjs --recon=<dir>/recon.json --section=hovers [--limit=20]
 */
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const hit = argv[i];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const reconPath = flag('recon') || 'recon/recon.json';
const section = flag('section', 'summary');
const limit = Number(flag('limit', 20));
const R = JSON.parse(readFileSync(reconPath, 'utf8'));

const clip = (s, n = 160) => {
  const v = typeof s === 'string' ? s : JSON.stringify(s);
  return v && v.length > n ? v.slice(0, n) + '…' : v;
};
const print = (label, value) => console.log(`\n## ${label}\n` + value);

const fmt = (x) => (x !== null && typeof x === 'object' ? JSON.stringify(x).slice(0, 140) : String(x).slice(0, 140));

const sections = {
  summary() {
    console.log(JSON.stringify({
      url: R.finalUrl,
      title: R.meta?.title,
      capturedAt: R.capturedAt,
      seconds: R.timings?.seconds,
      fatal: R.fatal || null,
      warning: R.warning || null,
      counts: {
        keyframes: R.css?.keyframes?.length || 0,
        cssVars: Object.keys(R.tokens?.cssVars || {}).length,
        palette: (R.palette || []).length,
        animations: (R.motion?.byName || []).length,
        hovers: (R.hovers || []).length,
        clicks: (R.clicks || []).length,
        scrollDriven: (R.scrollDriven || []).length,
        listeners: (R.listeners || []).length,
        assets: R.assets?.count || 0,
        screenshots: (R.screenshots || []).length,
      },
      sound: R.sound?.verdict,
      libraries: Object.keys(R.libraries?.globals || {}),
    }, null, 2));
  },
  tokens() {
    print('css vars (first 40)', Object.entries(R.tokens.cssVars || {}).slice(0, 40).map(([k, v]) => `${k}: ${clip(v, 60)}`).join('\n'));
    print('easings', JSON.stringify(R.tokens.easings));
    print('durations', JSON.stringify(R.tokens.durations));
    print('radius', JSON.stringify((R.tokens.radius || []).slice(0, 10)));
    print('shadows', JSON.stringify((R.tokens.shadows || []).slice(0, 6)));
    print('misc', JSON.stringify(R.tokens.misc));
  },
  palette() {
    print('palette', (R.palette || []).slice(0, limit).map((p) => `${p.hex} a=${p.alpha} ${p.kinds.join('+')} w=${p.weight} hsl=${p.hsl.h}/${p.hsl.s}/${p.hsl.l}`).join('\n'));
  },
  type() {
    print('fonts', (R.tokens.fonts || []).slice(0, limit).map((f) => `${f.value} (w=${f.weight})`).join('\n'));
    print('scale', (R.tokens.typeScale || []).slice(0, limit).map((t) => t.value + '  w=' + t.weight).join('\n'));
    print('headings', (R.outline.headings || []).slice(0, limit).map((h) => `H${h.level} ${clip(h.text, 80)} [${h.style.size}/${h.style.weight}]`).join('\n'));
  },
  motion() {
    print('inventory', (R.motion?.byName || []).slice(0, limit).map((m) => `${m.name} [${m.source}] ${m.duration ?? '-'}ms ${m.easing ?? ''} count=${m.count} when=${(m.when || []).join(',')} targets=${clip((m.targets || []).join(','), 80)}`).join('\n'));
    print('keyframes', (R.css?.keyframes || []).slice(0, limit).map((k) => `@keyframes ${k.name} { ${clip(k.body, 120)} }`).join('\n'));
    print('unusedKeyframes', JSON.stringify(R.motion?.unusedKeyframes || []));
    print('stats', JSON.stringify({ rafFrames: R.rafFrames, selfAnimating: R.selfAnimatingCount, ...R.motion?.stats }));
  },
  hovers() {
    for (const h of (R.hovers || []).slice(0, limit)) {
      console.log(`\n- ${h.tag} "${clip(h.text, 40)}" cursor=${h.cursor} shot=${h.screenshot || '—'}`);
      console.log(`  transition: ${clip(h.transition, 120)}`);
      if (h.hoverDiff) for (const [k, v] of Object.entries(h.hoverDiff).slice(0, 12)) console.log(`  hover  ${k}: ${v.before} → ${v.after}`);
      if (h.activeDiff) console.log(`  active: ${Object.keys(h.activeDiff).join(', ')}`);
      if ((h.animations || []).length) console.log(`  anims: ${h.animations.map((a) => a.name + ' ' + a.duration + 'ms').join(', ')}`);
      if (h.error) console.log(`  error: ${h.error}`);
    }
  },
  clicks() {
    for (const c of (R.clicks || []).slice(0, limit)) {
      console.log(`- ${c.tag} "${clip(c.text, 40)}" mode=${c.clickMode || (c.clicked ? 'pointer' : 'failed')} nav=${!!c.navigated} dialog=${!!c.dialogOpened}`);
      console.log(`  newAnims=${JSON.stringify((c.newAnimations || []).slice(0, 4))} waapi=${c.waapiCalls || 0} audio=${!!c.audioTriggered} media=${!!c.mediaTriggered} nodeDelta=${c.nodeDelta ?? 0} shot=${c.screenshot || '—'}`);
      if (c.error) console.log(`  error: ${clip(c.error, 120)}`);
    }
    print('waapi calls', (R.animate || []).slice(0, limit).map((a) => `${a.target} ${a.duration}ms ${a.easing || ''} ${clip(a.keyframes, 160)}`).join('\n'));
  },
  scroll() {
    print('surfaces', JSON.stringify(R.scrollSurfaces, null, 1).slice(0, 2000));
    print('scrollDriven', (R.scrollDriven || []).slice(0, limit).map((s) => `${s.tag}.${(s.classes || []).join('.')} [${s._kind}] pinned=${s.pinned} transform=${clip((s.transformSeries || []).join(' → '), 100)}`).join('\n'));
    print('onScroll animations', (R.animationsOnScroll || []).slice(0, limit).map((a) => `${a.name} ${a.when}`).join('\n'));
  },
  sound() {
    console.log(JSON.stringify(R.sound, null, 2).slice(0, 4000));
  },
  libs() {
    console.log(JSON.stringify({
      framework: R.libraries?.framework,
      globals: R.libraries?.globals,
      hints: R.libraries?.scriptHints,
      gsapVersion: R.libraries?.gsapVersion,
      dom: R.libraries?.dom,
      cssInJs: R.libraries?.cssInJs,
    }, null, 2));
    print('observers', JSON.stringify(R.observers));
    print('listener types', Object.entries((R.listeners || []).reduce((m, l) => (m[l.type] = (m[l.type] || 0) + 1, m), {})).map(([k, v]) => `${k}:${v}`).join(' '));
  },
  sections() {
    for (const s of (R.outline.sections || []).slice(0, limit)) {
      console.log(`- <${s.tag}> ${(s.classes || []).join('.')} ${s.rect.w}x${s.rect.h} @y${s.rect.y} bg=${s.bg} ${clip(s.heading || s.text, 70)}`);
    }
    print('landmarks', JSON.stringify(R.outline.landmarks));
    print('links', (R.outline.links || []).slice(0, 12).map((l) => `${l.text} -> ${l.href}`).join('\n'));
  },
  assets() {
    print('files', (R.assets?.files || []).slice(0, limit).map((f) => `${f.type || ''} ${f.file} ${f.bytes || ''} ${clip(f.url || '', 80)}`).join('\n'));
    print('network', JSON.stringify(R.network?.byType));
  },
  errors() {
    console.log(JSON.stringify(R.errors, null, 2).slice(0, 3000));
    print('runtime', JSON.stringify(R.runtimeErrors || []));
  },
  elements() {
    const p = path.join(path.dirname(reconPath), 'dom', 'elements.json');
    if (!fs.existsSync(p)) { console.log('没有 dom/elements.json（用 --no-deep 跑过？）'); return; }
    const els = JSON.parse(fs.readFileSync(p, 'utf8'));
    const vis = els.filter((e) => e.rect && e.rect[2] > 0);
    console.log(`元素 ${els.length} 个，可见 ${vis.length} 个`);
    print('按标签统计', Object.entries(vis.reduce((m, e) => (m[e.t] = (m[e.t] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t, n]) => `<${t}> ${n}`).join(' · '));
    print('带动画的元素', vis.filter((e) => e.s && e.s['animation-name']).slice(0, limit).map((e) => `${e.t}${e.c ? '.' + e.c.split('.')[0] : ''} → ${e.s['animation-name']} ${e.s['animation-duration'] || ''}`).join('\n'));
    print('带伪元素的元素', vis.filter((e) => e.b || e.a).slice(0, limit).map((e) => `${e.t}${e.c ? '.' + e.c.split('.')[0] : ''} ${e.b ? '::before' : ''}${e.a ? ' ::after' : ''} ${JSON.stringify(e.b || e.a).slice(0, 100)}`).join('\n'));
    print('最大的 12 个元素', vis.slice().sort((a, b) => b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3]).slice(0, 12).map((e) => `${e.t}${e.c ? '.' + e.c.split('.')[0] : ''} ${e.rect[2]}×${e.rect[3]} @${e.rect[1]}`).join('\n'));
  },
  layers() {
    const p = path.join(path.dirname(reconPath), 'layers.json');
    if (!fs.existsSync(p)) { console.log('没有 layers.json'); return; }
    const layers = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`层叠上下文 ${layers.length} 个`);
    for (const l of layers.slice(0, limit)) {
      console.log(`- ${l.tag}${l.cls ? '.' + l.cls : ''}  z=${l.z ?? 'auto'}  ${l.pos}  ${l.rect[2]}×${l.rect[3]} @${l.rect[1]}  [${(l.why || []).join(',')}]`);
    }
  },
  rules() {
    const p = path.join(path.dirname(reconPath), 'css', 'rules.json');
    if (!fs.existsSync(p)) { console.log('没有 css/rules.json'); return; }
    const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
    const kinds = rules.reduce((m, r) => (m[r.keyframes ? '@keyframes' : r.fontface ? '@font-face' : r.blocked ? 'blocked' : 'style'] = (m[r.keyframes ? '@keyframes' : r.fontface ? '@font-face' : r.blocked ? 'blocked' : 'style'] || 0) + 1, m), {});
    console.log('规则统计', JSON.stringify(kinds));
    const anim = rules.filter((r) => r.decls && (r.decls.animation || r.decls['animation-name'] || r.decls.transition || r.decls['transition-property']));
    print('声明动效的规则', anim.slice(0, limit).map((r) => `${(r.sel || '').slice(0, 60)}  →  ${['animation', 'animation-name', 'transition', 'transition-property'].map((k) => r.decls[k]).filter(Boolean).join(' | ').slice(0, 100)}`).join('\n'));
    print('媒体查询', JSON.stringify([...new Set(rules.map((r) => r.media).filter(Boolean))].slice(0, 20)));
  },
  breakpoints() {
    const p = path.join(path.dirname(reconPath), 'breakpoints.json');
    if (!fs.existsSync(p)) { console.log('没有 breakpoints.json'); return; }
    for (const b of JSON.parse(fs.readFileSync(p, 'utf8'))) {
      console.log(`- ${b.width}px  高度 ${b.scrollHeight ?? '—'}  grid/flex ${b.columns?.grid ?? '—'}/${b.columns?.flex ?? '—'}  ${b.screenshot || ''}`);
    }
  },
};

if (!sections[section]) {
  console.error(`unknown section "${section}". Available: ${Object.keys(sections).join(', ')}`);
  process.exit(2);
}
sections[section]();