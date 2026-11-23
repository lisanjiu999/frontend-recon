/*
 * 深度取证：页面侧函数。
 *
 * 与 extract.mjs 的区别：extract.mjs 产出「聚合统计」（调色板、字阶、动效清单），
 * 这里产出「逐元素、逐规则、逐层」的原始快照，用于 100% 还原结构与动效。
 *
 * 每个函数都会被 page.evaluate 序列化进页面，因此必须自包含。
 */

/* 需要逐元素记录的样式属性（顺序即输出顺序） */
const STYLE_PROPS = [
  'display', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
  'float', 'clear', 'overflow-x', 'overflow-y', 'clip-path', 'mask-image',
  'opacity', 'visibility', 'transform', 'transform-origin', 'translate', 'rotate', 'scale',
  'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation', 'perspective', 'transform-style',
  'will-change', 'contain', 'container-type',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-align', 'text-decoration-line',
  'text-shadow', 'white-space', 'writing-mode', 'font-feature-settings', 'font-variation-settings',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-column', 'grid-row', 'gap',
  'columns', 'column-count',
  'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
  'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
  'cursor', 'pointer-events', 'user-select', 'scroll-behavior', 'scroll-snap-type',
  'object-fit', 'object-position', 'list-style-type',
];

export function snapshotElements(arg) {
  const { start = 0, count = 1200, maxText = 120 } = arg || {};
  const PROPS = [
    'display', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
    'float', 'clear', 'overflow-x', 'overflow-y', 'clip-path', 'mask-image',
    'opacity', 'visibility', 'transform', 'transform-origin', 'translate', 'rotate', 'scale',
    'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation', 'perspective', 'transform-style',
    'will-change', 'contain', 'container-type',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'aspect-ratio',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'box-sizing', 'border-top-width', 'border-top-style', 'border-top-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'word-spacing', 'text-transform', 'text-align', 'text-decoration-line',
    'text-shadow', 'white-space', 'writing-mode', 'font-feature-settings', 'font-variation-settings',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis',
    'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-column', 'grid-row', 'gap',
    'columns', 'column-count',
    'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'cursor', 'pointer-events', 'user-select', 'scroll-behavior', 'scroll-snap-type',
    'object-fit', 'object-position', 'list-style-type',
  ];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);

  // 稳定顺序：文档序（含开放 shadow root）
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  const slice = all.slice(start, start + count);
  const out = [];
  for (const el of slice) {
    if (SKIP.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none') {
      out.push({ t: el.tagName.toLowerCase(), d: 0 });
      continue;
    }
    const styles = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
        styles[p] = v.length > 220 ? v.slice(0, 220) + '…' : v;
      }
    }
    // 默认值不算「有过渡」：0s 时清掉 transition-*，否则每个元素都会显得在过渡
    const dur = styles['transition-duration'];
    if (!dur || /^0m?s$/.test(dur)) {
      for (const k of ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay']) delete styles[k];
    }
    const node = {
      t: el.tagName.toLowerCase(),
      i: el.id || undefined,
      c: typeof el.className === 'string' && el.className.trim()
        ? el.className.trim().split(/\s+/).slice(0, 8).join('.')
        : undefined,
      role: el.getAttribute('role') || undefined,
      rect: [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
      s: styles,
    };
    const txt = (el.childNodes.length && [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').trim()) || '';
    if (txt) node.x = txt.slice(0, maxText);
    if (el.tagName === 'IMG') node.src = (el.currentSrc || el.src || '').slice(0, 300);
    if (el.tagName === 'A') node.href = (el.getAttribute('href') || '').slice(0, 200);
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') node.src = (el.currentSrc || '').slice(0, 300);
    if (el.tagName === 'IFRAME') node.src = (el.src || '').slice(0, 300);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      node.form = { type: el.type || undefined, name: el.name || undefined, placeholder: el.placeholder || undefined };
    }
    // 伪元素（只有真正画出来的才记）
    for (const pe of ['::before', '::after']) {
      let pcs;
      try { pcs = getComputedStyle(el, pe); } catch { continue; }
      const content = pcs.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') continue;
      node[pe === '::before' ? 'b' : 'a'] = {
        content: content.slice(0, 60),
        w: pcs.getPropertyValue('width'),
        h: pcs.getPropertyValue('height'),
        bg: pcs.getPropertyValue('background-image') + ' ' + pcs.getPropertyValue('background-color'),
        transform: pcs.getPropertyValue('transform'),
        opacity: pcs.getPropertyValue('opacity'),
        pos: pcs.getPropertyValue('position'),
        inset: pcs.getPropertyValue('inset'),
        anim: pcs.getPropertyValue('animation-name'),
      };
    }
    // 正在跑的动画
    let anims = [];
    try { anims = el.getAnimations(); } catch { anims = []; }
    if (anims.length) {
      node.run = anims.slice(0, 6).map((a) => {
        const timing = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
        return {
          n: a.animationName || a.transitionProperty || 'waapi',
          d: timing.duration,
          e: timing.easing,
          p: a.playState,
        };
      });
    }
    out.push(node);
  }
  return { total: all.length, start, count: out.length, nodes: out };
}

/* 结构化 CSS 规则：选择器 / 声明 / 条件 / 来源 */
export function snapshotCssRules() {
  const out = [];
  const seen = new Set();

  const styleRule = (rule, meta) => {
    const text = rule.cssText || '';
    if (!text) return;
    const key = (meta.media || '') + '|' + text.slice(0, 400);
    if (seen.has(key)) return;
    seen.add(key);
    const decls = {};
    const st = rule.style;
    if (st) {
      for (let i = 0; i < st.length; i++) {
        const p = st.item(i);
        const v = st.getPropertyValue(p);
        if (v) decls[p] = v.length > 300 ? v.slice(0, 300) + '…' : v;
      }
    }
    out.push({
      sel: rule.selectorText,
      decls,
      media: meta.media || null,
      supports: meta.supports || null,
      src: meta.src || null,
      // 嵌套规则（CSS Nesting）单独标出来
      nested: rule.cssRules && rule.cssRules.length ? rule.cssText.slice(0, 2000) : undefined,
    });
  };

  const walk = (rules, meta) => {
    if (!rules || !rules.length) return;
    for (const rule of rules) {
      const t = rule.type;
      if (t === 4) {                    // @media
        walk(rule.cssRules, { ...meta, media: rule.conditionText || (rule.media && rule.media.mediaText) || null });
        continue;
      }
      if (t === 12) {                   // @supports
        walk(rule.cssRules, { ...meta, supports: rule.conditionText || null });
        continue;
      }
      if (t === 7) {                    // @keyframes
        out.push({ keyframes: rule.name, body: (rule.cssText || '').slice(0, 4000), media: meta.media || null, src: meta.src || null });
        continue;
      }
      if (t === 5) {                    // @font-face
        out.push({ fontface: true, body: (rule.cssText || '').slice(0, 1200), src: meta.src || null });
        continue;
      }
      // 注意：现代 Chrome 里普通样式规则也有 cssRules（嵌套用），长度可能为 0
      if (rule.cssRules && rule.cssRules.length) {
        walk(rule.cssRules, meta);
        continue;
      }
      if (t === 1 || rule.selectorText) styleRule(rule, meta);
    }
  };

  for (const ss of document.styleSheets) {
    const src = ss.href || null;
    try {
      walk(ss.cssRules, { src });
    } catch {
      out.push({ blocked: true, src });
    }
  }
  // 开放 shadow root 里的 adoptedStyleSheets
  const walkShadow = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      try {
        for (const ss of el.shadowRoot.adoptedStyleSheets || []) walk(ss.cssRules, { src: 'adopted' });
      } catch {}
      walkShadow(el.shadowRoot);
    }
  };
  walkShadow(document);
  return out;
}

