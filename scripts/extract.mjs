/*
 * Page-side extractors.
 *
 * Every exported function runs inside the page via page.evaluate(), so each one
 * must be self-contained: no imports, no references to module scope, and a
 * JSON-serializable result.
 */

/* NOTE: no module-scope helpers. Playwright serializes these functions by
 * source, so every referenced binding must live inside the function body. */

export function extractMeta() {
  if (!document.documentElement) {
    return { url: location.href, title: document.title || null, empty: true, counts: {} };
  }
  const meta = (n) => {
    const el = document.querySelector(`meta[name="${n}"],meta[property="${n}"]`);
    return el ? el.getAttribute('content') : null;
  };
  const link = (rel) => {
    const el = document.querySelector(`link[rel="${rel}"]`);
    return el ? el.href : null;
  };
  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || null,
    description: meta('description') || meta('og:description') || null,
    themeColor: meta('theme-color'),
    generator: meta('generator'),
    viewport: meta('viewport'),
    ogImage: meta('og:image'),
    canonical: link('canonical'),
    manifest: link('manifest'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    scrollHeight: document.documentElement.scrollHeight,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    counts: {
      elements: document.querySelectorAll('*').length,
      images: document.querySelectorAll('img').length,
      svg: document.querySelectorAll('svg').length,
      video: document.querySelectorAll('video').length,
      canvas: document.querySelectorAll('canvas').length,
      iframe: document.querySelectorAll('iframe').length,
      shadowRoots: (() => {
        let n = 0;
        const walk = (r) => {
          for (const el of r.querySelectorAll('*')) if (el.shadowRoot) { n++; walk(el.shadowRoot); }
        };
        walk(document);
        return n;
      })(),
    },
  };
}

