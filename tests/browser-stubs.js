// tests/browser-stubs.js  -  ZERO-dependency browser-emulation stubs.
//
// Purpose: v1.0.362 adds browser-targeted PlainScript features (DOM events,
// canvas 2D, WebGL, requestAnimationFrame loops, animation/timers, input,
// audio, asset loading, WebSocket, localStorage). The generated JS is asserted
// by running it through tests/runtime.test.js's new Function mechanism: the
// compiled (async () => { ... })(); wrapper is rewritten to
// `return (async () => { ... })();` and evaluated via
// new Function('require','console','process', <stub globals as params>, body).
// makeBrowserEnv() builds a matching environment and env.run(js) re-threads the
// same stubs in, so tests assert on env.logs and env.recorder.
//
// Every env is freshly built per makeBrowserEnv() call  -  there is NO shared
// mutable module state, so sequenced/parallel tests never pollute each other.
//
// Usage:
//   const { makeBrowserEnv } = require('./browser-stubs');
//   const env = makeBrowserEnv();
//   const game = env.document.createElement('canvas');
//   env.document.elements.set('game', game);            // seed getElementById
//   game.style.width = '100px';                          // recorder.style: {set:'width', value:'100px'}
//   const ctx = game.getContext('2d');
//   ctx.fillStyle = 'red';                               // recorder.ctx2d: {fn:'fillStyle', value:'red'}
//   ctx.fillRect(0, 0, 100, 50);                         // recorder.ctx2d: {fn:'fillRect', args:[...]}
//   env.raf(() => env.logs.push('frame'));               // scheduled, NOT run yet
//   env.pump(3);                                         // now 0 -> 48, callback fired at t=16
//   if (env.logs[0] !== 'frame') throw new Error('rAF loop');   // deterministic assert
//   if (env.recorder.now !== 48) throw new Error('fake clock');
//
// Exported helpers:
//   makeBrowserEnv()    fresh env: { document, window, raf, pump, localStorage,
//                       AudioContext, Image, performance, navigator, recorder,
//                       logs, requires, extra, run(js), setTimeout, ... }
//   createRecorder()    a fresh empty recorder object
//   runProgram(env,js)  the new Function runner shared by env.run
//   makeDocument, makeWindow, makeElement, makeStyle, makeClassList,
//   makeCtx2d, makeGLContext, makeGradient, makeInertContext, makeLocalStorage,
//   makeAudioContextClass, makeImageClass   (composable stub factories)
//   CONST / GL_CONST    common WebGL enum values (COMPILE_STATUS:0x8B81, ...)

'use strict';

// ── Recorder ────────────────────────────────────────────────────────────────

function createRecorder() {
  return {
    now: 0,                     // fake monotonic clock (ms), advanced by pump()
    rafId: 0,                   // monotonic source for requestAnimationFrame ids
    frames: [],                 // pending rAF callbacks: { id, cb, when }
    cancelled: [],              // cancelAnimationFrame(id) calls
    timers: [],                 // captured timers: { id, fn, delay, interval }
    documentListeners: {},      // document.addEventListener: type -> [fn]
    windowListeners: {},        // window.addEventListener: type -> [fn]
    created: [],                // document.createElement: { created: tag, el }
    selectorRegistry: {},       // querySelector/querySelectorAll registrations
    selectorHits: [],           // every querySelector/querySelectorAll: { sel, all }
    elements: [],               // every element stub produced by createElement
    style: [],                  // element.style set ops: { set, value, element }
    classList: [],              // element.classList ops: { op, tokens, element }
    childOps: [],               // append/appendChild/remove/removeChild
    events: [],                 // element add/removeEventListener: { el, type, fn, remove }
    attrOps: [],                // setAttribute/removeAttribute: { op, name, value, el }
    contexts: [],               // element.getContext: { type, el, attributes }
    ctx2d: [],                  // canvas 2D: { fn, args:[...] } | setter { fn, value }
    gl: [],                     // WebGL: { fn, args:[...] }
    glObjects: [],              // created shaders/programs/buffers/textures
    images: [],                 // every `new Image()` stub pushed by the ctor
    imageLoads: [],             // fired src loads: { image, src, ok }
    audioCtxCreated: 0,         // AudioContext constructor invocations
    audioEvents: [],            // AudioContext method calls: { fn, args }
    storageEvents: [],          // localStorage ops: { op, key, value }
    navigations: [],            // history.pushState / location ops: { op, ... }
    scrolls: [],                // window.scrollTo/scroll/scrollBy
  };
}