/* stacking context 与图层顺序 */
export function snapshotLayers() {
  const out = [];
  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const z = cs.zIndex;
    const creates = (
      (z !== 'auto' && cs.position !== 'static') ||
      cs.position === 'fixed' || cs.position === 'sticky' ||
      Number(cs.opacity) < 1 ||
      (cs.transform && cs.transform !== 'none') ||
      (cs.filter && cs.filter !== 'none') ||
      (cs.backdropFilter && cs.backdropFilter !== 'none') ||
      (cs.mixBlendMode && cs.mixBlendMode !== 'normal') ||
      cs.isolation === 'isolate' ||
      (cs.willChange && /transform|opacity|filter/.test(cs.willChange)) ||
      (cs.contain && /paint|layout|strict|content/.test(cs.contain))
    );
    if (!creates) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '',
      z: z === 'auto' ? null : Number(z),
      pos: cs.position,
      rect: [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
      why: [
        z !== 'auto' ? 'z-index' : null,
        cs.position === 'fixed' ? 'fixed' : null,
        cs.position === 'sticky' ? 'sticky' : null,
        Number(cs.opacity) < 1 ? 'opacity' : null,
        cs.transform !== 'none' ? 'transform' : null,
        cs.filter !== 'none' ? 'filter' : null,
        cs.backdropFilter !== 'none' ? 'backdrop-filter' : null,
        cs.mixBlendMode !== 'normal' ? 'blend' : null,
        cs.isolation === 'isolate' ? 'isolate' : null,
        cs.willChange && /transform|opacity|filter/.test(cs.willChange) ? 'will-change' : null,
      ].filter(Boolean),
    });
  }
  return out.slice(0, 500);
}

