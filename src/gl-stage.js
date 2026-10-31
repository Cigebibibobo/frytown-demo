// WebGL2 stage for the static town layers.
//
// The canvas renderer needed a scene cache plus a pool of baked chunk canvases
// to afford the backdrop, island shelf and 5k ground tiles, and that pile of
// surfaces is what the phone webview kept reclaiming. Here the same geometry is
// uploaded once as world-space quads and re-projected by the vertex shader, so
// the whole static stack costs a handful of draw calls and one canvas.
//
// Coordinates are world pixels; the shader maps them through the camera the
// same way TownEngine.worldToScreen does. `screen` meshes skip the camera and
// are already in CSS pixels.

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in float a_layer;
in vec4 a_col;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_view;
uniform float u_cy;
uniform float u_space;
out vec2 v_uv;
out vec4 v_col;
out vec2 v_world;
flat out float v_layer;
void main() {
  vec2 p;
  if (u_space > 0.5) {
    p = a_pos;
    // Screen-space runs still need world coordinates for the water mask.
    v_world = (a_pos - vec2(u_view.x * 0.5, u_view.y * 0.5 + u_cy)) / u_zoom + u_cam;
  } else {
    p = (a_pos - u_cam) * u_zoom + vec2(u_view.x * 0.5, u_view.y * 0.5 + u_cy);
    v_world = a_pos;
  }
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
  v_col = a_col;
  v_layer = a_layer;
}`;

// Two samplers, selected by u_arrMode. Atlas pages stay 2D textures; the small
// UI glyphs and baked text share one array so one ordered run can interleave
// panels and labels without extra draw calls or per-frame canvas uploads.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D u_tex;
uniform sampler2DArray u_arr;
uniform sampler2D u_mask;
uniform float u_arrMode;
uniform float u_maskMode;
uniform vec2 u_maskOff;
uniform vec2 u_maskScale;
uniform float u_grid;
uniform vec2 u_tile;
uniform vec4 u_gridRect;
in vec2 v_uv;
in vec4 v_col;
in vec2 v_world;
flat in float v_layer;
out vec4 outColor;
void main() {
  if (u_grid > 0.5) {
    // The build grid is a 1px hairline at 5.5% alpha. Aliased quads land on one
    // row or the other depending on the subpixel phase, which is exactly where
    // the canvas stroke antialiases, so the lattice is solved per pixel instead:
    // tile coordinates from the world position, then the box-filtered coverage
    // of a 1px stroke either side of it.
    vec2 t = vec2(v_world.x / u_tile.x + v_world.y / u_tile.y,
      v_world.y / u_tile.y - v_world.x / u_tile.x) * 0.5;
    // The canvas only strokes diamonds for the tiles inside the visible range,
    // so the lattice stops at the map edge instead of laying a grid over the
    // sea. The union of those unit diamonds is exactly this rect.
    if (t.x < u_gridRect.x || t.y < u_gridRect.y || t.x > u_gridRect.z || t.y > u_gridRect.w) {
      outColor = vec4(0.0);
      return;
    }
    vec2 f = abs(fract(t + 0.5) - 0.5);
    vec2 gx = vec2(dFdx(t.x), dFdy(t.x));
    vec2 gy = vec2(dFdx(t.y), dFdy(t.y));
    // A pixel square seen along a slanted line's normal is wider than 1px, which
    // is why the canvas stroke is softer than a plain 1px ramp. Keep the same
    // shape: half-width 0.5, footprint extent e, so the coverage ramp is
    // (0.5 + e/2 - d) / e and the line keeps its 1px of paint.
    float lx = max(length(gx), 1e-6);
    float ly = max(length(gy), 1e-6);
    float ex = (abs(gx.x) + abs(gx.y)) / lx;
    float ey = (abs(gy.x) + abs(gy.y)) / ly;
    float ax = (0.5 + 0.5 * ex - f.x / lx) / ex;
    float ay = (0.5 + 0.5 * ey - f.y / ly) / ey;
    // One stroke() paints the union of the subpaths, so a crossing is not twice
    // as bright.
    outColor = vec4(v_col.rgb, v_col.a * clamp(max(ax, ay), 0.0, 1.0));
    return;
  }
  vec4 c = u_arrMode > 0.5
    ? texture(u_arr, vec3(v_uv, v_layer))
    : texture(u_tex, v_uv);
  float m = 1.0;
  if (u_maskMode > 0.5) {
    m = texture(u_mask, (v_world - u_maskOff) * u_maskScale).a;
  }
  outColor = c * v_col * m;
}`;