// ── Element stubs ───────────────────────────────────────────────────────────

// style records set operations ({set, value, element}) and reads values back.
function makeStyle(recorder, element) {
  const store = {};
  const record = (prop, value) => recorder.style.push({ set: prop, value, element });
  return new Proxy(store, {
    set(target, prop, value) {
      if (typeof prop === 'symbol') { Reflect.set(target, prop, value); return true; }
      record(prop, value);
      Reflect.set(target, prop, value);
      return true;
    },
    get(target, prop) {
      if (prop === 'setProperty') return (p, v) => { record(p, v); Reflect.set(store, p, v); };
      if (prop === 'getPropertyValue') return (p) => (Object.prototype.hasOwnProperty.call(store, p) ? store[p] : '');
      if (prop === 'removeProperty') return (p) => { record(p, ''); delete store[p]; };
      if (!(prop in target)) return '';
      return Reflect.get(target, prop);
    },
    deleteProperty(target, prop) {
      record(prop, '');
      return Reflect.deleteProperty(target, prop);
    },
  });
}

// classList records add/remove/toggle/replace/contains ops.
function makeClassList(recorder, element) {
  const classes = [];
  const record = (op, tokens) => recorder.classList.push({ op, tokens: [...tokens], element });
  return {
    classes,
    add: (...tokens) => {
      record('add', tokens);
      for (const t of tokens) if (!classes.includes(t)) classes.push(t);
    },
    remove: (...tokens) => {
      record('remove', tokens);
      for (const t of tokens) {
        const i = classes.indexOf(t);
        if (i >= 0) classes.splice(i, 1);
      }
    },
    toggle: (token, force) => {
      const add = force === undefined ? !classes.includes(token) : Boolean(force);
      record('toggle', [token, force]);
      if (add) { if (!classes.includes(token)) classes.push(token); return true; }
      const i = classes.indexOf(token);
      if (i >= 0) classes.splice(i, 1);
      return false;
    },
    contains: (token) => classes.includes(token),
    replace: (oldToken, newToken) => {
      record('replace', [oldToken, newToken]);
      const i = classes.indexOf(oldToken);
      if (i >= 0) classes[i] = newToken;
    },
    toString: () => classes.join(' '),
  };
}

function makeElement(recorder, tag) {
  const name = String(tag).toUpperCase();
  const el = {
    nodeType: 1,
    nodeName: name,
    tagName: name,
    id: '',
    className: '',
    type: '',
    disabled: false,
    hidden: false,
    parentNode: null,
    children: [],
    textContent: '',
    innerHTML: '',
    value: '',
    src: '',
    width: name === 'CANVAS' ? 300 : 0,
    height: name === 'CANVAS' ? 150 : 0,
    attributes: {},
    dataset: {},
  };
  el.style = makeStyle(recorder, el);
  el.classList = makeClassList(recorder, el);

  const rec = (type, fn, remove) => recorder.events.push({ el, type, fn, remove });
  el.addEventListener = (type, fn) => {
    (el.handlers[type] = el.handlers[type] || []).push(fn);
    rec(type, fn, false);
  };
  el.removeEventListener = (type, fn) => {
    if (el.handlers[type]) el.handlers[type] = el.handlers[type].filter((h) => h !== fn);
    rec(type, fn, true);
  };
  el.dispatchEvent = (evt) => {
    const type = evt && evt.type;
    for (const h of el.handlers[type] || []) h.call(el, evt || { type });
    return true;
  };
  el.click = () => {
    recorder.events.push({ el, type: 'click', synthetic: true });
    for (const h of el.handlers.click || []) h.call(el, { type: 'click', target: el });
  };
  el.focus = () => recorder.events.push({ el, type: 'focus', synthetic: true });
  el.blur = () => recorder.events.push({ el, type: 'blur', synthetic: true });
  el.append = (...kids) => {
    for (const k of kids) { el.children.push(k); k.parentNode = el; recorder.childOps.push({ op: 'append', parent: el, child: k }); }
  };
  el.appendChild = (k) => {
    el.children.push(k);
    k.parentNode = el;
    recorder.childOps.push({ op: 'appendChild', parent: el, child: k });
    return k;
  };
  el.remove = () => {
    recorder.childOps.push({ op: 'remove', parent: el.parentNode, child: el });
    if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
    el.parentNode = null;
  };
  el.removeChild = (k) => {
    const i = el.children.indexOf(k);
    if (i >= 0) el.children.splice(i, 1);
    if (k.parentNode === el) k.parentNode = null;
    recorder.childOps.push({ op: 'removeChild', parent: el, child: k });
    return k;
  };
  el.replaceWith = (k) => {
    recorder.childOps.push({ op: 'replaceWith', parent: el.parentNode, child: el, replacement: k });
    el.parentNode = null;
  };
  el.setAttribute = (n, v) => {
    el.attributes[n] = String(v);
    recorder.attrOps.push({ op: 'setAttribute', name: n, value: String(v), el });
    if (n === 'id') el.id = String(v);
  };
  el.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(el.attributes, n) ? el.attributes[n] : null);
  el.removeAttribute = (n) => {
    delete el.attributes[n];
    recorder.attrOps.push({ op: 'removeAttribute', name: n, el });
  };
  el.scrollIntoView = () => recorder.scrolls.push({ target: el });
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: el.width, bottom: el.height, width: el.width, height: el.height,
  });

  el.handlers = {};
  el.getContext = (type, ...attrs) => {
    recorder.contexts.push({ type, el, attributes: attrs[0] });
    if (!el._contexts) el._contexts = {};
    if (!el._contexts[type]) {
      if (type === '2d') el._contexts[type] = makeCtx2d(recorder, el);
      else if (type === 'webgl' || type === 'webgl2') el._contexts[type] = makeGLContext(recorder, el, type);
      else el._contexts[type] = makeInertContext(recorder, type, el);
    }
    return el._contexts[type];
  };
  return el;
}

