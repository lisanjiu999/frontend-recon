/*
 * frontend-recon instrumentation.
 * Injected with addInitScript BEFORE any page script runs, so it sees every
 * addEventListener, AudioContext node and WAAPI animation the site creates.
 * Records are capped and exposed on window.__RECON.
 */
(() => {
  if (window.__RECON) return
  // reloads must not restore scroll: reveal states are evidence
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual' } catch {}
  const MAX = 1200
  const R = (window.__RECON = {
    listeners: [],
    audio: [],
    media: [],
    animate: [],
    raf: 0,
    observers: {},
    canvas: 0,
    contexts: 0,
    errors: [],
    hooks: [],
  })

  const desc = (t) => {
    try {
      if (t === window) return 'window'
      if (t === document) return 'document'
      if (!t || typeof t.tagName !== 'string') return String((t && t.constructor && t.constructor.name) || t)
      let s = t.tagName.toLowerCase()
      if (t.id) s += '#' + String(t.id).slice(0, 40)
      const cls = typeof t.className === 'string' ? t.className.trim() : ''
      if (cls) s += '.' + cls.split(/\s+/).slice(0, 3).join('.')
      return s.slice(0, 120)
    } catch {
      return 'unknown'
    }
  }
  const push = (arr, v) => {
    if (arr.length < MAX) arr.push(v)
  }
  const isNoise = (type, fn) => {
    const src = fn ? String(fn) : ''
    return (
      type.startsWith('__') ||
      src.includes('_hitTargetInterceptor') ||
      src.includes('__playwright') ||
      src.includes('__puppeteer') ||
      type === '__playwright_global_listeners_check__'
    )
  }

  const origAdd = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      if (!isNoise(String(type), fn)) {
        push(R.listeners, {
          type: String(type),
          target: desc(this),
          passive: !!(opts && opts.passive),
          capture: !!(opts && opts.capture),
          once: !!(opts && opts.once),
          src: fn ? String(fn).replace(/\s+/g, ' ').slice(0, 220) : '',
        })
      }
    } catch {}
    return origAdd.call(this, type, fn, opts)
  }

  // ---- Web Audio -------------------------------------------------------
  const OrigAC = window.AudioContext || window.webkitAudioContext
  if (OrigAC) {
    const Patched = function (...a) {
      const ctx = new OrigAC(...a)
      push(R.audio, { kind: 'AudioContext', sampleRate: ctx.sampleRate, state: ctx.state })
      const wrap = (name) => {
        const orig = ctx[name] && ctx[name].bind(ctx)
        if (!orig) return
        ctx[name] = (...args) => {
          push(R.audio, { kind: name })
          const node = orig(...args)
          try {
            if (name === 'createOscillator' || name === 'createBufferSource') {
              for (const m of ['start', 'stop']) {
                const om = node[m].bind(node)
                node[m] = (...s) => {
                  push(R.audio, {
                    kind: name + '.' + m,
                    detail: name === 'createOscillator' ? { frequency: node.frequency && node.frequency.value, type: node.type } : { buffer: !!(node.buffer) },
                  })
                  return om(...s)
                }
              }
            }
          } catch {}
          return node
        }
      }
      for (const m of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createConvolver', 'decodeAudioData', 'createMediaElementSource']) wrap(m)
      return ctx
    }
    Patched.prototype = OrigAC.prototype
    window.AudioContext = Patched
    if (window.webkitAudioContext) window.webkitAudioContext = Patched
  }

  // ---- media elements --------------------------------------------------
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    try {
      push(R.media, {
        tag: this.tagName,
        src: (this.currentSrc || this.src || '').slice(0, 300),
        loop: this.loop,
        muted: this.muted,
        volume: this.volume,
        controls: this.controls,
        autoplay: this.autoplay,
        paused: this.paused,
      })
    } catch {}
    return origPlay.apply(this, arguments)
  }

  // ---- WAAPI -----------------------------------------------------------
  const origAnimate = Element.prototype.animate
  if (origAnimate) {
    Element.prototype.animate = function (kf, opt) {
      try {
        push(R.animate, {
          target: desc(this),
          duration: typeof opt === 'number' ? opt : (opt && opt.duration) || null,
          easing: (opt && opt.easing) || null,
          delay: (opt && opt.delay) || null,
          iterations: (opt && opt.iterations) || null,
          fill: (opt && opt.fill) || null,
          keyframes: JSON.stringify(kf).slice(0, 700),
        })
      } catch {}
      return origAnimate.call(this, kf, opt)
    }
  }

  // ---- rAF activity (JS-driven motion) --------------------------------
  const origRAF = window.requestAnimationFrame
  window.requestAnimationFrame = function (fn) {
    R.raf++
    return origRAF.call(window, fn)
  }

  for (const name of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver']) {
    const O = window[name]
    if (!O) continue
    R.observers[name] = 0
    const P = function (...a) {
      R.observers[name]++
      return new O(...a)
    }
    P.prototype = O.prototype
    window[name] = P
  }

  const origGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (typeof type === 'string' && (type === '2d' || type.startsWith('webgl'))) R.canvas++
    return origGetContext.call(this, type, ...rest)
  }

  window.addEventListener('error', (e) => push(R.errors, String(e.message).slice(0, 240)))
  window.addEventListener('unhandledrejection', (e) => push(R.errors, 'unhandledrejection: ' + String(e.reason).slice(0, 200)))
})();