const STRIDE = 9; // x, y, u, v, layer, r, g, b, a

export class Mesh {
  constructor(space = 'world') {
    this.space = space;
    this.parts = new Map();
  }

  part(tex) {
    let p = this.parts.get(tex);
    if (!p) {
      p = [];
      this.parts.set(tex, p);
    }
    return p;
  }

  // Axis-aligned quad in the mesh's space; uv is the full texture by default.
  quad(tex, x0, y0, x1, y1, u0 = 0, v0 = 0, u1 = 1, v1 = 1, c = WHITE) {
    this.quadPts(tex, x0, y0, x1, y0, x1, y1, x0, y1, u0, v0, u1, v1, c);
  }

  // Four corners in order top-left, top-right, bottom-right, bottom-left.
  quadPts(tex, ax, ay, bx, by, cx, cy, dx, dy, u0, v0, u1, v1, c = WHITE) {
    const p = this.part(tex);
    const [r, g, b, a] = c;
    p.push(
      ax, ay, u0, v0, 0, r, g, b, a,
      bx, by, u1, v0, 0, r, g, b, a,
      cx, cy, u1, v1, 0, r, g, b, a,
      ax, ay, u0, v0, 0, r, g, b, a,
      cx, cy, u1, v1, 0, r, g, b, a,
      dx, dy, u0, v1, 0, r, g, b, a,
    );
  }

  // Quad with a vertical colour ramp, for the cliff faces.
  quadRamp(tex, x0, y0, x1, y1, u0, v0, u1, v1, top, bottom) {
    const p = this.part(tex);
    const [tr, tg, tb, ta] = top;
    const [br, bg, bb, ba] = bottom;
    p.push(
      x0, y0, u0, v0, 0, tr, tg, tb, ta,
      x1, y0, u1, v0, 0, tr, tg, tb, ta,
      x1, y1, u1, v1, 0, br, bg, bb, ba,
      x0, y0, u0, v0, 0, tr, tg, tb, ta,
      x1, y1, u1, v1, 0, br, bg, bb, ba,
      x0, y1, u0, v1, 0, br, bg, bb, ba,
    );
  }

  // Arbitrary quad with per-corner colours and shared uv.
  quadCols(tex, pts, u0, v0, u1, v1, cols) {
    const p = this.part(tex);
    const [ax, ay, bx, by, cx, cy, dx, dy] = pts;
    const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      const c = cols[i];
      const q = i === 0 ? [ax, ay] : i === 1 ? [bx, by] : i === 2 ? [cx, cy] : [dx, dy];
      p.push(q[0], q[1], uv[i][0], uv[i][1], 0, c[0], c[1], c[2], c[3]);
    }
  }

  tri(tex, ax, ay, au, av, bx, by, bu, bv, cx, cy, cu, cv, c = WHITE) {
    const p = this.part(tex);
    const [r, g, b, a] = c;
    p.push(
      ax, ay, au, av, 0, r, g, b, a,
      bx, by, bu, bv, 0, r, g, b, a,
      cx, cy, cu, cv, 0, r, g, b, a,
    );
  }

  // Quad whose corners carry their own uv, for screen-anchored patterns.
  quadUV(tex, pts, uvs, c = WHITE) {
    const p = this.part(tex);
    const [r, g, b, a] = c;
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      p.push(pts[i * 2], pts[i * 2 + 1], uvs[i * 2], uvs[i * 2 + 1], 0, r, g, b, a);
    }
  }

  get empty() {
    for (const p of this.parts.values()) if (p.length) return false;
    return true;
  }
}

export const WHITE = [1, 1, 1, 1];

