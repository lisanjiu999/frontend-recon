#!/usr/bin/env node
/*
 * frontend-recon - deep frontend forensics for a single URL.
 *
 * Deterministic capture only: it records what the page really does (styles,
 * keyframes, running animations, hover/active/click reactions, scroll-driven
 * effects, audio, assets) into recon.json plus evidence screenshots. Judgment
 * and prose belong to the calling agent; see references/report-template.md.
 *
 * Usage:
 *   node scripts/recon.mjs --url=https://example.com [--out=DIR] [--pages=1]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './lib/browser.mjs';
import * as EX from './extract.mjs';
import * as EXD from './deep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ---------------------------------------------------------------- args -- */
function parseArgs(argv) {
  const opt = {
    url: null,
    out: null,
    pages: 1,
    width: 1440,
    height: 900,
    dpr: 1,
    mobile: true,
    assets: true,
    maxAssetsMB: 40,
    timeout: 45000,
    scrollSteps: 0,
    maxHover: 8,
    maxClick: 6,
    banners: true,
    saveHtml: true,
    quiet: false,
    headers: null,
    storage: null,
    maxSeconds: 240,
    deep: true,
    maxElements: 8000,
    breakpointScan: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    let k = body;
    let vRaw;
    if (body.includes('=')) {
      const at = body.indexOf('=');
      k = body.slice(0, at);
      vRaw = body.slice(at + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      vRaw = argv[++i];
    }
    const v = vRaw === undefined ? true : vRaw;
    switch (k) {
      case 'url': opt.url = String(v); break;
      case 'out': opt.out = String(v); break;
      case 'pages': opt.pages = Math.max(1, Math.min(20, Number(v))); break;
      case 'width': opt.width = Number(v); break;
      case 'height': opt.height = Number(v); break;
      case 'dpr': opt.dpr = Number(v); break;
      case 'no-mobile': opt.mobile = false; break;
      case 'no-assets': opt.assets = false; break;
      case 'no-banners': opt.banners = false; break;
      case 'no-html': opt.saveHtml = false; break;
      case 'max-assets-mb': opt.maxAssetsMB = Number(v); break;
      case 'timeout': opt.timeout = Number(v); break;
      case 'scroll-steps': opt.scrollSteps = Number(v); break;
      case 'max-hover': opt.maxHover = Number(v); break;
      case 'max-click': opt.maxClick = Number(v); break;
      case 'max-seconds': opt.maxSeconds = Number(v); break;
      case 'headers': opt.headers = JSON.parse(String(v)); break;
      case 'storage': opt.storage = String(v); break;
      case 'quiet': opt.quiet = true; break;
      case 'no-deep': opt.deep = false; break;
      case 'no-breakpoints': opt.breakpointScan = false; break;
      case 'max-elements': opt.maxElements = Math.max(200, Math.min(30000, Number(v))); break;
      default: break;
    }
  }
  return opt;
}

const opt = parseArgs(process.argv.slice(2));
if (!opt.url) {
  console.error('Usage: node scripts/recon.mjs --url=https://example.com [--out=DIR] [--pages=2] [--no-assets] [--no-mobile]');
  process.exit(2);
}

const log = (...a) => { if (!opt.quiet) process.stderr.write(a.join(' ') + '\n'); };
// browser teardown can reject late handlers; a captured run must still exit 0
process.on('unhandledRejection', (e) => {
  const msg = String(e && e.message ? e.message : e);
  if (!/closed|Target|Session|detached|Protocol/i.test(msg)) process.stderr.write(`[recon] unhandled: ${msg.slice(0, 200)}\n`);
});
const startedAt = Date.now();
const elapsed = () => (Date.now() - startedAt) / 1000;
const overBudget = () => elapsed() > opt.maxSeconds;

const url = opt.url;
const host = (() => { try { return new URL(url).host.replace(/[^\w.-]/g, '_'); } catch { return 'site'; } })();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const outDir = path.resolve(opt.out || path.join('recon', `${host}-${stamp}`));
const shotDir = path.join(outDir, 'screenshots');
for (const d of [outDir, shotDir, path.join(outDir, 'assets'), path.join(outDir, 'css'), path.join(outDir, 'tokens'), path.join(outDir, 'svg'), path.join(outDir, 'dom'), path.join(outDir, 'sections'), path.join(outDir, 'breakpoints')]) {
  mkdirSync(d, { recursive: true });
}
log(`[recon] ${url} -> ${outDir}`);

/* ------------------------------------------------------------- helpers -- */
const PROPS = [
  'transform', 'opacity', 'filter', 'box-shadow', 'border-top-color', 'border-color',
  'background-color', 'background-image', 'color', 'letter-spacing', 'text-decoration-color',
  'text-decoration-line', 'scale', 'translate', 'backdrop-filter', 'clip-path', 'cursor',
  'width', 'height', 'padding-top', 'padding-left', 'border-top-left-radius', 'outline',
  'outline-offset', 'stroke', 'fill', 'stroke-width', 'mix-blend-mode', 'z-index', 'gap',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash('sha1').update(s).digest('hex');

function diffStyles(before, after) {
  if (!before || !after) return null;
  const diff = {};
  for (const k of Object.keys(before)) {
    if (k === 'rect') continue;
    if (typeof before[k] === 'object' || typeof after[k] === 'object') {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) diff[k] = { before: before[k], after: after[k] };
      continue;
    }
    if (before[k] !== after[k]) diff[k] = { before: before[k], after: after[k] };
  }
  return Object.keys(diff).length ? diff : null;
}

async function shot(page, file, selector) {
  try {
    if (selector) {
      const loc = page.locator(selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await sleep(180);
      const box = await loc.boundingBox();
      if (!box) return null;
      const pad = 10;
      const clip = {
        x: Math.max(0, Math.round(box.x - pad)),
        y: Math.max(0, Math.round(box.y - pad)),
        width: Math.min(1200, Math.round(box.width + pad * 2)),
        height: Math.min(800, Math.round(box.height + pad * 2)),
      };
      if (clip.width < 8 || clip.height < 8) return null;
      await page.screenshot({ path: file, clip });
      return path.basename(file);
    }
    await page.screenshot({ path: file });
    return path.basename(file);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ css parse -- */
function extractBlocks(css, atRule) {
  const out = [];
  const re = new RegExp('@' + atRule + '\\s+([^{]*)\\{', 'gi');
  let m;
  while ((m = re.exec(css))) {
    let i = re.lastIndex;
    let depth = 1;
    const start = i;
    while (i < css.length && depth > 0) {
      const ch = css[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    out.push({ prelude: m[1].trim(), body: css.slice(start, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

function parseCssBundle(texts) {
  const keyframes = new Map();
  const fontFaces = [];
  const mediaQueries = new Set();
  const breakpoints = new Set();
  const supports = new Set();
  const rootVars = new Map();
  let bytes = 0;
  let scrollTimeline = 0;
  let reducedMotion = 0;
  let hasSel = 0;
  let propertyAtRule = 0;
  let containerQueries = 0;
  let layers = 0;

  for (const css of texts) {
    bytes += css.length;
    for (const block of extractBlocks(css, '(?:-webkit-)?keyframes')) {
      const name = block.prelude.replace(/["']/g, '');
      if (!keyframes.has(name)) keyframes.set(name, { name, body: block.body.trim().slice(0, 2000) });
    }
    for (const block of extractBlocks(css, 'font-face')) {
      const get = (p) => {
        const m = block.body.match(new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)', 'i'));
        return m ? m[1].trim().replace(/["']/g, '') : null;
      };
      fontFaces.push({
        family: get('font-family'),
        src: (get('src') || '').slice(0, 300),
        weight: get('font-weight'),
        style: get('font-style'),
        display: get('font-display'),
        unicodeRange: get('unicode-range') ? 'yes' : null,
      });
    }
    for (const m of css.matchAll(/@media([^{]+)\{/g)) {
      const q = m[1].trim().replace(/\s+/g, ' ');
      if (!mediaQueries.has(q)) {
        mediaQueries.add(q);
        for (const px of q.matchAll(/(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)/g)) {
          breakpoints.add(`${px[1]}${px[2]}`);
        }
      }
    }
    for (const m of css.matchAll(/@supports([^{]+)\{/g)) supports.add(m[1].trim().slice(0, 120));
    if (/scroll-timeline|animation-timeline\s*:|view-timeline/i.test(css)) scrollTimeline++;
    for (const m of css.matchAll(/prefers-reduced-motion/g)) reducedMotion++;
    for (const m of css.matchAll(/@container/g)) containerQueries++;
    for (const m of css.matchAll(/@layer\s/g)) layers++;
    for (const m of css.matchAll(/@property\s/g)) propertyAtRule++;
    for (const m of css.matchAll(/:has\(/g)) hasSel++;
    for (const m of css.matchAll(/(:root|html)\s*\{([^}]*)\}/g)) {
      for (const decl of m[2].split(';')) {
        const mm = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
        if (mm && !rootVars.has(mm[1])) rootVars.set(mm[1], mm[2].slice(0, 200));
      }
    }
  }
  return {
    keyframes: [...keyframes.values()],
    fontFaces,
    mediaQueries: [...mediaQueries].slice(0, 80),
    breakpoints: [...breakpoints],
    supports: [...supports].slice(0, 40),
    rootVarsDeclared: Object.fromEntries(rootVars),
    stats: {
      bytes,
      scrollTimelineRules: scrollTimeline,
      reducedMotionRules: reducedMotion,
      hasSelectors: hasSel,
      containerQueries,
      layers,
      propertyRules: propertyAtRule,
    },
  };
}

/* --------------------------------------------------------- color utils -- */
function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  }
  m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}
const toHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function paletteFrom(tokens) {
  const merge = (list, kind) => {
    const map = new Map();
    for (const { value, weight } of list || []) {
      const c = parseColor(value);
      if (!c) continue;
      const hex = toHex(c);
      const key = `${hex}@${c.a.toFixed(2)}`;
      const cur = map.get(key) || { hex, weight: 0, alpha: c.a, kinds: new Set() };
      cur.weight += weight;
      cur.kinds.add(kind);
      map.set(key, cur);
    }
    return map;
  };
  const combined = new Map();
  for (const [m, kind] of [[merge(tokens.colors, 'text'), 'text'], [merge(tokens.backgrounds, 'surface'), 'surface'], [merge(tokens.borders, 'border'), 'border']]) {
    for (const [key, v] of m) {
      const cur = combined.get(key) || { hex: v.hex, weight: 0, alpha: v.alpha, kinds: [] };
      cur.weight += v.weight;
      for (const k of v.kinds) if (!cur.kinds.includes(k)) cur.kinds.push(k);
      combined.set(key, cur);
    }
  }
  return [...combined.values()]
    .map((v) => {
      const c = parseColor(v.hex);
      return { ...v, rgb: c, hsl: hsl(c) };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 60);
}

/* ------------------------------------------------------------ network -- */
function makeCollector(page) {
  const net = [];
  const byUrl = new Map();
  const cssTexts = new Map();
  const inflight = { n: 0 };
  const track = (r) => {
    let rec = byUrl.get(r.url());
    if (!rec) {
      rec = { url: r.url(), type: r.resourceType(), method: r.method() };
      byUrl.set(r.url(), rec);
      net.push(rec);
    }
    return rec;
  };
  const safe = (fn) => { try { fn(); } catch {} };
  page.on('request', (r) => safe(() => { inflight.n++; track(r).at = 'request'; }));
  page.on('requestfinished', (r) => safe(() => { inflight.n = Math.max(0, inflight.n - 1); track(r).status = 200; }));
  page.on('requestfailed', (r) => safe(() => {
    inflight.n = Math.max(0, inflight.n - 1);
    const rec = track(r);
    rec.status = 0;
    rec.failure = (r.failure() && r.failure().errorText) || 'failed';
  }));
  page.on('response', (r) => {
    // fire-and-forget: teardown can close the page mid-read, so never reject
    (async () => {
      try {
        const headers = r.headers();
        const mime = (headers['content-type'] || '').split(';')[0].trim();
        const entry = track(r);
        entry.status = r.status();
        entry.mime = mime;
        entry.len = Number(headers['content-length'] || 0) || null;
        if (mime.includes('css') && cssTexts.size < 100) {
          const body = await r.text();
          if (body && body.length < 3_000_000) cssTexts.set(r.url(), body);
        }
      } catch {}
    })();
  });
  return { net, cssTexts, inflight };
}

/* wait until the node count stops changing: hydration and progressive CSS
 * variable injection otherwise make runs disagree with each other */
async function waitForSettledDom(page, { max = 9000, stableMs = 800 } = {}) {
  const start = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - start < max) {
    let n = 0;
    try { n = await page.evaluate(() => document.querySelectorAll('*').length); } catch {}
    if (n !== last) { last = n; lastChange = Date.now(); }
    if (last > 50 && Date.now() - lastChange > stableMs) return last;
    await sleep(250);
  }
  return last;
}

async function quiet(page, inflight, idle = 900, max = 12000) {
  const start = Date.now();
  let last = Date.now();
  let prev = -1;
  while (Date.now() - start < max) {
    if (inflight.n !== prev) { prev = inflight.n; last = Date.now(); }
    if (inflight.n === 0 && Date.now() - last > idle) return true;
    await sleep(150);
  }
  return false;
}

/* -------------------------------------------------------------- phases -- */
async function captureShallow(context, target, dir, label) {
  const page = await context.newPage();
  const result = { url: target, label };
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: opt.timeout });
    await page.waitForTimeout(1800);
    result.meta = await page.evaluate(EX.extractMeta);
    result.tokens = await page.evaluate(EX.extractStyles);
    result.outline = await page.evaluate(EX.extractOutline);
    result.headings = result.outline.headings;
    result.screenshot = await page.screenshot({ path: path.join(dir, `${label}-shot.png`), fullPage: false }).then(() => `${label}-shot.png`).catch(() => null);
  } catch (e) {
    result.error = String(e.message).slice(0, 300);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function downloadAssets(context, net, fileFor, referer) {
  const wanted = net.filter((r) => r.status === 200 && ['image', 'font', 'media', 'stylesheet'].includes(r.type));
  const seen = new Set();
  const manifest = [];
  const failed = [];
  let total = 0;
  const cap = opt.maxAssetsMB * 1024 * 1024;
  const queue = [];
  for (const r of wanted) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    queue.push(r);
  }
  for (let i = 0; i < queue.length; i += 4) {
    if (overBudget() || total > cap) break;
    await Promise.all(queue.slice(i, i + 4).map(async (r) => {
      try {
        const body = await fetchBytes(context, r.url, referer);
        if (!body || body.length < 200 || body.length > 8 * 1024 * 1024) return;
        if (total + body.length > cap) return;
        const { file, rel } = fileFor(r);
        const target = path.join(outDir, rel);
        // 先把 bucket 目录建出来：以前这里没建，写文件一直静默失败
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, body);
        total += body.length;            // 只有真写成功才计入
        manifest.push({ url: r.url, file: rel, type: r.type, mime: r.mime || null, bytes: body.length });
      } catch (e) {
        failed.push({ url: r.url, type: r.type, error: String(e.message).slice(0, 120) });
      }
    }));
  }
  return { manifest, totalBytes: total, failed };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* Cloudflare-fronted sites often reset Playwright's request context but accept a
 * plain fetch with browser-ish headers, so try that first and fall back. */
async function fetchBytes(context, target, referer) {
  try {
    const res = await fetch(target, {
      headers: { 'user-agent': UA, accept: '*/*', ...(referer ? { referer } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    try {
      const resp = await context.request.get(target, { timeout: 20000, headers: referer ? { referer } : undefined });
      if (!resp.ok()) return null;
      return Buffer.from(await resp.body());
    } catch {
      return null;
    }
  }
}

async function main() {
  const { browser, strategy, attempts } = await launchBrowser();
  log(`[recon] browser: ${strategy}`);

  const context = await browser.newContext({
    viewport: { width: opt.width, height: opt.height },
    deviceScaleFactor: opt.dpr,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'no-preference',
    reducedMotion: 'no-preference',
    ignoreHTTPSErrors: true,
    storageState: opt.storage || undefined,
    extraHTTPHeaders: opt.headers || undefined,
  });
  const instrument = readFileSync(path.join(HERE, 'instrument.js'), 'utf8');
  await context.addInitScript({ content: instrument });

  const page = await context.newPage();
  const collector = makeCollector(page);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable').catch(() => {});

  const shots = [];
  const take = async (name, sel) => {
    const f = await shot(page, path.join(shotDir, name), sel);
    if (f) shots.push(f);
    return f;
  };

  const recon = {
    tool: 'frontend-recon',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    requestedUrl: url,
    browser: strategy,
    browserAttempts: attempts,
    viewport: { width: opt.width, height: opt.height, dpr: opt.dpr },
  };

  try {
    log('[recon] navigating...');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opt.timeout });
    } catch (navError) {
      // slow or partially blocked sites: keep whatever did load and say so
      recon.navigationError = String(navError.message).split('\n')[0].slice(0, 300);
      log('[recon] navigation incomplete: ' + recon.navigationError);
      await page.waitForTimeout(4000);
    }
    await quiet(page, collector.inflight, 900, 12000);
    recon.domNodes = await waitForSettledDom(page);
    if (recon.domNodes < 5) {
      // 拿不到真实文档就别假装抓到了：直接停，报告里会写清楚
      throw new Error(`页面没有可用的 DOM（${recon.domNodes} 个节点）${recon.navigationError ? '，导航：' + recon.navigationError : ''}`);
    }
    await page.waitForTimeout(500);

    recon.finalUrl = page.url();
    recon.meta = await page.evaluate(EX.extractMeta);
    recon.libraries = await page.evaluate(EX.librarySnapshot);
    log(`[recon] title: ${recon.meta.title}`);

    if (opt.banners) {
      const dismissed = await page.evaluate(EX.dismissBanner).catch(() => null);
      recon.bannerDismissed = dismissed || null;
      if (dismissed) await page.waitForTimeout(500);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    // --- baseline evidence ------------------------------------------------
    await take('01-hero.png');
    recon.tokens = await page.evaluate(EX.extractStyles);
    recon.outline = await page.evaluate(EX.extractOutline);
    recon.cssText = await page.evaluate(EX.extractCssText);
    recon.animationsBaseline = await page.evaluate(EX.extractAnimations);
    recon.scrollSurfaces = await page.evaluate(EX.scrollSurfaces);
    recon.inlineSvg = await page.evaluate(EX.extractInlineSvg, 30);
    recon.assetUrls = await page.evaluate(EX.collectAssetUrls);
    recon.audio = await page.evaluate(EX.audioSnapshot);
    recon.scanTargets = await page.evaluate(EX.decorateScan, 260);
    recon.interactives = await page.evaluate(EX.extractInteractives, { maxHover: opt.maxHover, maxClick: opt.maxClick });

    // --- 全量结构 / 样式 / 规则 / 图层（deep 模式）-----------------------------
    if (opt.deep) {
      log('[recon] deep snapshot: elements, css rules, layers…');
      const total = await page.evaluate(() => document.querySelectorAll('*').length);
      const nodes = [];
      const STEP = 800;
      const cap = Math.min(total, opt.maxElements);
      for (let i = 0; i < cap; i += STEP) {
        if (overBudget()) break;
        const batch = await page.evaluate(EXD.snapshotElements, { start: i, count: STEP });
        if (batch && batch.nodes) nodes.push(...batch.nodes);
        if (nodes.length >= cap) break;
      }
      writeFileSync(path.join(outDir, 'dom', 'elements.json'), JSON.stringify(nodes));
      recon.deep = { elementCount: total, captured: nodes.length, truncated: total > cap, cssRules: 0, layers: 0 };

      const rules = await page.evaluate(EXD.snapshotCssRules).catch(() => []);
      writeFileSync(path.join(outDir, 'css', 'rules.json'), JSON.stringify(rules));
      recon.deep.cssRules = rules.length;

      const layers = await page.evaluate(EXD.snapshotLayers).catch(() => []);
      writeFileSync(path.join(outDir, 'layers.json'), JSON.stringify(layers, null, 1));
      recon.deep.layers = layers.length;

      // DOM 快照必须在导航前拍，否则可能是空白页
      const html = await page.content();
      writeFileSync(path.join(outDir, 'page.html'), html);
      recon.htmlBytes = Buffer.byteLength(html);
      const textAll = await page.evaluate(() => document.body.innerText).catch(() => '');
      writeFileSync(path.join(outDir, 'text.txt'), textAll);
      recon.deep.textChars = textAll.length;
    }

    // --- scroll walk runs on the pristine first load, BEFORE the lazy-load pass,
    //     so reveal states have not been consumed yet. ------------------------
    log('[recon] scroll + reveal forensics...');
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(400);
    // control sampling at rest: elements that change without scrolling are
    // self-animating and must not be reported as scroll-driven
    const controlA = await page.evaluate(EX.sampleScan);
    await sleep(700);
    const controlB = await page.evaluate(EX.sampleScan);
    const controlVaries = new Set();
    {
      const b = new Map(controlB.map((x) => [x.i, x]));
      for (const a of controlA) {
        const bb = b.get(a.i);
        if (!bb) continue;
        if (a.transform !== bb.transform || a.opacity !== bb.opacity || a.filter !== bb.filter) controlVaries.add(a.i);
      }
    }
    recon.selfAnimatingCount = controlVaries.size;

    // --- scroll walk -------------------------------------------------------
    const steps = opt.scrollSteps || Math.min(12, Math.max(4, Math.ceil(recon.meta.scrollHeight / opt.height)));
    const scrollLog = [];
    const animNamesSeen = new Map();
    for (const a of recon.animationsBaseline) animNamesSeen.set(a.name, 'baseline');
    for (let i = 0; i < steps; i++) {
      const y = Math.round((recon.meta.scrollHeight - opt.height) * (i / Math.max(1, steps - 1)));
      await page.evaluate((yy) => window.scrollTo(0, Math.max(0, yy)), y);
      await sleep(620);
      const anims = await page.evaluate(EX.extractAnimations);
      const scan = await page.evaluate(EX.sampleScan);
      for (const a of anims) if (!animNamesSeen.has(a.name)) animNamesSeen.set(a.name, `scroll@${y}`);
      const f = await shot(page, path.join(shotDir, `10-scroll-${String(i + 1).padStart(2, '0')}.png`));
      if (f) shots.push(f);
      scrollLog.push({ y, anims: anims.map((a) => a.name + '@' + a.target).slice(0, 80), scan });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    recon.animationsOnScroll = [...animNamesSeen.entries()].filter(([, w]) => String(w).startsWith('scroll@')).map(([name, when]) => ({ name, when }));

    // scroll-driven effects from the scan samples
    const scanDelta = [];
    const samples = scrollLog.map((s) => s.scan);
    const byIdx = new Map();
    for (const sample of samples) {
      for (const it of sample) {
        if (!byIdx.has(it.i)) byIdx.set(it.i, []);
        byIdx.get(it.i).push(it);
      }
    }
    for (const [i, list] of byIdx) {
      if (list.length < 3) continue;
      const transforms = new Set(list.map((x) => x.transform));
      const opacities = new Set(list.map((x) => x.opacity));
      const filters = new Set(list.map((x) => x.filter));
      const tops = list.map((x) => x.top);
      const target = recon.scanTargets.find((t) => t.i === i);
      if (!target) continue;
      const moved = transforms.size > 1;
      const faded = opacities.size > 1;
      const filtered = filters.size > 1;
      const pinned = tops.filter((t) => t <= 2).length >= Math.ceil(list.length / 2) && new Set(tops).size <= 2;
      const selfMoving = controlVaries.has(i);
      if (!selfMoving && (moved || faded || filtered || pinned)) {
        scanDelta.push({
          i,
          tag: target.tag,
          classes: target.classes,
          position: target.position,
          moved,
          faded,
          filtered,
          pinned,
          transformSeries: [...transforms].slice(0, 6),
          opacitySeries: [...opacities].slice(0, 6),
          _kind: pinned ? 'sticky-pin' : faded ? 'reveal/enter' : moved ? 'parallax/translate' : 'filter-change',
        });
      }
    }
    recon.scrollDriven = scanDelta.slice(0, 60);

    // instrumentation counters are trustworthy here: the page has been live
    // since the reload and no click has navigated away yet
    const instr = await page.evaluate(() => {
      const r = window.__RECON || {};
      return { listeners: r.listeners || [], observers: r.observers || {}, raf: r.raf || 0, animate: r.animate || [], canvas: r.canvas || 0 };
    }).catch(() => null);
    if (instr) {
      recon.listeners = instr.listeners;
      recon.observers = instr.observers;
      recon.rafFrames = instr.raf;
      recon.animate = instr.animate;
      recon.canvasContexts = instr.canvas;
    }

    // --- lazy-load pass + full page (after the walk, so reveals are already
    //     captured as evidence) ---------------------------------------------
    await page.evaluate(async () => {
      const step = Math.max(200, innerHeight * 0.8);
      const max = Math.min(document.documentElement.scrollHeight, innerHeight * 40);
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 110));
      }
    });
    await sleep(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    const tall = recon.meta.scrollHeight > 14000;
    if (!tall) {
      // full-page capture must not go through the viewport-only helper
      try {
        await page.screenshot({ path: path.join(shotDir, '02-full.png'), fullPage: true, timeout: 45000 });
        shots.push('02-full.png');
      } catch {
        recon.warning = 'full-page screenshot failed (page too tall or still loading)';
      }
    } else {
      recon.warning = 'page taller than 14000px: full-page screenshot skipped, see section shots';
    }
    await take('02b-hero-after-load.png');

    // --- section screenshots + 逐区间深度取证 ------------------------------
    const sections = recon.outline.sections.filter((s) => s.rect.h > 120 && s.rect.w > 200).slice(0, 12);
    const sectionDetails = [];
    let si = 0;
    for (const s of sections) {
      if (overBudget()) break;
      const sel = s.sel || (s.id ? `#${CSS_escape(s.id)}` : null);
      si++;
      if (!sel) continue;
      await page.evaluate((x) => document.querySelector(x)?.scrollIntoView({ block: 'start', behavior: 'instant' }), sel).catch(() => {});
      await sleep(480);
      await take(`03-section-${String(si).padStart(2, '0')}.png`);

      // 整段截图（高度受限，避免几万像素的大图）
      if (s.rect.h > 140 && s.rect.h < 4000) {
        try {
          await page.screenshot({
            path: path.join(shotDir, `03-section-${String(si).padStart(2, '0')}-full.png`),
            fullPage: true,
            clip: { x: 0, y: s.rect.y, width: opt.width, height: Math.min(s.rect.h, 4000) },
            timeout: 20000,
          });
          shots.push(`03-section-${String(si).padStart(2, '0')}-full.png`);
        } catch {}
      }

      if (opt.deep) {
        const detail = await page.evaluate(EXD.snapshotSection, { selector: sel, maxNodes: 500 }).catch(() => null);
        const motion = await page.evaluate(EXD.snapshotMotionAtViewport).catch(() => null);
        if (detail) {
          detail.index = si;
          detail.motionAtEntry = motion;
          sectionDetails.push(detail);
          writeFileSync(path.join(outDir, 'sections', `section-${String(si).padStart(2, '0')}.json`), JSON.stringify(detail, null, 1));
        }
      }
    }
    if (opt.deep) recon.sectionDetails = sectionDetails.map((d) => ({
      index: d.index, selector: d.selector, rect: d.rect,
      nodes: d.nodes.length, textChars: (d.text || '').length,
      animations: d.animations.length, motionAtEntry: d.motionAtEntry ? d.motionAtEntry.count : 0,
    }));
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await sleep(300);

    // --- 断点扫描：趁页面还没被交互污染，逐个断点切视口实测 ----------------
    if (opt.deep && opt.breakpointScan && !overBudget()) {
      log('[recon] breakpoint scan…');
      const bpCss = parseCssBundle([...collector.cssTexts.values(), ...((recon.cssText && recon.cssText.inline) || [])]);
      const widths = [...new Set(
        (bpCss.breakpoints || [])
          .map((b) => Number(String(b).replace(/[^\d.]/g, '')))
          .filter((n) => Number.isFinite(n) && n >= 320 && n <= 2560),
      )].sort((a, b) => a - b).slice(0, 8);

      recon.breakpoints = [];
      for (const w of widths) {
        if (overBudget()) break;
        try {
          await page.setViewportSize({ width: w, height: opt.height });
          await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
          await sleep(650);
          const info = await page.evaluate(() => ({
            scrollHeight: document.documentElement.scrollHeight,
            nodes: document.querySelectorAll('*').length,
            textLen: (document.body.innerText || '').length,
          }));
          if (info.nodes < 50) {
            recon.breakpoints.push({ width: w, error: `页面为空（${info.nodes} 节点）`, ...info });
            continue;
          }
          const name = `60-bp-${w}.png`;
          await page.screenshot({ path: path.join(shotDir, name) }).catch(() => {});
          shots.push(name);
          const tokens = await page.evaluate(EX.extractStyles);
          const rows = await page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('section, header, footer, nav, main, article')) {
              const r = el.getBoundingClientRect();
              if (r.width < 80 || r.height < 40) continue;
              out.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), w: Math.round(r.width) });
            }
            return out.slice(0, 30);
          });
          recon.breakpoints.push({
            width: w,
            ...info,
            columns: { grid: tokens.misc.grid, flex: tokens.misc.flex },
            typeScale: tokens.typeScale.slice(0, 10),
            blocks: rows,
            screenshot: name,
          });
        } catch (e) {
          recon.breakpoints.push({ width: w, error: String(e.message).slice(0, 160) });
        }
      }
      writeFileSync(path.join(outDir, 'breakpoints.json'), JSON.stringify(recon.breakpoints, null, 1));
      await page.setViewportSize({ width: opt.width, height: opt.height }).catch(() => {});
      await sleep(400);
    }

    // --- hover / active forensics... -----------------------------------------
    const docRoot = (await cdp.send('DOM.getDocument', { depth: 2 })).root;
    const nodeFor = async (selector) => {
      try {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector });
        return nodeId || null;
      } catch { return null; }
    };

    const hovers = [];
    for (const cand of recon.interactives.hovers) {
      if (overBudget()) break;
      const nodeId = await nodeFor(cand.selector);
      if (!nodeId) { hovers.push({ ...cand, error: 'node-not-found' }); continue; }
      await page.locator(cand.selector).first().scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
      await sleep(200);
      const before = await page.evaluate(EX.readStyles, { selector: cand.selector, props: PROPS });
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] }).catch(() => {});
      await sleep(430);
      const after = await page.evaluate(EX.readStyles, { selector: cand.selector, props: PROPS });
      const anims = await page.evaluate(EX.getAnimsOn, { selector: cand.selector });
      const img = await take(`20-hover-${String(cand.idx).padStart(2, '0')}.png`, cand.selector);
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] }).catch(() => {});
      await sleep(220);
      const active = await page.evaluate(EX.readStyles, { selector: cand.selector, props: PROPS });
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {});
      await sleep(120);
      hovers.push({
        idx: cand.idx,
        tag: cand.tag,
        text: cand.text,
        classes: cand.classes,
        cursor: cand.cursor,
        transition: cand.transition,
        hoverDiff: diffStyles(before, after),
        activeDiff: diffStyles(after, active) || diffStyles(before, active),
        animations: anims,
        screenshot: img,
        pseudo: { before: (after && after['::before']) || null, after: (after && after['::after']) || null },
      });
    }
    recon.hovers = hovers;

    // focus states for form controls
    const focuses = [];
    for (const f of recon.outline.forms.slice(0, 4)) {
      const el = await page.$('input,textarea,select');
      if (!el) break;
      const b = await page.evaluate(EX.readStyles, { selector: 'input,textarea,select', props: PROPS }).catch(() => null);
      await el.focus().catch(() => {});
      await sleep(250);
      const a = await page.evaluate(EX.readStyles, { selector: 'input,textarea,select', props: PROPS }).catch(() => null);
      focuses.push({ diff: diffStyles(b, a) });
      await el.evaluate((n) => n.blur()).catch(() => {});
      break;
    }
    recon.focuses = focuses;

    // --- click forensics... ---------------------------------------------------
    const clickSnap = () => page.evaluate(() => {
      const rec = window.__RECON || {};
      return {
        audio: (rec.audio || []).length,
        media: (rec.media || []).length,
        waapi: (rec.animate || []).length,
        anims: document.getAnimations().map((a) => `${a.animationName || a.transitionProperty || 'waapi'}@${a.effect?.target?.tagName || ''}`),
        nodes: document.querySelectorAll('*').length,
        dialogs: document.querySelectorAll('dialog,[role=dialog],[role=menu],[aria-expanded=true]').length,
        url: location.href,
      };
    });

    const clicks = [];
    let clickQueue = recon.interactives.clicks.filter((c) => !c.navigates && !c.disabled).slice(0, opt.maxClick);
    const sigOf = (c) => `${c.tag}|${c.text}`;
    for (let ci = 0; ci < clickQueue.length; ci++) {
      if (overBudget()) break;
      let cand = clickQueue[ci];
      // an earlier click may have navigated away, which drops every data-fr-idx
      if (!(await page.$(cand.selector))) {
        const fresh = await page.evaluate(EX.extractInteractives, { maxHover: opt.maxHover, maxClick: opt.maxClick }).catch(() => null);
        if (fresh) {
          const bySig = new Map(fresh.clicks.map((c) => [sigOf(c), c]));
          clickQueue = clickQueue.map((c, j) => (j < ci ? c : bySig.get(sigOf(c)) || c));
          cand = clickQueue[ci];
        }
      }
      const pre = await clickSnap();
      let clicked = false;
      let clickMode = 'pointer';
      try {
        await page.locator(cand.selector).first().click({ timeout: 3000 });
        clicked = true;
      } catch {
        try {
          // elements that never stop animating are "unstable" for a real pointer
          await page.locator(cand.selector).first().click({ timeout: 2000, force: true });
          clicked = true;
          clickMode = 'force';
        } catch {
          try {
            await page.locator(cand.selector).first().dispatchEvent('click');
            clicked = true;
            clickMode = 'dispatchEvent';
          } catch (e2) {
            clicks.push({ idx: cand.idx, tag: cand.tag, text: cand.text, clicked: false, error: String(e2.message).slice(0, 120) });
            continue;
          }
        }
      }
      await sleep(700);
      const post = await clickSnap();
      const img = await take(`30-click-${String(cand.idx).padStart(2, '0')}.png`);
      const navigated = post.url !== pre.url;
      clicks.push({
        idx: cand.idx,
        tag: cand.tag,
        text: cand.text,
        clicked,
        clickMode,
        navigated,
        newAnimations: post.anims.filter((x) => !pre.anims.includes(x)).slice(0, 12),
        audioTriggered: post.audio > pre.audio,
        mediaTriggered: post.media > pre.media,
        waapiCalls: Math.max(0, post.waapi - pre.waapi),
        nodeDelta: post.nodes - pre.nodes,
        dialogOpened: post.dialogs > pre.dialogs,
        screenshot: img,
      });
      if (navigated) {
        recon.clickNavigated = post.url;
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await sleep(1200);
        const newRoot = (await cdp.send('DOM.getDocument', { depth: 2 })).root;
        docRoot.nodeId = newRoot.nodeId;
      } else if (post.dialogs > pre.dialogs) {
        // close overlays so the next click is not blocked
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(300);
      }
    }
    recon.clicks = clicks;

    // --- final state ------------------------------------------------------
    recon.animationsFinal = await page.evaluate(EX.extractAnimations);
    recon.audioFinal = await page.evaluate(EX.audioSnapshot);
    recon.listeners = recon.listeners || (await page.evaluate(() => (window.__RECON || {}).listeners || []));
    recon.animate = recon.animate || (await page.evaluate(() => (window.__RECON || {}).animate || []));
    recon.observers = recon.observers || (await page.evaluate(() => (window.__RECON || {}).observers || {}));
    recon.rafFrames = recon.rafFrames ?? (await page.evaluate(() => (window.__RECON || {}).raf || 0));
    recon.canvasContexts = await page.evaluate(() => (window.__RECON || {}).canvas || 0);
    recon.runtimeErrors = await page.evaluate(() => (window.__RECON || {}).errors || []);

    // 这里的导航可能已经不是原始文档，DOM 快照在 deep 阶段拍过了
    if (opt.saveHtml && !opt.deep) {
      const html = await page.content();
      writeFileSync(path.join(outDir, 'page.html'), html);
      recon.htmlBytes = Buffer.byteLength(html);
    }

    // --- mobile pass... -------------------------------------------------------
    if (opt.mobile && !overBudget()) {
      log('[recon] mobile pass...');
      const mctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        locale: 'zh-CN',
        ignoreHTTPSErrors: true,
        storageState: opt.storage || undefined,
      });
      const mp = await mctx.newPage();
      try {
        await mp.goto(url, { waitUntil: 'domcontentloaded', timeout: opt.timeout });
        await mp.waitForTimeout(2200);
        await mp.screenshot({ path: path.join(shotDir, '40-mobile-hero.png') });
        shots.push('40-mobile-hero.png');
        const mh = await mp.evaluate(() => document.documentElement.scrollHeight);
        if (mh < 14000) {
          await mp.screenshot({ path: path.join(shotDir, '41-mobile-full.png'), fullPage: true });
          shots.push('41-mobile-full.png');
        }
        recon.mobile = {
          scrollHeight: mh,
          tokens: await mp.evaluate(EX.extractStyles),
          meta: await mp.evaluate(EX.extractMeta),
        };
      } catch (e) {
        recon.mobile = { error: String(e.message).slice(0, 200) };
      }
      await mctx.close().catch(() => {});
    }

    // --- extra pages -------------------------------------------------------
    if (opt.pages > 1) {
      const links = recon.outline.links
        .filter((l) => !/[#?]/.test(l.href) || true)
        .filter((l) => { try { return new URL(l.href).pathname !== new URL(recon.finalUrl).pathname; } catch { return false; } })
        .slice(0, opt.pages - 1);
      recon.pages = [];
      for (const [i, l] of links.entries()) {
        if (overBudget()) break;
        log(`[recon] extra page ${i + 1}: ${l.href}`);
        recon.pages.push(await captureShallow(context, l.href, shotDir, `50-page-${String(i + 1).padStart(2, '0')}`));
      }
    }
  } catch (e) {
    recon.fatal = String(e.stack || e.message).slice(0, 2000);
    log('[recon] fatal: ' + e.message);
  }

  // a failed or partial capture must still render into a readable report
  recon.tokens ||= { colors: [], backgrounds: [], borders: [], gradients: [], fonts: [], typeScale: [], spacing: [], radius: [], shadows: [], easings: [], durations: [], zIndex: [], cssVars: {}, misc: {} };
  recon.outline ||= { sections: [], headings: [], headingsOutline: [], links: [], landmarks: {}, forms: [], textSample: '' };
  recon.libraries ||= { globals: {}, scriptHints: [], framework: 'unknown' };
  recon.cssText ||= { inline: [], sheets: [], blocked: 0, adopted: 0 };
  recon.meta ||= { title: null, counts: {} };
  recon.audioFinal ||= { audioApi: [], playCalls: [], media: [], libraries: {} };
  recon.hovers ||= [];
  recon.clicks ||= [];
  recon.scrollDriven ||= [];
  recon.listeners ||= [];
  recon.animationsBaseline ||= [];
  recon.animationsFinal ||= [];

  // --- assets -------------------------------------------------------------
  let assetResult = { manifest: [], totalBytes: 0, failed: [] };
  if (opt.assets) {
    log('[recon] downloading assets...');
    const buckets = { image: 'images', font: 'fonts', media: 'media', stylesheet: 'css' };
    const extFor = (r) => {
      const byMime = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
        'image/gif': 'gif', 'image/x-icon': 'ico', 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf',
        'font/otf': 'otf', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
        'video/mp4': 'mp4', 'video/webm': 'webm', 'text/css': 'css',
      };
      if (byMime[r.mime]) return byMime[r.mime];
      const m = (r.url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1];
      return (m || 'bin').toLowerCase();
    };
    assetResult = await downloadAssets(context, collector.net, (r) => {
      const bucket = buckets[r.type] || 'misc';
      const ext = extFor(r);
      const file = `${sha(r.url).slice(0, 10)}.${ext}`;
      return { file, rel: path.join('assets', bucket, file) };
    }, recon.finalUrl || url);
    mkdirSync(path.join(outDir, 'assets', 'misc'), { recursive: true });
  }

  // --- inline SVG ---------------------------------------------------------
  const svgFiles = [];
  for (const [i, s] of (recon.inlineSvg || []).entries()) {
    const file = `svg-${String(i + 1).padStart(2, '0')}.svg`;
    writeFileSync(path.join(outDir, 'svg', file), s.html);
    svgFiles.push({ file: path.join('svg', file), w: s.w, h: s.h, viewBox: s.viewBox });
  }

  // --- CSS + derived ------------------------------------------------------
  const cssTexts = [...collector.cssTexts.values(), ...(recon.cssText.inline || [])];
  const css = parseCssBundle(cssTexts);
  writeFileSync(path.join(outDir, 'css', 'bundle.css'), cssTexts.join('\n\n/* ---- */\n\n'));
  writeFileSync(path.join(outDir, 'css', 'keyframes.json'), JSON.stringify(css.keyframes, null, 2));

  const palette = paletteFrom(recon.tokens);
  const motions = buildMotionInventory(recon, css);
  const sounds = buildSoundInventory(recon, collector.net);
  const assets = [...assetResult.manifest, ...svgFiles.map((f) => ({ ...f, type: 'svg-inline', url: null, bytes: null }))];

  const byType = {};
  for (const r of collector.net) byType[r.type || 'other'] = (byType[r.type || 'other'] || 0) + 1;
  const thirdParty = [...new Set(collector.net.map((r) => { try { return new URL(r.url).host; } catch { return null; } }).filter((h) => h && h !== new URL(recon.finalUrl || url).host))];

  recon.css = {
    stats: css.stats,
    keyframes: css.keyframes,
    fontFaces: css.fontFaces,
    mediaQueries: css.mediaQueries,
    breakpoints: css.breakpoints,
    supports: css.supports,
    rootVarsDeclared: css.rootVarsDeclared,
  };
  recon.palette = palette;
  recon.motion = motions;
  recon.sound = sounds;
  recon.assets = { totalBytes: assetResult.totalBytes, count: assets.length, files: assets, failed: (assetResult.failed || []).slice(0, 20) };
  recon.network = {
    total: collector.net.length,
    byType,
    failed: collector.net.filter((r) => r.status === 0).slice(0, 30).map((r) => r.url),
    thirdPartyHosts: thirdParty.slice(0, 30),
    requests: collector.net.slice(0, 600).map((r) => ({ url: r.url, type: r.type, status: r.status, mime: r.mime || null })),
  };
  recon.errors = { page: pageErrors.slice(0, 40), console: consoleErrors.slice(0, 40), runtime: recon.runtimeErrors || [] };
  recon.screenshots = shots;
  recon.timings = { seconds: Math.round(elapsed()), strategy };

  // strip bulky raw CSS from the JSON (kept in css/bundle.css)
  recon.cssRawSizes = { sheets: recon.cssText.sheets.length, inline: recon.cssText.inline.length, blocked: recon.cssText.blocked };
  delete recon.cssText;
  delete recon.inlineSvg;
  delete recon.assetUrls;

  writeFileSync(path.join(outDir, 'recon.json'), JSON.stringify(recon, null, 2));

  const summary = {
    outDir,
    finalUrl: recon.finalUrl,
    title: recon.meta && recon.meta.title,
    seconds: recon.timings.seconds,
    fatal: recon.fatal || null,
    counts: {
      screenshots: shots.length,
      keyframes: css.keyframes.length,
      cssVars: Object.keys(recon.tokens.cssVars || {}).length,
      animationsBaseline: (recon.animationsBaseline || []).length,
      animationsFinal: (recon.animationsFinal || []).length,
      listeners: (recon.listeners || []).length,
      hovers: (recon.hovers || []).length,
      clicks: (recon.clicks || []).length,
      scrollDriven: (recon.scrollDriven || []).length,
      palette: palette.length,
      fonts: (recon.tokens.fonts || []).length,
      assets: assets.length,
      assetsMB: +(assetResult.totalBytes / 1048576).toFixed(1),
      audioEvents: (recon.sound && recon.sound.totalEvents) || 0,
      deepElements: (recon.deep && recon.deep.captured) || 0,
      cssRules: (recon.deep && recon.deep.cssRules) || 0,
      layers: (recon.deep && recon.deep.layers) || 0,
      sections: (recon.sectionDetails || []).length,
      breakpoints: (recon.breakpoints || []).length,
    },
    artifacts: {
      elements: 'dom/elements.json',
      cssRules: 'css/rules.json',
      layers: 'layers.json',
      sections: 'sections/',
      breakpoints: 'breakpoints.json',
      text: 'text.txt',
      html: 'page.html',
    },
    libraries: Object.keys(recon.libraries.globals || {}),
    next: 'node scripts/render.mjs --recon=' + path.join(outDir, 'recon.json'),
  };
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

function CSS_escape(s) {
  return String(s).replace(/([^\w-])/g, '\\$1');
}

function buildMotionInventory(recon, css) {
  const defs = new Map(css.keyframes.map((k) => [k.name, k.body]));
  const map = new Map();
  const add = (a, when) => {
    const isTransition = /Transition/i.test(String(a.type || ''));
    const key = isTransition ? 'transition:' + a.name : a.name;
    if (!key) return;
    const cur = map.get(key) || {
      name: key,
      source: isTransition ? 'css-transition' : defs.has(key) ? 'css-keyframes' : 'waapi/js',
      duration: a.duration ?? null,
      easing: a.easing ?? null,
      iterations: a.iterations ?? null,
      targets: [],
      when: [],
      keyframes: a.keyframes || null,
      cssBody: defs.get(key) || null,
      count: 0,
    };
    cur.count++;
    if (a.target && !cur.targets.includes(a.target) && cur.targets.length < 6) cur.targets.push(a.target);
    if (!cur.when.includes(when)) cur.when.push(when);
    if (!cur.duration && a.duration) cur.duration = a.duration;
    map.set(key, cur);
  };
  for (const a of recon.animationsBaseline || []) add(a, 'load');
  for (const a of recon.animationsOnScroll || []) {
    if (!map.has(a.name)) add({ name: a.name, type: 'CSSAnimation' }, 'scroll');
  }
  for (const h of recon.hovers || []) for (const a of h.animations || []) add({ ...a, target: h.tag }, 'hover');
  for (const c of recon.clicks || []) for (const n of c.newAnimations || []) {
    const [name] = String(n).split('@');
    add({ name, type: 'unknown', target: c.tag }, 'click');
  }
  for (const a of recon.animationsFinal || []) add(a, 'final');
  for (const s of recon.scrollDriven || []) {
    const name = `scroll:${s._kind}`;
    const cur = map.get(name) || { name, source: 'scroll-observed', duration: null, easing: null, iterations: null, targets: [], when: ['scroll'], keyframes: null, cssBody: null, count: 0 };
    cur.count++;
    const target = (s.tag || '') + ((s.classes || []).length ? '.' + s.classes.join('.') : '');
    if (!cur.targets.includes(target)) cur.targets.push(target);
    map.set(name, cur);
  }
  // WAAPI calls captured by instrumentation
  const waapi = [];
  for (const a of recon.animate || []) waapi.push(a);

  return {
    byName: [...map.values()].sort((a, b) => b.count - a.count),
    keyframeCount: css.keyframes.length,
    unusedKeyframes: css.keyframes.map((k) => k.name).filter((n) => !map.has(n)).slice(0, 40),
    easings: recon.tokens.easings,
    durations: recon.tokens.durations,
    stats: recon.tokens.misc,
    rafFrames: recon.rafFrames,
  };
}

function buildSoundInventory(recon, net) {
  const audioReqs = net
    .filter((r) => r.status === 200 && (/\.(mp3|wav|ogg|oga|m4a|aac|flac)(\?|$)/i.test(r.url) || r.type === 'media'))
    .map((r) => r.url);
  const ctx = recon.audioFinal && recon.audioFinal.audioApi ? recon.audioFinal.audioApi : [];
  const kinds = {};
  for (const e of ctx) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  const playCalls = (recon.audioFinal && recon.audioFinal.playCalls) || [];
  const triggered = (recon.clicks || []).filter((c) => c.audioTriggered || c.mediaTriggered);
  const libs = (recon.audioFinal && recon.audioFinal.libraries) || {};
  return {
    totalEvents: ctx.length + playCalls.length,
    audioApiKinds: kinds,
    contexts: ctx.filter((e) => e.kind === 'AudioContext'),
    mediaElements: (recon.audioFinal && recon.audioFinal.media) || [],
    playCalls: playCalls.slice(0, 20),
    networkAudio: [...new Set(audioReqs)].slice(0, 40),
    triggeredByInteraction: triggered.map((c) => ({ tag: c.tag, text: c.text, audio: c.audioTriggered, media: c.mediaTriggered })),
    libraries: libs,
    verdict:
      ctx.length + playCalls.length + audioReqs.length > 0
        ? 'audio present'
        : 'no audio detected',
  };
}

main().catch(async (e) => {
  console.error(JSON.stringify({ fatal: String(e.stack || e.message) }, null, 2));
  process.exit(1);
});