// ── Document stub ───────────────────────────────────────────────────────────

function makeDocument(recorder) {
  const elements = new Map(); // getElementById registry (tests prepopulate)
  const doc = {
    elements,
    selectorRegistry: recorder.selectorRegistry,
    readyState: 'complete',
    title: '',
    hidden: false,
    visibilityState: 'visible',
    body: makeElement(recorder, 'body'),
    head: makeElement(recorder, 'head'),
    documentElement: makeElement(recorder, 'html'),
    cookie: '',
    getElementById: (id) => elements.get(String(id)) || null,
    createElement: (tag) => {
      const el = makeElement(recorder, String(tag));
      recorder.elements.push(el);
      recorder.created.push({ created: tag, el });
      return el;
    },
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => {
      const frag = { nodeType: 11, children: [] };
      frag.appendChild = (c) => { c.parentNode = null; frag.children.push(c); return c; };
      frag.append = (...cs) => { for (const c of cs) { c.parentNode = null; frag.children.push(c); } };
      return frag;
    },
    querySelector: (sel) => {
      recorder.selectorHits.push({ sel, all: false });
      const v = recorder.selectorRegistry[sel];
      if (v === undefined) return null;
      return Array.isArray(v) ? (v[0] || null) : v;
    },
    querySelectorAll: (sel) => {
      recorder.selectorHits.push({ sel, all: true });
      const v = recorder.selectorRegistry[sel];
      if (v === undefined) return [];
      return Array.isArray(v) ? v : [v];
    },
    addEventListener: (type, fn) => {
      (recorder.documentListeners[type] = recorder.documentListeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (recorder.documentListeners[type]) {
        recorder.documentListeners[type] = recorder.documentListeners[type].filter((h) => h !== fn);
      }
    },
    fire: (type, evt) => {
      for (const h of recorder.documentListeners[type] || []) h(evt || { type, target: doc });
    },
    dispatchEvent: (evt) => { doc.fire(evt.type, evt); return true; },
  };
  return doc;
}

// ── Canvas 2D context ───────────────────────────────────────────────────────

const CTX2D_SETTERS = [
  'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
  'globalAlpha', 'globalCompositeOperation', 'lineCap', 'lineJoin', 'miterLimit',
  'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'lineDashOffset',
  'direction', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality',
  'letterSpacing', 'wordSpacing',
];

function makeGradient(recorder, type, coords) {
  return {
    type,
    coords,
    addColorStop(offset, color) {
      recorder.ctx2d.push({ fn: 'addColorStop', value: { offset, color } });
    },
  };
}

function makeCtx2d(recorder, canvas) {
  const values = {};
  const record = (fn, args) => recorder.ctx2d.push({ fn, args: [...args] });
  const ctx = { canvas };
  const method = (fn, ret) => function (...args) { record(fn, args); return ret; };

  for (const m of ['save', 'restore', 'translate', 'rotate', 'scale', 'transform',
    'setTransform', 'beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
    'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect',
    'fillText', 'strokeText', 'drawImage', 'putImageData', 'setLineDash',
    'ellipse', 'roundRect', 'createPattern', 'drawFocusIfNeeded']) {
    ctx[m] = method(m, undefined);
  }
  ctx.isPointInPath = method('isPointInPath', false);
  ctx.isPointInStroke = method('isPointInStroke', false);
  ctx.createImageData = function (w, h) {
    record('createImageData', [w, h]);
    const width = typeof w === 'object' && w ? w.width : w;
    const height = typeof w === 'object' && w ? w.height : h;
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  };
  ctx.getImageData = function (x, y, w, h) {
    record('getImageData', [x, y, w, h]);
    const width = typeof x === 'object' && x ? x.width : w;
    const height = typeof x === 'object' && x ? x.height : h;
    return { x, y, width, height, data: new Uint8ClampedArray(width * height * 4) };
  };
  ctx.measureText = function (s) {
    record('measureText', [s]);
    return { width: (s == null ? '' : String(s)).length * 10 };
  };
  ctx.getTransform = function () {
    record('getTransform', []);
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  };
  ctx.getLineDash = function () { record('getLineDash', []); return []; };
  ctx.createLinearGradient = function (...a) { record('createLinearGradient', a); return makeGradient(recorder, 'linear', a); };
  ctx.createRadialGradient = function (...a) { record('createRadialGradient', a); return makeGradient(recorder, 'radial', a); };

  for (const prop of CTX2D_SETTERS) {
    Object.defineProperty(ctx, prop, {
      configurable: true,
      enumerable: true,
      get() { return values[prop]; },
      set(v) { recorder.ctx2d.push({ fn: prop, value: v }); values[prop] = v; },
    });
  }

  // Record any other method probed on the 2d context too.
  return new Proxy(ctx, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop);
      return (...args) => { record(prop, args); };
    },
  });
}