export class GLStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.ok = false;
    this.lost = false;
    this.bornAt = 0;
    this.lostAt = 0;
    this._nudgeAt = 0;
    this.restores = 0;
    this._loseExt = null;
    this._onLost = null;
    this._onRestored = null;
    // Draw calls per frame, kept as a number the phone readout can show. Mobile
    // drivers start stalling in the low hundreds and the town is built from
    // layers, so the count is the cheapest clue about which frame is expensive.
    this.drawCalls = 0;
    this.viewW = 1;
    this.viewH = 1;
    this.dpr = 1;
    // Texture bytes uploaded during the frame that just finished. The phone
    // report has to show this: a full-window overlay re-upload is invisible in
    // an FPS number until the driver gives up on the context.
    this.upBytes = 0;
    this._tex = new Map();
    this._sources = new Map();
    this._layers = { screen: [], world: [], overlay: [] };
    this._mesh = { screen: null, world: [], overlay: null };
    this._free = [];
    // One small texture array carries every UI glyph and baked label. Layer 0 is
    // solid white (panels, bars), the rest are allocated on demand and kept in
    // insertion order so the oldest can be recycled. Sources stay on the CPU so
    // a lost context rebuilds the same layer indices the vertices already use.
    this.arrW = 256;
    this.arrH = 128;
    this.arrMax = 48;
    this._arrTex = null;
    this._arrSrc = new Map();
    this._arrFree = [];
    this._arrNext = 1;
    this._arrOrder = [];
    // How many times the canvas element itself has been thrown away and replaced
    // to get a context back. Bounded, because a device that cannot hold WebGL
    // will say so within a few tries and the canvas path is the answer after that.
    this.swaps = 0;
    if (canvas) this.attach(canvas);
  }

  // Bind to a surface and build everything it needs. Called once at boot and
  // again for a replacement canvas, so the listeners and the rebuilt state live
  // in one place. Returns false when the device will not give a context at all.
  attach(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      // No powerPreference: a phone has one GPU, and asking for the discrete one
      // is a documented way to get either no context or one the driver drops.
    });
    if (!gl) {
      this.gl = null;
      this.ok = false;
      return false;
    }
    this.gl = gl;
    this.ok = true;
    this._onLost = (e) => {
      // Without this the canvas stays black for the rest of the session; the
      // restore handler re-uploads everything from the kept sources.
      e.preventDefault();
      this.lost = true;
      this.lostAt = performance.now();
    };
    this._onRestored = () => this._restore();
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    this._restore();
    return true;
  }

  // A context the driver took away for real does not come back on this element:
  // restoreContext() only undoes a loss the page asked for, which the phone's
  // 109 nudges proved. The one lever left is a new element with a new context,
  // so the caller has to re-run resize() and re-bind anything that held the old
  // node. The id and class carry over, which keeps the CSS and the look intact.
  replace() {
    if (!this.canvas?.parentNode) return false;
    const old = this.canvas;
    // Unhook first: the old context is about to be released on purpose, and a
    // late loss event from it would mark the new stage lost.
    old.removeEventListener('webglcontextlost', this._onLost);
    old.removeEventListener('webglcontextrestored', this._onRestored);
    if (this.gl && !this.gl.isContextLost()) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    const fresh = document.createElement('canvas');
    fresh.id = old.id;
    fresh.className = old.className;
    fresh.width = old.width;
    fresh.height = old.height;
    fresh.style.cssText = old.style.cssText;
    old.replaceWith(fresh);
    this.swaps++;
    return this.attach(fresh);
  }

  // Rebuild everything the loss invalidated. Called from the restore event, and
  // again from frame() when a context that went away without an event is back.
  _restore() {
    this._init();
    for (const key of this._sources.keys()) this._upload(key);
    for (const name of Object.keys(this._mesh)) this._uploadLayer(name);
  }

  // True once a lost context is usable again, rebuilding the handles on the way
  // out: some drivers drop the context without ever sending a restore event.
  tryRevive() {
    // No context at all is not "alive". A swap that failed to get one leaves the
    // stage exactly like that, and answering true here strands every frame on a
    // surface nothing can draw to: no canvas fallback, and no further recovery,
    // because the caller only retries when this returns false.
    if (!this.gl) return false;
    if (!this.lost) return true;
    if (this.gl.isContextLost()) {
      this._nudge();
      return false;
    }
    this._restore();
    return true;
  }

  // Worth one call a second while the context is gone: it undoes a loss the page
  // asked for, and a driver that resets the context may report it that way. It
  // cannot revive a real eviction — the phone sat at r109 without ever coming
  // back — so replace() is what the recovery actually relies on.
  _nudge() {
    const now = performance.now();
    if (now - this._nudgeAt < 1000) return;
    this._nudgeAt = now;
    if (!this._loseExt) return;
    this.restores++;
    this._loseExt.restoreContext();
  }

  _init() {
    const gl = this.gl;
    const log = [];
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        log.push(`${type === gl.VERTEX_SHADER ? 'vert' : 'frag'}: ${gl.getShaderInfoLog(s)}`);
      }
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) log.push(`link: ${gl.getProgramInfoLog(prog)}`);
    this.programLog = log.join('\n');
    this.prog = prog;
    this.a = {
      pos: gl.getAttribLocation(prog, 'a_pos'),
      uv: gl.getAttribLocation(prog, 'a_uv'),
      layer: gl.getAttribLocation(prog, 'a_layer'),
      col: gl.getAttribLocation(prog, 'a_col'),
    };
    this.u = {
      cam: gl.getUniformLocation(prog, 'u_cam'),
      zoom: gl.getUniformLocation(prog, 'u_zoom'),
      view: gl.getUniformLocation(prog, 'u_view'),
      cy: gl.getUniformLocation(prog, 'u_cy'),
      space: gl.getUniformLocation(prog, 'u_space'),
      tex: gl.getUniformLocation(prog, 'u_tex'),
      arr: gl.getUniformLocation(prog, 'u_arr'),
      arrMode: gl.getUniformLocation(prog, 'u_arrMode'),
      mask: gl.getUniformLocation(prog, 'u_mask'),
      maskMode: gl.getUniformLocation(prog, 'u_maskMode'),
      maskOff: gl.getUniformLocation(prog, 'u_maskOff'),
      maskScale: gl.getUniformLocation(prog, 'u_maskScale'),
      grid: gl.getUniformLocation(prog, 'u_grid'),
      gridRect: gl.getUniformLocation(prog, 'u_gridRect'),
      tile: gl.getUniformLocation(prog, 'u_tile'),
    };
    this.vbo = gl.createBuffer();
    this.dynamic = gl.createBuffer();
    this.ovQuad = gl.createBuffer();
    this._ovQuadKey = '';
    this._ovSize = '';
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // A restored context hands out dead texture and buffer handles, so the old
    // maps are dropped and rebuilt from the kept sources. The layer lists have
    // to go too: their buffers are dead, and letting _uploadLayer see them would
    // recycle those handles through the free list and draw from nothing.
    this._tex.clear();
    this._free.length = 0;
    for (const name of Object.keys(this._layers)) this._layers[name] = [];
    this._white();
    // Array texture handles die with the context; the sources and their indices
    // did not, so the rebuilt array has to answer the same layer numbers.
    this._arrTex = null;
    this._arrMax = Math.min(this.arrMax, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) || this.arrMax);
    this._ensureArray();
    this._loseExt = gl.getExtension('WEBGL_lose_context');
    this.bornAt = performance.now();
    this.lostAt = 0;
    // A rebuilt program and buffers mean a working context again, whether this
    // came from the restore event or from the first successful frame after a
    // loss the page never heard about.
    this.lost = false;
  }

  _white() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._tex.set('white', t);
  }

  // Layer 0 is solid white; allocating 1..N gives each glyph or text string its
  // own slice. A source larger than a layer is clipped, so callers bake at the
  // layer size (256x128) rather than handing over a full-screen canvas.
  _ensureArray() {
    if (this._arrTex) return this._arrTex;
    const gl = this.gl;
    if (!gl) return null;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    const layers = Math.max(1, this._arrMax);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, this.arrW, this.arrH, layers, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    this._arrTex = t;
    const white = new Uint8Array(this.arrW * this.arrH * 4);
    white.fill(255);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, this.arrW, this.arrH, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, white);
    this.upBytes += this.arrW * this.arrH * 4;
    for (const [idx, src] of this._arrSrc) this._arrUpload(idx, src);
    return t;
  }

  _arrUpload(idx, source) {
    const gl = this.gl;
    if (!gl || !this._arrTex) return;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._arrTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, idx, this.arrW, this.arrH, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.upBytes += this.arrW * this.arrH * 4;
  }

  // Returns the layer index to store in the vertex `a_layer` slot.
  allocLayer(source) {
    if (!this.gl) return 0;
    this._ensureArray();
    const c = document.createElement('canvas');
    c.width = this.arrW;
    c.height = this.arrH;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(source, 0, 0);
    let idx;
    if (this._arrFree.length) {
      idx = this._arrFree.pop();
    } else if (this._arrNext < this._arrMax) {
      idx = this._arrNext++;
    } else {
      // Recycle the oldest layer. A frame that still references the evicted
      // index would show the replacement for one frame; with 48 slots and a
      // handful of live labels that only happens on a pathological burst.
      idx = this._arrOrder.shift();
      this._arrSrc.delete(idx);
    }
    this._arrSrc.set(idx, c);
    this._arrOrder.push(idx);
    this._arrUpload(idx, c);
    return idx;
  }

  freeLayer(idx) {
    if (idx <= 0 || !this._arrSrc.has(idx)) return;
    this._arrSrc.delete(idx);
    const at = this._arrOrder.indexOf(idx);
    if (at >= 0) this._arrOrder.splice(at, 1);
    if (!this._arrFree.includes(idx)) this._arrFree.push(idx);
  }

  get layerCount() {
    return this._arrSrc.size;
  }

  resize(w, h, dpr) {
    this.viewW = w;
    this.viewH = h;
    this.dpr = dpr;
    if (!this.gl) return;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setTexture(key, source, opts = {}) {
    if (!this.gl) return;
    this._sources.set(key, { source, opts });
    this._upload(key);
  }

  _upload(key) {
    const rec = this._sources.get(key);
    if (!rec) return;
    const gl = this.gl;
    const { source, opts } = rec;
    let t = this._tex.get(key);
    if (!t) {
      t = gl.createTexture();
      this._tex.set(key, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.upBytes += (source.width || 0) * (source.height || 0) * 4;
    const filter = opts.linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  hasTexture(key) {
    return this._tex.has(key);
  }

  // meshes: one Mesh or an array; all must share the layer's space.
  setLayer(name, meshes) {
    this._mesh[name] = Array.isArray(meshes) ? meshes : [meshes];
    this._uploadLayer(name);
  }

  _uploadLayer(name) {
    const gl = this.gl;
    if (!gl) return;
    const old = this._layers[name];
    for (const b of old) this._free.push(b.buf);
    const batches = [];
    for (const mesh of this._mesh[name] || []) {
      if (!mesh) continue;
      for (const [tex, verts] of mesh.parts) {
        if (!verts.length) continue;
        const data = new Float32Array(verts);
        const buf = this._free.pop() || gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        batches.push({ tex, buf, count: data.length / STRIDE, space: mesh.space });
      }
    }
    this._layers[name] = batches;
  }

  _attrs(buf) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const fs = STRIDE * 4;
    gl.enableVertexAttribArray(this.a.pos);
    gl.vertexAttribPointer(this.a.pos, 2, gl.FLOAT, false, fs, 0);
    gl.enableVertexAttribArray(this.a.uv);
    gl.vertexAttribPointer(this.a.uv, 2, gl.FLOAT, false, fs, 8);
    gl.enableVertexAttribArray(this.a.layer);
    gl.vertexAttribPointer(this.a.layer, 1, gl.FLOAT, false, fs, 16);
    gl.enableVertexAttribArray(this.a.col);
    gl.vertexAttribPointer(this.a.col, 4, gl.FLOAT, false, fs, 20);
  }

  _bind(batch) {
    this._attrs(batch.buf);
  }

  _draw(list, space) {
    const gl = this.gl;
    gl.uniform1f(this.u.space, space);
    gl.uniform1f(this.u.arrMode, 0);
    for (const b of list) {
      gl.bindTexture(gl.TEXTURE_2D, this._tex.get(b.tex) || this._tex.get('white'));
      this._bind(b);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      this.drawCalls++;
    }
  }

  // Ordered stream of polyglot runs, drawn after frame(): { tex, verts, space,
  // blend, array }. Vertices are world-space when space is 'world', CSS pixels
  // when 'screen'. Adjacent runs are only merged by the caller; each one costs
  // one buffer upload and one draw call.
  drawOrdered(runs) {
    const gl = this.gl;
    if (!gl || this.lost || !Array.isArray(runs) || !runs.length) return;
    const cam = this._cam || { x: 0, y: 0, zoom: 1 };
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.cam, cam.x, cam.y);
    gl.uniform1f(this.u.zoom, cam.zoom);
    gl.uniform2f(this.u.view, this.viewW, this.viewH);
    gl.uniform1f(this.u.cy, cam.cy || 0);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform1i(this.u.arr, 1);
    gl.uniform1i(this.u.mask, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._ensureArray());
    gl.activeTexture(gl.TEXTURE0);
    let space = null;
    let premul = null;
    let masked = false;
    let grid = null;
    gl.uniform1f(this.u.grid, 0);
    const white = this._tex.get('white');
    for (const run of runs) {
      if (!run) continue;
      const verts = run.verts;
      if (!verts || !verts.length) continue;
      const sp = run.space === 'screen' ? 1 : 0;
      if (sp !== space) {
        gl.uniform1f(this.u.space, sp);
        space = sp;
      }
      const pm = !!run.blend;
      if (pm !== premul) {
        gl.blendFunc(pm ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        premul = pm;
      }
      const g = run.grid || null;
      if (g !== grid) {
        gl.uniform1f(this.u.grid, g ? 1 : 0);
        if (g) {
          gl.uniform2f(this.u.tile, g.hw, g.hh);
          gl.uniform4f(this.u.gridRect, g.x0, g.y0, g.x1, g.y1);
        }
        grid = g;
      }
      const wantMask = !!run.mask;
      if (wantMask !== masked) {
        gl.uniform1f(this.u.maskMode, wantMask ? 1 : 0);
        masked = wantMask;
        if (!wantMask) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, white);
          gl.activeTexture(gl.TEXTURE0);
        }
      }
      if (wantMask) {
        gl.uniform2f(this.u.maskOff, run.mask.off[0], run.mask.off[1]);
        gl.uniform2f(this.u.maskScale, run.mask.scale[0], run.mask.scale[1]);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._tex.get(run.mask.tex) || white);
        gl.activeTexture(gl.TEXTURE0);
      }
      if (run.array) {
        gl.uniform1f(this.u.arrMode, 1);
      } else {
        gl.uniform1f(this.u.arrMode, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._tex.get(run.tex) || white);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamic);
      gl.bufferData(gl.ARRAY_BUFFER,
        verts instanceof Float32Array ? verts : new Float32Array(verts), gl.STREAM_DRAW);
      this._attrs(this.dynamic);
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / STRIDE);
      this.drawCalls++;
    }
    if (premul) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(this.u.arrMode, 0);
    gl.uniform1f(this.u.maskMode, 0);
    gl.uniform1f(this.u.grid, 0);
  }

  frame(cam) {
    const gl = this.gl;
    if (!gl || this.lost) return false;
    this.drawCalls = 0;
    // A driver reset does not always arrive as an event. Asking costs nothing
    // and is the only way to notice a context that died quietly.
    if (gl.isContextLost()) {
      this.lost = true;
      return false;
    }
    this._cam = cam;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.81, 0.91, 0.96, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this._ensureArray());
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._tex.get('white'));
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform1i(this.u.arr, 1);
    gl.uniform1i(this.u.mask, 2);
    gl.uniform1f(this.u.arrMode, 0);
    gl.uniform1f(this.u.maskMode, 0);
    gl.uniform1f(this.u.grid, 0);
    gl.uniform2f(this.u.maskOff, 0, 0);
    gl.uniform2f(this.u.maskScale, 1, 1);
    gl.uniform2f(this.u.cam, cam.x, cam.y);
    gl.uniform1f(this.u.zoom, cam.zoom);
    gl.uniform2f(this.u.view, this.viewW, this.viewH);
    gl.uniform1f(this.u.cy, cam.cy);
    this._draw(this._layers.screen, 1);
    this._draw(this._layers.world, 0);
    this._draw(this._layers.overlay, 0);
    return true;
  }

  // Small per-frame mesh (the wind bands). `multiply` keeps the canvas
  // composite it replaces: dst * src, which on an opaque target is the same
  // as drawing that layer on top of the town in 2D.
  drawMesh(mesh, multiply = false) {
    const gl = this.gl;
    if (!gl || this.lost || !mesh) return;
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.cam, this._cam?.x || 0, this._cam?.y || 0);
    gl.uniform1f(this.u.zoom, this._cam?.zoom || 1);
    gl.uniform2f(this.u.view, this.viewW, this.viewH);
    gl.uniform1f(this.u.cy, this._cam?.cy || 0);
    gl.uniform1f(this.u.space, mesh.space === 'screen' ? 1 : 0);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform1i(this.u.arr, 1);
    gl.uniform1f(this.u.arrMode, 0);
    if (multiply) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.activeTexture(gl.TEXTURE0);
    for (const [tex, verts] of mesh.parts) {
      if (!verts.length) continue;
      gl.bindTexture(gl.TEXTURE_2D, this._tex.get(tex) || this._tex.get('white'));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamic);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
      this._attrs(this.dynamic);
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / STRIDE);
      this.drawCalls++;
    }
    if (multiply) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Last pass: the animated 2D layer arrives as a texture and covers the
  // viewport, so the page holds one canvas instead of two the webview can drop
  // independently. Premultiplied upload plus ONE/ONE_MINUS_SRC_ALPHA is exactly
  // how the browser composited that canvas over the town, so the picture does
  // not change. The storage is re-specified only when the viewport does.
  overlay(source) {
    const gl = this.gl;
    if (!gl || this.lost) return;
    // Nothing to composite (tool state gone, or every layer moved to GL): the
    // frame already cleared, so skipping the quad is what removes the old
    // picture instead of leaving the last upload on screen.
    if (!source) return;
    const w = source.width;
    const h = source.height;
    if (!w || !h) return;
    this.upBytes += w * h * 4;
    let t = this._tex.get('overlay');
    if (!t) {
      t = gl.createTexture();
      this._tex.set('overlay', t);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, t);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const size = `${w}|${h}`;
    if (this._ovSize !== size) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this._ovSize = size;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const key = `${this.viewW}|${this.viewH}`;
    if (this._ovQuadKey !== key) {
      const vw = this.viewW;
      const vh = this.viewH;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ovQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 0, 0, 0, 1, 1, 1, 1,
        vw, 0, 1, 0, 0, 1, 1, 1, 1,
        vw, vh, 1, 1, 0, 1, 1, 1, 1,
        0, 0, 0, 0, 0, 1, 1, 1, 1,
        vw, vh, 1, 1, 0, 1, 1, 1, 1,
        0, vh, 0, 1, 0, 1, 1, 1, 1,
      ]), gl.STATIC_DRAW);
      this._ovQuadKey = key;
    }

    gl.useProgram(this.prog);
    gl.uniform1f(this.u.space, 1);
    gl.uniform2f(this.u.cam, 0, 0);
    gl.uniform1f(this.u.zoom, 1);
    gl.uniform2f(this.u.view, this.viewW, this.viewH);
    gl.uniform1f(this.u.cy, 0);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform1i(this.u.arr, 1);
    gl.uniform1f(this.u.arrMode, 0);
    gl.uniform1f(this.u.grid, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    this._attrs(this.ovQuad);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.drawCalls++;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
}