export function extractStyles() {
  const MAX = 4000;
  const els = [];
  const walk = (root, out) => {
    for (const el of root.querySelectorAll('*')) {
      if (out.length >= MAX) return;
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, out);
    }
  };
  walk(document, els);
  const colorCount = new Map();
  const bgCount = new Map();
  const borderCount = new Map();
  const gradCount = new Map();
  const typeCount = new Map();
  const spaceCount = new Map();
  const radiusCount = new Map();
  const shadowCount = new Map();
  const easeCount = new Map();
  const durCount = new Map();
  const zCount = new Map();
  const fontCount = new Map();
  const misc = {
    backdropFilter: 0, mixBlend: 0, textShadow: 0, customCursor: 0, cursorNone: 0,
    transitioned: 0, animated: 0, willChange: 0, filters: 0, sticky: 0, fixed: 0,
    grid: 0, flex: 0, containerQueries: 0, clamp: 0, subgrid: 0, darkMode: 0,
    reducedMotionMentions: 0, stickyCount: 0,
  };
  const bump = (map, key, weight) => {
    if (!key) return;
    const cur = map.get(key) || 0;
    map.set(key, cur + weight);
  };
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  // comma-splitting that respects cubic-bezier(...) and other function args
  const splitTop = (s) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(s || '')) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  let visible = 0;
  for (const el of els) {
    let cs;
    try { cs = getComputedStyle(el); } catch { continue; }
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area <= 0 || num(cs.opacity, 1) <= 0.01) continue;
    visible++;
    const tag = el.tagName;

    // direct text length (avoids double counting nested nodes)
    let textLen = 0;
    if (tag !== 'SCRIPT' && tag !== 'STYLE') {
      for (const n of el.childNodes) if (n.nodeType === 3) textLen += n.nodeValue.trim().length;
    }

    if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') bump(colorCount, cs.color, textLen + 1);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') bump(bgCount, cs.backgroundColor, Math.max(1, Math.round(area / 400)));
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const c = cs['border' + side + 'Color'];
      const w = num(cs['border' + side + 'Width'], 0);
      if (c && w > 0 && c !== 'rgba(0, 0, 0, 0)') bump(borderCount, c, 1);
    }
    const bgi = cs.backgroundImage;
    if (bgi && bgi.includes('gradient')) bump(gradCount, bgi.replace(/\s+/g, ' ').slice(0, 300), Math.max(1, Math.round(area / 900)));

    if (textLen > 0) {
      const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      bump(fontCount, fam, textLen);
      const key = [fam, cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing].join(' | ');
      bump(typeCount, key, textLen);
    }
    if (cs.textShadow && cs.textShadow !== 'none') misc.textShadow++;

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) bump(spaceCount, 'padding-' + side + ':' + cs['padding' + side], 1);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const v = cs['margin' + side];
      if (v !== '0px') bump(spaceCount, 'margin-' + side + ':' + v, 1);
    }
    if (cs.rowGap && cs.rowGap !== 'normal' && cs.rowGap !== '0px') bump(spaceCount, 'gap:' + cs.rowGap, 1);
    if (cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') bump(spaceCount, 'gap:' + cs.columnGap, 1);

    if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== '0px') bump(radiusCount, cs.borderTopLeftRadius, 1);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(shadowCount, cs.boxShadow.replace(/\s+/g, ' ').slice(0, 240), 1);

    const tt = splitTop(cs.transitionTimingFunction).filter((s) => s && s !== 'ease');
    for (const e of tt) bump(easeCount, e, 1);
    const at = splitTop(cs.animationTimingFunction).filter((s) => s && s !== 'ease');
    for (const e of at) bump(easeCount, e, 1);
    for (const d of splitTop(cs.transitionDuration)) {
      const v = d.trim();
      if (v && v !== '0s' && v !== '0ms') bump(durCount, v, 1);
    }
    for (const d of splitTop(cs.animationDuration)) {
      const v = d.trim();
      if (v && v !== '0s' && v !== '0ms') bump(durCount, v, 1);
    }
    if (cs.transitionDuration && cs.transitionDuration !== '0s') misc.transitioned++;
    if (cs.animationName && cs.animationName !== 'none') misc.animated++;
    if (cs.willChange && cs.willChange !== 'auto') misc.willChange++;
    if (cs.backdropFilter && cs.backdropFilter !== 'none') misc.backdropFilter++;
    if (cs.filter && cs.filter !== 'none') misc.filters++;
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') misc.mixBlend++;
    if (cs.zIndex && cs.zIndex !== 'auto' && cs.zIndex !== '0') bump(zCount, cs.zIndex, 1);
    if (typeof cs.cursor === 'string') {
      if (cs.cursor.includes('url(')) misc.customCursor++;
      else if (cs.cursor === 'none') misc.cursorNone++;
    }
    if (cs.display === 'grid' || cs.display === 'inline-grid') misc.grid++;
    if (cs.display === 'flex' || cs.display === 'inline-flex') misc.flex++;
    if (cs.containerType && cs.containerType !== 'normal') misc.containerQueries++;
    if (cs.gridTemplateColumns && cs.gridTemplateColumns.includes('subgrid')) misc.subgrid++;
    if (tag === 'SECTION' && /max\(|clamp\(/.test(cs.width)) misc.clamp++;

    // position strategy
    const pos = cs.position;
    if (pos === 'sticky') { misc.sticky++; misc.stickyCount++; }
    if (pos === 'fixed') misc.fixed++;
  }

  const cssVars = {};
  const rootCs = getComputedStyle(document.documentElement);
  for (const name of Array.from(rootCs)) {
    if (name.startsWith('--')) cssVars[name] = rootCs.getPropertyValue(name).trim();
  }

  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, weight]) => ({ value, weight }));

  return {
    visibleElements: visible,
    colors: top(colorCount, 40),
    backgrounds: top(bgCount, 30),
    borders: top(borderCount, 20),
    gradients: top(gradCount, 20),
    fonts: top(fontCount, 12),
    typeScale: top(typeCount, 40),
    spacing: top(spaceCount, 60),
    radius: top(radiusCount, 20),
    shadows: top(shadowCount, 20),
    easings: top(easeCount, 20),
    durations: top(durCount, 20),
    zIndex: top(zCount, 20),
    cssVars,
    misc,
  };
}