// ── WebGL context ───────────────────────────────────────────────────────────

const GL_CONST = {
  COMPILE_STATUS: 0x8B81,
  LINK_STATUS: 0x8B82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88E4,
  COLOR_BUFFER_BIT: 0x4000,
  VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  TRIANGLES: 0x0004,
};

function makeGLContext(recorder, canvas, kind) {
  const record = (fn, args) => recorder.gl.push({ fn, args: [...args] });
  const gl = { canvas, kind, CONST: GL_CONST };
  const nextId = (objKind) => {
    const id = { id: ++gl._seq };
    recorder.glObjects.push({ kind: objKind, id });
    return id;
  };
  const noop = (fn) => function (...args) { record(fn, args); };
  gl._seq = 0;

  gl.createShader = (t) => { record('createShader', [t]); return nextId('shader'); };
  gl.shaderSource = noop('shaderSource');
  gl.compileShader = noop('compileShader');
  gl.getShaderParameter = (sh, p) => { record('getShaderParameter', [sh, p]); return p === GL_CONST.COMPILE_STATUS; };
  gl.getShaderInfoLog = (sh) => { record('getShaderInfoLog', [sh]); return ''; };
  gl.deleteShader = noop('deleteShader');
  gl.createProgram = () => { record('createProgram', []); return nextId('program'); };
  gl.attachShader = noop('attachShader');
  gl.linkProgram = noop('linkProgram');
  gl.getProgramParameter = (p, k) => { record('getProgramParameter', [p, k]); return k === GL_CONST.LINK_STATUS; };
  gl.getProgramInfoLog = (p) => { record('getProgramInfoLog', [p]); return ''; };
  gl.deleteProgram = noop('deleteProgram');
  gl.useProgram = noop('useProgram');
  gl.getAttribLocation = (p, n) => { record('getAttribLocation', [p, n]); return 0; };
  gl.getUniformLocation = (p, n) => { record('getUniformLocation', [p, n]); return nextId('uniform'); };
  gl.createBuffer = () => { record('createBuffer', []); return nextId('buffer'); };
  gl.bindBuffer = noop('bindBuffer');
  gl.bufferData = noop('bufferData');
  gl.deleteBuffer = noop('deleteBuffer');
  gl.enableVertexAttribArray = noop('enableVertexAttribArray');
  gl.disableVertexAttribArray = noop('disableVertexAttribArray');
  gl.vertexAttribPointer = noop('vertexAttribPointer');
  gl.drawArrays = noop('drawArrays');
  gl.drawElements = noop('drawElements');
  gl.clearColor = noop('clearColor');
  gl.clear = noop('clear');
  gl.viewport = noop('viewport');
  gl.createTexture = () => { record('createTexture', []); return nextId('texture'); };
  gl.bindTexture = noop('bindTexture');
  gl.texImage2D = noop('texImage2D');
  gl.texParameteri = noop('texParameteri');
  gl.activeTexture = noop('activeTexture');
  gl.deleteTexture = noop('deleteTexture');
  gl.getExtension = (n) => { record('getExtension', [n]); return null; };
  gl.getContextAttributes = () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false });
  gl.getError = () => 0;
  gl.getParameter = (p) => { record('getParameter', [p]); return 1; };
  gl.getShaderSource = (sh) => { record('getShaderSource', [sh]); return ''; };
  gl.enable = noop('enable');
  gl.disable = noop('disable');
  gl.depthFunc = noop('depthFunc');
  gl.blendFunc = noop('blendFunc');
  gl.cullFace = noop('cullFace');
  gl.frontFace = noop('frontFace');
  gl.flush = noop('flush');
  gl.finish = () => { record('finish', []); };
  gl.readPixels = noop('readPixels');
  gl.uniform1f = noop('uniform1f');
  gl.uniform2f = noop('uniform2f');
  gl.uniform4f = noop('uniform4f');
  gl.uniformMatrix4fv = noop('uniformMatrix4fv');

  // Record any other method probed on the GL context.
  return new Proxy(gl, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop);
      return (...args) => { record(prop, args); };
    },
  });
}

