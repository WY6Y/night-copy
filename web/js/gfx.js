// Renderer: every scene draws into a 2D back buffer in virtual pixels
// (1280x720 landscape, 720x1280 portrait), then one WebGL2 pass turns it into
// a CRT: barrel curve, bloom from mipmaps, scanlines, aperture mask,
// chromatic aberration and row-tear glitches. Falls back to plain 2D.

export const C = {
  bg: '#05040d', ink: '#0b0a1c', indigo: '#1a1640', green: '#3cff9a', greenDim: '#1d7a4f',
  cyan: '#4de8ff', amber: '#ffb347', red: '#ff3b4a', redDim: '#7a1a24', white: '#e8fff4', grey: '#6d7a8c',
};
export const FONT = { big: 'VT323', ui: 'ShareTech' };

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 res; uniform float time, glitch, aberr, curve, flash, scan;
float hash(float n) { return fract(sin(n) * 43758.5453); }
vec2 barrel(vec2 u) { vec2 c = u * 2.0 - 1.0; c *= 1.0 + curve * dot(c, c) * vec2(0.6, 0.8); return c * 0.5 + 0.5; }
void main() {
  vec2 u = barrel(uv);
  if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float row = floor(u.y * 180.0);
  float tear = step(1.0 - glitch * 0.5, hash(row + floor(time * 24.0))) * (hash(row * 7.1 + time) - 0.5) * glitch * 0.08;
  u.x += tear;
  float ab = aberr + glitch * 0.004;
  vec3 col;
  col.r = texture(t, u + vec2(ab, 0.0)).r;
  col.g = texture(t, u).g;
  col.b = texture(t, u - vec2(ab, 0.0)).b;
  vec3 bloom = textureLod(t, u, 3.0).rgb * 0.55 + textureLod(t, u, 5.0).rgb * 0.45;
  col += bloom * bloom * 0.9;
  float s = 0.5 + 0.5 * sin(u.y * res.y * 3.14159);
  col *= mix(1.0, 0.72 + 0.28 * s, scan);
  float m = mod(gl_FragCoord.x, 3.0);
  col *= mix(vec3(1.0), vec3(m < 1.0 ? 1.06 : 0.94, m >= 1.0 && m < 2.0 ? 1.06 : 0.94, m >= 2.0 ? 1.06 : 0.94), 0.5);
  vec2 v = u * (1.0 - u.yx);
  col *= pow(v.x * v.y * 15.0, 0.22);
  col += (hash(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + time) - 0.5) * 0.035;
  col *= 0.97 + 0.03 * sin(time * 50.0);
  col += flash * vec3(0.55, 0.62, 0.9);
  o = vec4(col, 1.0);
}`;

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.buf = document.createElement('canvas');
    this.ctx = this.buf.getContext('2d');
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    this.fx = { glitch: 0, aberr: 0.0007, curve: 0.045, flash: 0, scan: 1, shake: 0 };
    this.time = 0;
    if (this.gl) this.initGL(); else this.ctx2 = canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    gl.useProgram(pr);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = {};
    for (const n of ['t', 'res', 'time', 'glitch', 'aberr', 'curve', 'flash', 'scan']) this.u[n] = gl.getUniformLocation(pr, n);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = this.canvas.clientWidth || innerWidth, ch = this.canvas.clientHeight || innerHeight;
    this.portrait = ch > cw * 1.1;
    this.W = this.portrait ? 720 : 1280;
    this.H = this.portrait ? 1280 : 720;
    // Fit the virtual screen inside the window; letterbox the rest.
    const fit = Math.min(cw / this.W, ch / this.H);
    this.view = { w: this.W * fit, h: this.H * fit, x: (cw - this.W * fit) / 2, y: (ch - this.H * fit) / 2, fit };
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;
    // Back buffer: enough pixels for crisp text, capped for upload cost.
    this.scale = Math.min(fit * dpr, 1.5);
    this.buf.width = Math.round(this.W * this.scale);
    this.buf.height = Math.round(this.H * this.scale);
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  // Window pixel -> virtual pixel.
  toVirtual(px, py) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (px - r.left - this.view.x) / this.view.fit, y: (py - r.top - this.view.y) / this.view.fit };
  }

  begin(dt) {
    this.time += dt;
    const f = this.fx;
    f.glitch = Math.max(0, f.glitch - dt * 2.2);
    f.flash = Math.max(0, f.flash - dt * 3);
    f.shake = Math.max(0, f.shake - dt * 3);
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = C.bg;
    c.fillRect(0, 0, this.W, this.H);
    if (f.shake > 0) {
      const s = f.shake * 10;
      c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
  }

  end() {
    const { gl, view, dpr } = this;
    if (!gl) {
      const c = this.ctx2;
      c.fillStyle = '#000';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      c.drawImage(this.buf, view.x * dpr, view.y * dpr, view.w * dpr, view.h * dpr);
      return;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(view.x * dpr, this.canvas.height - (view.y + view.h) * dpr, view.w * dpr, view.h * dpr);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
    gl.generateMipmap(gl.TEXTURE_2D);
    const f = this.fx, u = this.u;
    gl.uniform1i(u.t, 0);
    gl.uniform2f(u.res, this.H, this.H);
    gl.uniform1f(u.time, this.time);
    gl.uniform1f(u.glitch, f.glitch);
    gl.uniform1f(u.aberr, f.aberr);
    gl.uniform1f(u.curve, f.curve);
    gl.uniform1f(u.flash, f.flash);
    gl.uniform1f(u.scan, f.scan);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- drawing helpers ----------------------------------------------------

  text(str, x, y, o = {}) {
    const c = this.ctx;
    const size = o.size || 24;
    c.font = `${o.weight || ''} ${size}px ${o.font || FONT.big}, monospace`;
    c.textAlign = o.align || 'left';
    c.textBaseline = o.base || 'middle';
    c.globalAlpha = o.alpha ?? 1;
    if (o.spacing) c.letterSpacing = `${o.spacing}px`; else c.letterSpacing = '0px';
    if (o.glow !== 0) {
      c.shadowColor = o.glowColor || o.color || C.green;
      c.shadowBlur = o.glow ?? size * 0.35;
    }
    c.fillStyle = o.color || C.green;
    c.fillText(str, x, y);
    c.shadowBlur = 0;
    c.globalAlpha = 1;
    c.letterSpacing = '0px';
  }

  measure(str, size, font = FONT.big, spacing = 0) {
    const c = this.ctx;
    c.font = `${size}px ${font}, monospace`;
    c.letterSpacing = `${spacing}px`;
    const w = c.measureText(str).width;
    c.letterSpacing = '0px';
    return w;
  }

  // Word-wrap to a width; returns lines.
  wrap(str, width, size, font = FONT.ui) {
    const words = str.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (this.measure(t, size, font) > width && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Cover-fit an image into a rect, with zoom and pan (Ken Burns).
  cover(img, x, y, w, h, o = {}) {
    if (!img || !img.width) return;
    const c = this.ctx;
    const zoom = o.zoom || 1;
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const iw = img.width * s, ih = img.height * s;
    const px = o.panX ?? 0.5, py = o.panY ?? 0.5;
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.globalAlpha = o.alpha ?? 1;
    c.imageSmoothingEnabled = !o.pixel;
    c.drawImage(img, x + (w - iw) * px, y + (h - ih) * py, iw, ih);
    c.restore();
  }

  panel(x, y, w, h, o = {}) {
    const c = this.ctx;
    const col = o.color || C.green;
    c.save();
    c.globalAlpha = o.fillAlpha ?? 0.72;
    c.fillStyle = o.fill || C.ink;
    c.fillRect(x, y, w, h);
    c.globalAlpha = o.alpha ?? 1;
    c.strokeStyle = col;
    c.lineWidth = o.line || 1.5;
    c.shadowColor = col;
    c.shadowBlur = o.glow ?? 10;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // Corner brackets: the HUD signature.
    const k = Math.min(16, w / 4, h / 4);
    c.lineWidth = 3;
    c.beginPath();
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      c.moveTo(cx, cy + dy * k); c.lineTo(cx, cy); c.lineTo(cx + dx * k, cy);
    }
    c.stroke();
    c.restore();
  }

  rect(x, y, w, h, color, alpha = 1) {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  // A vertical fade, for darkening art behind UI.
  shade(x, y, w, h, from, to, alpha = 1, horizontal = false) {
    const c = this.ctx;
    const g = horizontal ? c.createLinearGradient(x, 0, x + w, 0) : c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, from); g.addColorStop(1, to);
    c.globalAlpha = alpha;
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  glitch(amount = 1) { this.fx.glitch = Math.min(1.5, this.fx.glitch + amount); }
  shake(amount = 1) { this.fx.shake = Math.min(1.5, this.fx.shake + amount); }
  flash(amount = 1) { this.fx.flash = Math.min(1, this.fx.flash + amount); }
}

// ---- particles and weather -------------------------------------------------

export class Particles {
  constructor() { this.list = []; }
  burst(x, y, color, n = 30, speed = 260, life = 0.9, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.5), max: life, color, size: size * (0.5 + Math.random()) });
    }
  }
  spark(x, y, color, vx, vy, life = 0.6, size = 2) {
    this.list.push({ x, y, vx, vy, life, max: life, color, size });
  }
  update(dt) {
    for (const p of this.list) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 140 * dt; p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(g) {
    const c = g.ctx;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.restore();
  }
}

export class Rain {
  constructor(n = 220) {
    this.drops = Array.from({ length: n }, () => this.spawn(true));
    this.lightning = 0;
    this.nextBolt = 6 + Math.random() * 10;
  }
  spawn(anywhere) {
    return { x: Math.random() * 1.3 - 0.15, y: anywhere ? Math.random() : -Math.random() * 0.2, z: 0.3 + Math.random() * 0.7 };
  }
  update(dt, onBolt) {
    for (const d of this.drops) {
      d.y += dt * (0.9 + d.z * 1.4);
      d.x -= dt * 0.12 * d.z;
      if (d.y > 1.05) Object.assign(d, this.spawn(false));
    }
    this.lightning = Math.max(0, this.lightning - dt * 2.5);
    this.nextBolt -= dt;
    if (this.nextBolt < 0) {
      this.lightning = 1;
      this.nextBolt = 8 + Math.random() * 16;
      onBolt && onBolt();
    }
  }
  draw(g, alpha = 0.55) {
    const c = g.ctx, W = g.W, H = g.H;
    c.save();
    c.strokeStyle = '#7fb8ff';
    c.lineCap = 'round';
    for (const d of this.drops) {
      c.globalAlpha = alpha * d.z * 0.6;
      c.lineWidth = d.z * 1.4;
      c.beginPath();
      c.moveTo(d.x * W, d.y * H);
      c.lineTo(d.x * W + 4 * d.z, d.y * H - 26 * d.z);
      c.stroke();
    }
    if (this.lightning > 0) {
      c.globalAlpha = this.lightning * this.lightning * 0.35;
      c.fillStyle = '#b8c8ff';
      c.fillRect(0, 0, W, H);
    }
    c.restore();
  }
}

export function loadImage(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}