/* 某个 section 子树的文本与结构摘要（用于逐幕/逐区块取证） */
export function snapshotSection(arg) {
  const { selector, maxNodes = 400 } = arg || {};
  const root = document.querySelector(selector);
  if (!root) return null;
  const rect = root.getBoundingClientRect();
  const nodes = [];
  const walk = (el, depth) => {
    if (nodes.length >= maxNodes) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    nodes.push({
      d: depth,
      t: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '',
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      fs: cs.fontSize,
      fw: cs.fontWeight,
      color: cs.color,
      bg: cs.backgroundColor,
      txt: (el.childNodes.length && [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').trim().slice(0, 80)) || undefined,
    });
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(root, 0);
  const text = (root.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  let anims = [];
  try {
    anims = root.getAnimations({ subtree: true }).map((a) => {
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
      const tgt = a.effect && a.effect.target;
      return {
        n: a.animationName || a.transitionProperty || 'waapi',
        d: t.duration,
        e: t.easing,
        delay: t.delay,
        iter: t.iterations,
        target: tgt ? tgt.tagName.toLowerCase() + (typeof tgt.className === 'string' && tgt.className ? '.' + tgt.className.trim().split(/\s+/)[0] : '') : null,
      };
    });
  } catch {}
  return {
    selector,
    rect: [Math.round(rect.x), Math.round(rect.y + scrollY), Math.round(rect.width), Math.round(rect.height)],
    nodes,
    text,
    animations: anims.slice(0, 60),
  };
}

/* 当前视口内“正在动”的元素（用于滚动过程中的逐点采样） */
export function snapshotMotionAtViewport() {
  const out = [];
  let anims = [];
  try { anims = document.getAnimations(); } catch {}
  for (const a of anims) {
    const tgt = a.effect && a.effect.target;
    if (!tgt) continue;
    const r = tgt.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const t = a.effect.getTiming ? a.effect.getTiming() : {};
    out.push({
      n: a.animationName || a.transitionProperty || 'waapi',
      d: t.duration,
      e: t.easing,
      delay: t.delay,
      iter: t.iterations,
      state: a.playState,
      tag: tgt.tagName.toLowerCase(),
      cls: typeof tgt.className === 'string' ? tgt.className.trim().split(/\s+/).slice(0, 3).join('.') : '',
      y: Math.round(r.top),
    });
  }
  return { scrollY: Math.round(scrollY), count: out.length, anims: out.slice(0, 120) };
}