// Anything else getContext() is asked for (bitmaprenderer, etc.)  -  recorded.
function makeInertContext(recorder, type, el) {
  const record = (fn, args) => recorder.gl.push({ fn, args: [...args] });
  return new Proxy({ el, kind: type }, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop in target) return Reflect.get(target, prop);
      return (...args) => { record(prop, args); };
    },
  });
}

// ── rAF ─────────────────────────────────────────────────────────────────────

function makeRaf(recorder) {
  const state = { id: 0 };
  const raf = (cb) => {
    state.id += 1;
    recorder.frames.push({ id: state.id, cb, when: recorder.now });
    return state.id;
  };
  const cancel = (id) => {
    recorder.cancelled.push(id);
    recorder.frames = recorder.frames.filter((f) => f.id !== id);
  };
  const pump = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const batch = recorder.frames.splice(0);
      recorder.now += 16;
      for (const f of batch) f.cb(recorder.now);
    }
    return n;
  };
  return { raf, cancel, pump };
}

// ── Captured timers (no real time) ──────────────────────────────────────────

function makeTimers(recorder) {
  const state = { id: 0 };
  const timer = (interval) => (fn, delay) => {
    state.id += 1;
    recorder.timers.push({ id: state.id, fn, delay, interval });
    return state.id;
  };
  const clear = (id) => { recorder.timers = recorder.timers.filter((t) => t.id !== id); };
  return { setTimeout: timer(false), setInterval: timer(true), clearTimeout: clear, clearInterval: clear };
}

// ── Document / Audio / Storage / Image / Window ─────────────────────────────

