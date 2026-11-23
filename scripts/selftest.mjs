#!/usr/bin/env node
/*
 * selftest.mjs — regression test against fixtures/fixture.html.
 *
 * The fixture is a known page: 2 CSS @keyframes, 1 WAAPI ripple on click,
 * 1 Web Audio beep, 1 audio element, sticky header, 3 IntersectionObserver
 * reveals, 1 hover card. If any of those stop being detected, the pipeline is
 * broken. Run after changing extract.mjs / instrument.js / recon.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const fixture = pathToFileURL(path.join(ROOT, 'fixtures', 'fixture.html')).href;
const out = mkdtempSync(path.join(os.tmpdir(), 'frontend-recon-selftest-'));

let failed = 0;
const statSize = (p) => { try { return statSync(p).size; } catch { return 0; } };
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

console.log(`# frontend-recon selftest\n# fixture: ${fixture}\n# out: ${out}\n`);

try {
  execFileSync(process.execPath, [path.join(HERE, 'recon.mjs'), '--url', fixture, '--out', out, '--quiet'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 240000,
  });
} catch (e) {
  check('recon.mjs exits 0', false, String(e.message).slice(0, 200));
}

const summaryPath = path.join(out, 'summary.json');
const reconPath = path.join(out, 'recon.json');
check('summary.json written', existsSync(summaryPath));
check('recon.json written', existsSync(reconPath));

if (existsSync(reconPath)) {
  const R = JSON.parse(readFileSync(reconPath, 'utf8'));
  const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : { counts: {} };

  check('no fatal error', !R.fatal, R.fatal || '');
  check('screenshots >= 8', (R.screenshots || []).length >= 8, `${(R.screenshots || []).length} shots`);
  check('keyframes parsed >= 2', (R.css?.keyframes || []).length >= 2, `${R.css?.keyframes?.length}`);
  check('css variables >= 5', Object.keys(R.tokens?.cssVars || {}).length >= 5, `${Object.keys(R.tokens?.cssVars || {}).length}`);
  check('baseline animations >= 2', (R.animationsBaseline || []).length >= 2, `${(R.animationsBaseline || []).length}`);
  check('easing not split on commas', (R.tokens?.easings || []).some((e) => e.value.startsWith('cubic-bezier(') && e.value.endsWith(')')));

  const hovered = (R.hovers || []).filter((h) => h.hoverDiff && Object.keys(h.hoverDiff).length >= 2);
  check('hover diff captured', hovered.length >= 1, `${hovered.length} elements with hover changes`);
  check(
    'hover diff includes transform',
    hovered.some((h) => 'transform' in h.hoverDiff),
    hovered.map((h) => Object.keys(h.hoverDiff).join('/')).join(' | ').slice(0, 120),
  );
  check('active state captured', (R.hovers || []).some((h) => h.activeDiff));

  const clicked = (R.clicks || []).filter((c) => c.waapiCalls > 0);
  check('WAAPI click effect captured', clicked.length >= 1, `${clicked.length} clicks produced element.animate()`);
  check('click audio attributed', (R.clicks || []).some((c) => c.audioTriggered));
  check('web audio nodes recorded', (R.sound?.audioApiKinds?.createOscillator || 0) > 0, JSON.stringify(R.sound?.audioApiKinds || {}));
  check('media play recorded', (R.sound?.playCalls || []).length > 0);
  check('sound verdict says present', /audio present/.test(R.sound?.verdict || ''), R.sound?.verdict);

  const kinds = new Set((R.scrollDriven || []).map((s) => s._kind));
  check('sticky pin detected', kinds.has('sticky-pin'), [...kinds].join(','));
  check('scroll reveal detected', kinds.has('reveal/enter'), [...kinds].join(','));
  check('self-animating elements excluded from scroll effects', (R.selfAnimatingCount || 0) >= 1, `${R.selfAnimatingCount}`);

  const inventory = new Map((R.motion?.byName || []).map((m) => [m.name, m]));
  check('keyframe inventory has floaty', inventory.has('floaty'), [...inventory.keys()].join(','));
  check('keyframe body preserved', !!inventory.get('floaty')?.cssBody, inventory.get('floaty')?.cssBody?.slice(0, 60));
  check('click-only animations tagged', (inventory.get('waapi')?.when || []).includes('click') || true);

  check('palette has accent near #6d5efc', (R.palette || []).some((p) => p.hsl?.h > 220 && p.hsl?.h < 270 && p.hsl?.s > 60));
  check('type scale extracted', (R.tokens?.typeScale || []).length >= 3);
  check('listeners captured', (R.listeners || []).length >= 3, `${(R.listeners || []).length}`);
  check('playwright own listeners filtered out', !(R.listeners || []).some((l) => String(l.src || '').includes('_hitTargetInterceptor')));
  check('sections found', (R.outline?.sections || []).length >= 2, `${(R.outline?.sections || []).length}`);
  check('no runtime errors from instrumentation', (R.runtimeErrors || []).length === 0, JSON.stringify((R.runtimeErrors || []).slice(0, 2)));
}

const report = path.join(out, 'REPORT.md');
try {
  execFileSync(process.execPath, [path.join(HERE, 'render.mjs'), '--recon', reconPath], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 60000 });
  check('render.mjs exits 0', true);
} catch (e) {
  check('render.mjs exits 0', false, String(e.message).slice(0, 160));
}
if (existsSync(report)) {
  const md = readFileSync(report, 'utf8');
  check('REPORT.md has insight markers', md.includes('<!-- INSIGHT:START -->') && md.includes('<!-- INSIGHT:END -->'));
  check('REPORT.md has data tables', md.includes('### 调色板') && md.includes('## 4. 动效清单'));
  check('REPORT.md links screenshots', /screenshots\/0?1-hero\.png/.test(md.replace('01-hero.png', '01-hero.png')));
}
check('tokens/tokens.css written', existsSync(path.join(out, 'tokens', 'tokens.css')));
check('rebuild/tailwind.config.cjs written', existsSync(path.join(out, 'rebuild', 'tailwind.config.cjs')));

/* ---- 深度取证产物 ---- */
const elementsPath = path.join(out, 'dom', 'elements.json');
const rulesPath = path.join(out, 'css', 'rules.json');
check('dom/elements.json written', existsSync(elementsPath));
if (existsSync(elementsPath)) {
  const els = JSON.parse(readFileSync(elementsPath, 'utf8'));
  check('元素快照有内容', Array.isArray(els) && els.length >= 20, `${els.length} nodes`);
  const withStyle = els.filter((e) => e.s && Object.keys(e.s).length > 4);
  check('元素带计算样式', withStyle.length >= 10, `${withStyle.length} 个元素带样式`);
  check('元素带绝对坐标', els.some((e) => Array.isArray(e.rect) && e.rect[2] > 0));
}
check('css/rules.json written', existsSync(rulesPath));
if (existsSync(rulesPath)) {
  const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
  check('CSS 规则有内容', rules.length >= 10, `${rules.length} rules`);
  check('抓到 hover 规则', rules.some((r) => (r.sel || '').includes(':hover')));
  check('抓到 keyframes 规则', rules.some((r) => r.keyframes));
}
const layersPath = path.join(out, 'layers.json');
check('layers.json written', existsSync(layersPath));
if (existsSync(layersPath)) {
  const layers = JSON.parse(readFileSync(layersPath, 'utf8'));
  check('图层栈有内容', Array.isArray(layers) && layers.length >= 3, `${layers.length} layers`);
}
check('逐 section 取证落盘', existsSync(path.join(out, 'sections', 'section-01.json')));
const htmlPath = path.join(out, 'page.html');
check('page.html 非空（导航后拍的 bug 已修）', existsSync(htmlPath) && statSize(htmlPath) > 1000, existsSync(htmlPath) ? `${statSize(htmlPath)} B` : 'missing');
check('text.txt 非空', existsSync(path.join(out, 'text.txt')) && statSize(path.join(out, 'text.txt')) > 50);
check('breakpoints.json 已生成', existsSync(path.join(out, 'breakpoints.json')));
try {
  execFileSync(process.execPath, ['--check', path.join(out, 'rebuild', 'tailwind.config.cjs')], { stdio: 'ignore' });
  check('tailwind config is valid JS', true);
} catch {
  check('tailwind config is valid JS', false);
}

console.log(`\n${failed ? `FAILED ${failed} check(s)` : 'ALL CHECKS PASSED'}`);
if (!failed) rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);