export function extractOutline() {
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  let secIdx = 0;
  const describe = (el) => {
    const i = secIdx++;
    try { el.setAttribute('data-fr-sec', String(i)); } catch {}
    return {
      sel: `[data-fr-sec="${i}"]`,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 6) : [],
      role: el.getAttribute('role'),
      rect: rectOf(el),
      bg: getComputedStyle(el).backgroundColor,
      heading: (() => {
        const h = el.querySelector('h1,h2,h3');
        return h ? (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) : null;
      })(),
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200) || null,
      children: el.children.length,
    };
  };

  const sections = [];
  const cand = [...document.querySelectorAll('main > *, #root > *, #app > *, [data-section], body > *, section, header, footer, nav, article, aside')];
  const prio = (el) => {
    const p = el.parentElement;
    if (p && (p.tagName === 'MAIN' || p.id === 'root' || p.id === 'app' || p.getAttribute('role') === 'main')) return 1;
    if (p && p.tagName === 'BODY') return 2;
    return 3;
  };
  cand.sort((a, b) => prio(a) - prio(b));
  const kept = [];
  for (const el of cand) {
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 40) continue;
    if (kept.some((k) => k === el || k.contains(el))) continue;
    if (kept.filter((k) => el.contains(k)).length >= 2) continue;
    kept.push(el);
    if (el.children.length > 1 && r.height > innerHeight * 6) {
      // oversized wrapper: keep it but also let its children be considered
      kept.pop();
      continue;
    }
    if (kept.length >= 24) break;
  }
  for (const el of kept) sections.push(describe(el));

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 120).map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160),
    style: {
      size: getComputedStyle(h).fontSize,
      weight: getComputedStyle(h).fontWeight,
      family: getComputedStyle(h).fontFamily.split(',')[0].replace(/["']/g, ''),
      lineHeight: getComputedStyle(h).lineHeight,
      letterSpacing: getComputedStyle(h).letterSpacing,
      color: getComputedStyle(h).color,
    },
  }));

  const origin = location.origin;
  const linkMap = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!href || !href.startsWith('http')) continue;
    const u = new URL(href);
    if (u.origin !== origin) continue;
    if (!linkMap.has(u.pathname + u.search)) {
      linkMap.set(u.pathname + u.search, { href: u.href, text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
    }
  }

  return {
    sections: sections.slice(0, 40),
    headings,
    headingsOutline: headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}H${h.level} ${h.text}`),
    links: [...linkMap.values()].slice(0, 200),
    landmarks: {
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      footer: document.querySelectorAll('footer').length,
      dialog: document.querySelectorAll('dialog,[role=dialog]').length,
    },
    textSample: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 4000),
    forms: [...document.querySelectorAll('input,textarea,select')].slice(0, 20).map((f) => ({
      tag: f.tagName.toLowerCase(),
      type: f.type || null,
      placeholder: f.placeholder || null,
      label: (f.getAttribute('aria-label') || '').slice(0, 60) || null,
      style: { height: getComputedStyle(f).height, radius: getComputedStyle(f).borderRadius, border: getComputedStyle(f).border },
    })),
  };
}

export function extractAnimations() {
  const list = [];
  let anims = [];
  try { anims = document.getAnimations(); } catch { anims = []; }
  for (const a of anims) {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    const target = a.effect && a.effect.target;
    let keyframes = null;
    try {
      const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : null;
      if (kf && kf.length) keyframes = kf.slice(0, 6);
    } catch {}
    list.push({
      type: a.constructor && a.constructor.name,
      name: a.animationName || a.transitionProperty || (keyframes ? 'waapi' : 'unknown'),
      duration: t.duration ?? null,
      easing: t.easing ?? null,
      delay: t.delay ?? null,
      iterations: t.iterations ?? null,
      direction: t.direction ?? null,
      fill: t.fill ?? null,
      playState: a.playState,
      target: target
        ? target.tagName.toLowerCase() +
          (target.id ? '#' + target.id : '') +
          (typeof target.className === 'string' && target.className ? '.' + target.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
        : null,
      keyframes,
    });
  }
  return list.slice(0, 600);
}

export function extractInteractives(arg) {
  const { maxHover = 8, maxClick = 8 } = arg || {};
  const sel = 'a[href], button, [role=button], [role=link], input, textarea, select, summary, [onclick], [class*=btn], [class*=button], [class*=card], [class*=tab], [class*=toggle], [class*=menu]';
  const all = [...document.querySelectorAll(sel)];
  const seen = new Set();
  const scored = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const cls = typeof el.className === 'string' ? el.className : '';
    const sig = el.tagName + '|' + cls.split(/\s+/).slice(0, 2).join('.') + '|' + text.slice(0, 12);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const trans = cs.transitionDuration + ' ' + cs.transitionProperty;
    let score = 0;
    if (cs.cursor === 'pointer') score += 3;
    if (trans && !/^0s|^0ms/.test(cs.transitionDuration)) score += 4;
    if (el.tagName === 'BUTTON') score += 3;
    if (el.tagName === 'A') score += 1;
    if (/btn|button|card|cta|primary/i.test(cls)) score += 2;
    if (el.hasAttribute('onclick')) score += 2;
    if (r.top < innerHeight * 1.5 && r.top > -innerHeight) score += 2;
    scored.push({ el, score, text, cls, r });
  }
  scored.sort((a, b) => b.score - a.score);

  // keep the sample spread across the page instead of clustering in the nav
  const chosen = [];
  const bands = new Map();
  for (const c of scored) {
    if (chosen.length >= maxHover) break;
    const band = Math.floor((c.r.top + scrollY) / 400);
    const used = bands.get(band) || 0;
    if (used >= 2 && scored.length > maxHover * 2) continue;
    bands.set(band, used + 1);
    chosen.push(c);
  }

  const hovers = [];
  const clicks = [];
  let idx = 0;
  for (const c of chosen) {
    c.el.setAttribute('data-fr-idx', String(idx));
    hovers.push({
      idx,
      selector: `[data-fr-idx="${idx}"]`,
      tag: c.el.tagName.toLowerCase(),
      text: c.text,
      classes: c.cls.split(/\s+/).filter(Boolean).slice(0, 4),
      rect: { x: Math.round(c.r.x), y: Math.round(c.r.y), w: Math.round(c.r.width), h: Math.round(c.r.height) },
      cursor: getComputedStyle(c.el).cursor,
      transition: getComputedStyle(c.el).transition,
      score: c.score,
    });
    idx++;
  }
  // click candidates: same set, but prefer real controls
  for (const h of hovers) {
    const el = document.querySelector(h.selector);
    if (!el) continue;
    const tag = el.tagName;
    const href = tag === 'A' ? el.getAttribute('href') || '' : '';
    const navigates = tag === 'A' && href && !href.startsWith('#') && !href.startsWith('javascript');
    clicks.push({ ...h, navigates, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' });
    if (clicks.length >= maxClick) break;
  }
  return { hovers, clicks };
}

export function decorateScan(limit) {
  const els = [];
  const walk = (root, out) => {
    for (const el of root.querySelectorAll('*')) {
      if (out.length >= 3000) return;
      out.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, out);
    }
  };
  walk(document, els);
  const picked = [];
  const keyword = /reveal|fade|slide|float|parallax|sticky|animate|motion|hero|marquee|ticker|scroll/i;
  for (const el of els) {
    if (picked.length >= limit) break;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) continue;
    const cls = typeof el.className === 'string' ? el.className : '';
    const hot =
      (cs.transform && cs.transform !== 'none') ||
      (cs.translate && cs.translate !== 'none') ||
      (cs.rotate && cs.rotate !== 'none') ||
      (cs.animationName && cs.animationName !== 'none') ||
      (cs.transitionDuration && cs.transitionDuration !== '0s') ||
      (cs.position === 'sticky' || cs.position === 'fixed') ||
      (cs.willChange && cs.willChange !== 'auto') ||
      (cs.filter && cs.filter !== 'none') ||
      keyword.test(cls) ||
      Number(cs.opacity) < 1;
    if (!hot) continue;
    el.setAttribute('data-fr-scan', String(picked.length));
    picked.push({
      i: picked.length,
      tag: el.tagName.toLowerCase(),
      classes: cls.split(/\s+/).filter(Boolean).slice(0, 3),
      position: cs.position,
      selfAnimating: (cs.animationName && cs.animationName !== 'none') || false,
      transition: cs.transition || null,
      initial: { transform: cs.transform, opacity: cs.opacity, filter: cs.filter },
    });
  }
  return picked;
}

export function sampleScan() {
  const out = [];
  for (const el of document.querySelectorAll('[data-fr-scan]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      i: Number(el.getAttribute('data-fr-scan')),
      transform: cs.transform,
      translate: cs.translate,
      scale: cs.scale,
      rotate: cs.rotate,
      opacity: cs.opacity,
      filter: cs.filter,
      top: Math.round(r.top),
      y: Math.round(scrollY),
    });
  }
  return out;
}

export function readStyles(arg) {
  const { selector, props } = arg;
  const el = document.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = { rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() };
  for (const p of props) out[p] = cs.getPropertyValue(p);
  for (const pe of ['::before', '::after']) {
    let pcs;
    try { pcs = getComputedStyle(el, pe); } catch { continue; }
    const content = pcs.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;
    out[pe] = {
      content,
      width: pcs.getPropertyValue('width'),
      height: pcs.getPropertyValue('height'),
      opacity: pcs.getPropertyValue('opacity'),
      transform: pcs.getPropertyValue('transform'),
      background: pcs.getPropertyValue('background-image') + ' ' + pcs.getPropertyValue('background-color'),
      radius: pcs.getPropertyValue('border-radius'),
      boxShadow: pcs.getPropertyValue('box-shadow'),
      color: pcs.getPropertyValue('color'),
      transition: pcs.getPropertyValue('transition'),
    };
  }
  return out;
}

export function getAnimsOn(arg) {
  const el = document.querySelector(arg.selector);
  if (!el) return [];
  let anims = [];
  try { anims = el.getAnimations({ subtree: false }); } catch { anims = []; }
  return anims.map((a) => {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    return {
      name: a.animationName || a.transitionProperty || 'waapi',
      duration: t.duration,
      easing: t.easing,
      playState: a.playState,
    };
  });
}

export function extractCssText() {
  const inline = [];
  for (const s of document.querySelectorAll('style')) if (s.textContent) inline.push(s.textContent);
  const sheets = [];
  let blocked = 0;
  for (const ss of document.styleSheets) {
    try {
      const rules = ss.cssRules;
      if (!rules) continue;
      let text = '';
      for (const r of rules) {
        text += r.cssText + '\n';
        if (text.length > 800000) break;
      }
      sheets.push({ href: ss.href || null, media: ss.media ? ss.media.mediaText : '', owner: ss.ownerNode ? ss.ownerNode.tagName : null, text });
    } catch {
      blocked++;
      sheets.push({ href: ss.href || null, blocked: true });
    }
  }
  // adopted stylesheets living in shadow roots
  let adopted = 0;
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      try {
        for (const ss of el.shadowRoot.adoptedStyleSheets || []) {
          let text = '';
          for (const r of ss.cssRules) text += r.cssText + '\n';
          sheets.push({ href: null, adopted: true, text });
          adopted++;
        }
      } catch {}
      walk(el.shadowRoot);
    }
  };
  walk(document);
  return { inline, sheets, blocked, adopted };
}

export function extractInlineSvg(limit) {
  const out = [];
  for (const svg of document.querySelectorAll('svg')) {
    if (out.length >= limit) break;
    const r = svg.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const html = svg.outerHTML;
    if (html.length > 200000) continue;
    out.push({
      w: Math.round(r.width),
      h: Math.round(r.height),
      viewBox: svg.getAttribute('viewBox'),
      bytes: html.length,
      html,
    });
  }
  return out;
}

export function collectAssetUrls() {
  const urls = new Map();
  const add = (u, kind, el) => {
    if (!u || typeof u !== 'string') return;
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    try {
      const abs = new URL(u, location.href).href;
      if (!urls.has(abs)) urls.set(abs, { url: abs, kind, tag: el || null });
    } catch {}
  };
  for (const img of document.querySelectorAll('img')) {
    add(img.currentSrc || img.src, 'image', 'img');
    if (img.srcset) for (const part of img.srcset.split(',')) add(part.trim().split(' ')[0], 'image', 'img');
  }
  for (const v of document.querySelectorAll('video,audio')) {
    add(v.currentSrc || v.src, v.tagName === 'VIDEO' ? 'video' : 'audio', v.tagName.toLowerCase());
    for (const s of v.querySelectorAll('source')) add(s.src, v.tagName === 'VIDEO' ? 'video' : 'audio', 'source');
    if (v.poster) add(v.poster, 'image', 'poster');
  }
  for (const el of document.querySelectorAll('*')) {
    const bgi = getComputedStyle(el).backgroundImage;
    if (bgi && bgi !== 'none') {
      for (const m of bgi.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(m[1], 'image', 'background');
    }
  }
  for (const l of document.querySelectorAll('link[rel*=icon],link[rel=preload][as=font]')) add(l.href, l.rel.includes('icon') ? 'icon' : 'font', 'link');
  return [...urls.values()].slice(0, 400);
}

export function audioSnapshot() {
  const media = [...document.querySelectorAll('audio,video')].map((m) => ({
    tag: m.tagName.toLowerCase(),
    src: (m.currentSrc || m.src || '').slice(0, 300),
    loop: m.loop, muted: m.muted, autoplay: m.autoplay, volume: m.volume, paused: m.paused, controls: m.controls,
  }));
  const rec = window.__RECON || {};
  return {
    media,
    audioApi: rec.audio || [],
    playCalls: rec.media || [],
    libraries: {
      howler: typeof window.Howl !== 'undefined' || typeof window.Howler !== 'undefined',
      tone: typeof window.Tone !== 'undefined',
      audiojs: typeof window.audiojs !== 'undefined',
      p5sound: typeof window.p5 !== 'undefined' && !!(window.p5.prototype && window.p5.prototype.soundFormats),
    },
  };
}

export function librarySnapshot() {
  const g = window;
  const globals = {};
  const names = ['gsap', 'ScrollTrigger', 'ScrollSmoother', 'SplitText', 'Flip', 'Draggable', 'THREE', 'Lenis', 'LocomotiveScroll', 'Swiper', 'Splide', 'emblaCarousel', 'barba', 'anime', 'Motion', 'motion', 'popmotion', 'Rive', 'lottie', 'bodymovin', 'Howl', 'Howler', 'Tone', 'p5', 'PIXI', 'Phaser', 'Matter', 'OGL', 'Curtains', 'AOS', 'ScrollReveal', 'jQuery', '$', 'React', 'ReactDOM', 'Vue', 'Svelte', 'Alpine', 'htmx', '__NEXT_DATA__', '__NUXT__', '__remixContext', 'gtag', 'dataLayer', 'webpackJsonp'];
  for (const n of names) {
    try { if (typeof g[n] !== 'undefined') globals[n] = typeof g[n]; } catch {}
  }

  const count = (sel) => {
    try { return document.querySelectorAll(sel).length; } catch { return 0; }
  };
  const hasReactFiber = (el) => {
    try { return !!el && Object.keys(el).some((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber') || k.startsWith('_reactListening')); } catch { return false; }
  };
  // React 18+ may mount on an arbitrary container, so probe a bounded set of nodes
  const detectReact = () => {
    if (hasReactFiber(document.getElementById('root')) || hasReactFiber(document.getElementById('app'))) return true;
    for (const el of document.querySelectorAll('body > *')) if (hasReactFiber(el)) return true;
    let seen = 0;
    for (const el of document.querySelectorAll('*')) {
      if (++seen > 400) break;
      if (hasReactFiber(el)) return true;
    }
    return false;
  };
  let sxClasses = 0;
  {
    let seen = 0;
    for (const el of document.querySelectorAll('[class]')) {
      if (++seen > 800) break;
      if (typeof el.className === 'string' && /(^|\s)sx-[\w-]+(\s|$)/.test(el.className)) sxClasses++;
    }
  }
  let tailwindHits = 0;
  let tailwindSampled = 0;
  const tw = /(^|\s)(flex|grid|hidden|items-center|justify-between|justify-center|gap-\d+|p[xytblr]?-\d+|m[xytblr]?-\d+|text-(xs|sm|base|lg|\d?xl)|bg-[a-z]+-\d{2,3}|rounded(-[a-z0-9]+)?|shadow(-[a-z]+)?|w-\d+|h-\d+)(\s|$)/;
  for (const el of document.querySelectorAll('[class]')) {
    if (tailwindSampled >= 600) break;
    tailwindSampled++;
    if (typeof el.className === 'string' && tw.test(el.className)) tailwindHits++;
  }

  const dom = {
    nextRoot: count('#__next') > 0,
    nextData: typeof g.__NEXT_DATA__ !== 'undefined',
    nuxt: typeof g.__NUXT__ !== 'undefined' || count('#__nuxt') > 0,
    remix: typeof g.__remixContext !== 'undefined',
    reactFiber: detectReact(),
    reactRootAttr: count('[data-reactroot]'),
    sxClasses,
    vue: typeof g.__VUE__ !== 'undefined' || count('#app[data-v-app], [data-v-app]') > 0,
    svelte: count('[data-svelte-h]'),
    astro: count('astro-island'),
    angular: count('[ng-version]'),
    alpine: count('[x-data]'),
    htmx: count('[hx-get],[hx-post],[hx-trigger]'),
    webpack: typeof g.webpackChunk_N_E !== 'undefined' || typeof g.webpackChunk !== 'undefined',
    vite: !!document.querySelector('script[type="module"][src*="/@vite/"]') || typeof g.__vite_plugin_react_preamble_installed__ !== 'undefined',
  };
  const cssInJs = {
    styledComponents: Math.min(30, count('style[data-styled]')) + (count('[class*="sc-"]') > 5 ? 1 : 0),
    emotion: count('style[data-emotion]'),
    jss: count('style[data-jss]'),
    stitches: count('style[data-stitches],style[data-stitches-ui]'),
    tailwindRatio: tailwindSampled ? Math.round((tailwindHits / tailwindSampled) * 100) : 0,
    radix: count('[data-radix-popper-content-wrapper],[data-radix-collection-item]'),
    vaul: count('[data-vaul-drawer],[data-vaul-drawer-wrapper]'),
  };

  let framework = 'static/unknown';
  if (dom.nextRoot || dom.nextData) framework = 'Next.js';
  else if (dom.nuxt) framework = 'Nuxt';
  else if (dom.astro) framework = 'Astro';
  else if (dom.svelte) framework = 'Svelte/SvelteKit';
  else if (dom.remix) framework = 'Remix';
  else if (dom.vue) framework = 'Vue';
  else if (dom.angular) framework = 'Angular';
  else if (dom.reactFiber || dom.reactRootAttr) framework = 'React';
  else if (dom.alpine) framework = 'Alpine.js';
  else if (dom.htmx) framework = 'htmx';
  else if (dom.sxClasses > 10) framework = 'React (styled-system / sx classes)';

  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 120);
  const hints = [];
  for (const s of scripts) {
    const m = s.toLowerCase();
    for (const k of ['gsap', 'three', 'lenis', 'locomotive', 'swiper', 'framer', 'motion', 'animejs', 'lottie', 'rive', 'howler', 'tone', 'pixi', 'barba', 'aos', 'scrollreveal', 'embla', 'splide', 'react', 'vue', 'svelte', 'next', 'nuxt', 'astro', 'alpine', 'htmx', 'sanity', 'contentful', 'segment', 'amplitude', 'sentry', 'vercel']) {
      if (m.includes(k) && !hints.includes(k)) hints.push(k);
    }
  }
  let gsapVersion = null;
  try { if (g.gsap && g.gsap.version) gsapVersion = g.gsap.version; } catch {}

  // a bundled framework root may not exist; the chunk URLs still give it away
  if (framework === 'React' && hints.includes('next')) framework = 'Next.js';
  if (framework === 'React' && hints.includes('nuxt')) framework = 'Nuxt';
  if (framework === 'static/unknown' && hints.includes('next')) framework = 'Next.js (server-rendered)';

  return { globals, framework, dom, cssInJs, scriptHints: hints, gsapVersion, scriptCount: scripts.length, scripts: scripts.slice(0, 40) };
}

export function scrollSurfaces() {
  const out = { sticky: [], fixed: [], scrollSnap: [], scrollTimeline: [] };
  const els = [];
  const walk = (root, list) => {
    for (const el of root.querySelectorAll('*')) {
      if (list.length >= 3000) return;
      list.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, list);
    }
  };
  walk(document, els);
  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 20) continue;
    const d = {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3) : [],
      top: Math.round(r.top),
      h: Math.round(r.height),
    };
    if (cs.position === 'sticky') out.sticky.push(d);
    if (cs.position === 'fixed') out.fixed.push(d);
    if (cs.scrollSnapType && cs.scrollSnapType !== 'none') out.scrollSnap.push({ ...d, snap: cs.scrollSnapType });
  }
  return out;
}

export function dismissBanner() {
  const pat = /^(accept|accept all|allow all|agree|got it|ok|okay|i agree|continue|同意|接受|允许|我知道了|知道了|好的|关闭|确定)$/i;
  const nodes = [...document.querySelectorAll('button,[role=button],a[href="#"],div[class*=close],span[class*=close]')];
  for (const el of nodes) {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (!t || t.length > 24) continue;
    if (!pat.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    if (r.top < 0 || r.top > innerHeight) continue;
    try { el.click(); return { clicked: t, rect: { x: Math.round(r.x), y: Math.round(r.y) } }; } catch {}
  }
  return null;
}