function makeLocalStorage(recorder) {
  const store = new Map();
  return {
    get length() { return store.size; },
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => {
      recorder.storageEvents.push({ op: 'setItem', key: String(k), value: String(v) });
      store.set(String(k), String(v));
    },
    removeItem: (k) => {
      recorder.storageEvents.push({ op: 'removeItem', key: String(k) });
      store.delete(String(k));
    },
    clear: () => {
      recorder.storageEvents.push({ op: 'clear' });
      store.clear();
    },
    key: (i) => {
      const keys = [...store.keys()];
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    _store: store,
  };
}

function makeAudioContextClass(recorder) {
  const record = (fn, args) => recorder.audioEvents.push({ fn, args: args && [...args] });
  return class AudioContext {
    constructor() {
      recorder.audioCtxCreated++;
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 44100;
      this.destination = {};
      this.onstatechange = null;
      this.resume = () => {
        record('resume', []);
        this.state = 'running';
        return Promise.resolve();
      };
      this.suspend = () => {
        record('suspend', []);
        this.state = 'suspended';
        return Promise.resolve();
      };
      this.close = () => {
        record('close', []);
        this.state = 'closed';
        return Promise.resolve();
      };
      this.createOscillator = () => {
        record('createOscillator', []);
        return {
          type: 'sine',
          frequency: { value: 0 },
          detune: { value: 0 },
          connect: (d) => record('oscillator.connect', [d]),
          disconnect: () => record('oscillator.disconnect', []),
          start: (t) => record('oscillator.start', [t]),
          stop: (t) => record('oscillator.stop', [t]),
        };
      };
      this.createGain = () => {
        record('createGain', []);
        return { gain: { value: 1 }, connect: (d) => record('gain.connect', [d]), disconnect: () => record('gain.disconnect', []) };
      };
      this.createBufferSource = () => {
        record('createBufferSource', []);
        return {
          buffer: null,
          loop: false,
          playbackRate: { value: 1 },
          connect: (d) => record('bufferSource.connect', [d]),
          disconnect: () => record('bufferSource.disconnect', []),
          start: (t) => record('bufferSource.start', [t]),
          stop: (t) => record('bufferSource.stop', [t]),
        };
      };
      this.createAnalyser = () => {
        record('createAnalyser', []);
        return {
          fftSize: 2048,
          frequencyBinCount: 1024,
          connect: (d) => record('analyser.connect', [d]),
          disconnect: () => record('analyser.disconnect', []),
          getFloatFrequencyData: (...a) => record('analyser.getFloatFrequencyData', a),
          getByteFrequencyData: (...a) => record('analyser.getByteFrequencyData', a),
        };
      };
      this.createBiquadFilter = () => {
        record('createBiquadFilter', []);
        return {
          type: 'lowpass',
          frequency: { value: 350 },
          Q: { value: 1 },
          gain: { value: 0 },
          connect: (d) => record('biquadFilter.connect', [d]),
          disconnect: () => record('biquadFilter.disconnect', []),
        };
      };
      this.createBuffer = (channels, length) => {
        record('createBuffer', [channels, length]);
        return {
          numberOfChannels: channels,
          length,
          sampleRate: 44100,
          getChannelData: () => new Float32Array(length),
        };
      };
    }
  };
}

function makeImageClass(recorder) {
  return class Image {
    constructor(w, h) {
      this.width = w || 0;
      this.height = h || 0;
      this.complete = false;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.crossOrigin = null;
      this._src = '';
      recorder.images.push(this);
    }
    set src(v) {
      this._src = v;
      if (!v) return;
      queueMicrotask(() => {
        recorder.imageLoads.push({ image: this, src: v, ok: true });
        this.complete = true;
        this.naturalWidth = 300;
        this.naturalHeight = 150;
        if (typeof this.onload === 'function') this.onload.call(this, { type: 'load', target: this });
        else if (typeof this.onerror === 'function') this.onerror(new Error('failed to load image: ' + v));
      });
    }
    get src() { return this._src; }
  };
}

function scrollArgs(args) {
  if (typeof args[0] === 'object' && args[0] !== null) {
    return { left: args[0].left, top: args[0].top };
  }
  return { x: args[0], y: args[1] };
}

function makeWindow(parts) {
  const { document, localStorage, requestAnimationFrame, cancelAnimationFrame, performance, AudioContext, recorder } = parts;
  const win = {
    document,
    localStorage,
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    screenX: 0,
    screenY: 0,
    outerWidth: 800,
    outerHeight: 600,
    keyArms: {},
    location: {
      href: 'http://localhost/',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
      origin: 'http://localhost',
      reload: () => recorder.navigations.push({ op: 'location.reload' }),
      assign: (url) => recorder.navigations.push({ op: 'location.assign', url }),
      replace: (url) => recorder.navigations.push({ op: 'location.replace', url }),
    },
    history: {
      length: 0,
      state: null,
      pushState: (state, title, url) => recorder.navigations.push({ op: 'pushState', state, title, url }),
      replaceState: (state, title, url) => recorder.navigations.push({ op: 'replaceState', state, title, url }),
      back: () => recorder.navigations.push({ op: 'history.back' }),
      forward: () => recorder.navigations.push({ op: 'history.forward' }),
      go: (delta) => recorder.navigations.push({ op: 'history.go', delta }),
    },
    scrollTo: (...args) => recorder.scrolls.push(scrollArgs(args)),
    scroll: (...args) => recorder.scrolls.push(scrollArgs(args)),
    scrollBy: (...args) => recorder.scrolls.push(Object.assign(scrollArgs(args), { by: true })),
    getComputedStyle: () => ({}),
    matchMedia: () => ({
      matches: false,
      media: '',
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    performance,
    requestAnimationFrame,
    cancelAnimationFrame,
    AudioContext,
    addEventListener: (type, fn) => { (recorder.windowListeners[type] = recorder.windowListeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
      if (recorder.windowListeners[type]) {
        recorder.windowListeners[type] = recorder.windowListeners[type].filter((h) => h !== fn);
      }
    },
    fire: (type, evt) => { for (const h of recorder.windowListeners[type] || []) h.call(win, evt || { type }); },
    dispatchEvent: (evt) => { win.fire(evt.type, evt); return true; },
  };
  return win;
}

// ── The compiled-program runner (mirrors tests/runtime.test.js) ──────────────

function runProgram(env, js) {
  const sandboxConsole = {
    log: (...a) => env.logs.push(a.map(String).join(' ')),
    error: (...a) => env.logs.push('[err] ' + a.map(String).join(' ')),
    warn: (...a) => env.logs.push('[warn] ' + a.map(String).join(' ')),
  };
  const match = js.match(/^\(async \(\) => \{\n([\s\S]*)\n\}\)\(\);$/);
  const body = match ? `return (async () => {\n${match[1]}\n})();` : `${js}\n;return undefined;`;
  const baseNames = [
    'require', 'console', 'process',
    'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame',
    'localStorage', 'AudioContext', 'Image', 'performance', 'navigator',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  ];
  const extraNames = Object.keys(env.extra).filter((k) => baseNames.indexOf(k) === -1);
  const names = baseNames.concat(extraNames);
  const values = baseNames.map((name, i) => {
    switch (name) {
      case 'require': return (n) => (Object.prototype.hasOwnProperty.call(env.requires, n) ? env.requires[n] : require(n));
      case 'console': return sandboxConsole;
      case 'process': return { env: {} };
      case 'document': return env.document;
      case 'window': return env.window;
      case 'requestAnimationFrame': return env.requestAnimationFrame;
      case 'cancelAnimationFrame': return env.cancelAnimationFrame;
      case 'localStorage': return env.localStorage;
      case 'AudioContext': return env.AudioContext;
      case 'Image': return env.Image;
      case 'performance': return env.performance;
      case 'navigator': return env.navigator;
      case 'setTimeout': return env.setTimeout;
      case 'clearTimeout': return env.clearTimeout;
      case 'setInterval': return env.setInterval;
      case 'clearInterval': return env.clearInterval;
    }
    throw new Error('unhandled runner param: ' + name);
  }).concat(extraNames.map((k) => env.extra[k]));

  const fn = new Function(...names, body);
  let result;
  try {
    result = fn(...values);
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(result).then(() => env);
}

// ── Public entry point ──────────────────────────────────────────────────────

function makeBrowserEnv() {
  const recorder = createRecorder();
  const { raf, cancel, pump } = makeRaf(recorder);
  const timers = makeTimers(recorder);
  const document = makeDocument(recorder);
  const localStorage = makeLocalStorage(recorder);
  const AudioContext = makeAudioContextClass(recorder);
  const Image = makeImageClass(recorder);
  const performance = { now: () => recorder.now };
  const navigator = { userAgent: 'test', platform: 'linux' };
  const window = makeWindow({
    document,
    localStorage,
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel,
    performance,
    AudioContext,
    recorder,
  });
  const env = {
    document,
    window,
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel,
    raf,
    pump,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    localStorage,
    AudioContext,
    Image,
    performance,
    navigator,
    recorder,
    logs: [],
    requires: {},     // seed require-shim entries, e.g. env.requires.myMod = {...}
    extra: {},        // per-test extra global params passed to the sandbox
    run: (js) => runProgram(env, js),
  };
  return env;
}

module.exports = {
  makeBrowserEnv,
  createRecorder,
  runProgram,
  makeDocument,
  makeWindow,
  makeElement,
  makeStyle,
  makeClassList,
  makeCtx2d,
  makeGLContext,
  makeGradient,
  makeInertContext,
  makeLocalStorage,
  makeAudioContextClass,
  makeImageClass,
  CONST: GL_CONST,
  GL_CONST,
};