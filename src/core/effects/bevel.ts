/*
  The 3D effects' shared lighting (Psp.exe 0x4897a0) and Image > Effects > Inner Bevel and
  Outer Bevel (0x444600, 0x4452a0; DIALOGs 477, 496); docs/PSP_EXE_ANALYSIS.md section 8.

  A height map one pixel larger than the image on every side is lit by a light from `angle`
  and `elevation`: diffuse from the surface normal (left-minus-right and below-minus-above
  sums of the 3 x 3 heights, and a depth term 1530/depth), Blinn-Phong highlights from a
  shininess power table, the image scaled by the ambience, all in PSP's integer steps.
*/
import { cloneRaster, maskBounds, type Mask, type Raster } from "../image/raster.ts";
import { gaussianPlane } from "../filters/filters.ts";

export interface Light {
  /** Degrees. */
  angle: number;
  elevation: number;
  color: readonly [number, number, number];
  /** 1..100. */
  intensity: number;
  /** −100..100. */
  ambience: number;
  /** 1..100. */
  depth: number;
  /** 0..100. */
  shininess: number;
}

export const LIGHT_DEFAULTS: Light = { angle: 315, elevation: 30, color: [255, 255, 255], intensity: 50, ambience: 0, depth: 20, shininess: 0 };

const DEG = 0.017453292519943295;

/** The shininess power table (0x92fbc4). */
export function shininessTable(shininess: number): Int32Array {
  const s = Math.max(0, Math.min(100, Math.trunc(shininess))) * 0.01;
  const n = Math.pow(2, (1 - s) * 7.6) + 6;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.trunc(Math.pow(i / 256, n) * s * 255.9);
  return t;
}

/**
  Light `image` from `height` ((W + 2) x (H + 2), the image's pixel (x, y) at (x + 1, y + 1)).
  `mask` (canvas-sized, or null for everything) limits and fades the result; pixels within
  `border` of the image's edges get the flat lighting.
*/
export function lightSurface(image: Raster, height: Uint8Array, L: Light, mask: Uint8Array | null, rect?: { minX: number; minY: number; maxX: number; maxY: number }, border = 0): Raster {
  const { width: W, height: H, data: s } = image;
  const out = cloneRaster(image), d = out.data, HW = W + 2;
  const A = Math.trunc(L.angle) * DEG, E = Math.trunc(L.elevation) * DEG;
  const LX = Math.trunc(Math.sin(A) * Math.cos(E) * 255.9), LY = Math.trunc(Math.cos(A) * Math.cos(E) * 255.9), LZ = Math.trunc(Math.sin(E) * 255.9);
  const k = 255.9 / Math.sqrt((LZ + 256) * (LZ + 256) + LX * LX + LY * LY);
  const HX = Math.trunc(LX * k), HY = Math.trunc(LY * k), HZ = Math.trunc((LZ + 256) * k);
  const I = Math.trunc((Math.trunc((Math.trunc(L.intensity) * 1024 - 1024) / 99) * 103) / 100);
  const col = [(L.color[0] * I) >> 8, (L.color[1] * I) >> 8, (L.color[2] * I) >> 8];
  const depth = Math.max(1, Math.trunc(L.depth));
  const Z = Math.trunc(1530 / (Math.trunc((depth * 99 - 99) / 99) + 1)), Z2 = Z * Z;
  const amb = Math.trunc(((Math.trunc(L.ambience) + 100) * 512) / 200);
  const table = shininessTable(L.shininess), flatSpec = table[Math.max(0, Math.min(255, HZ))];
  const r = rect ?? { minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 };
  const h = (x: number, y: number) => height[(y + 1) * HW + x + 1];
  const v = [0, 0, 0];
  for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) {
    const m = mask ? mask[y * W + x] : 255;
    if (!m) continue;
    const o = (y * W + x) * 4;
    const dx = h(x - 1, y - 1) + h(x - 1, y) + h(x - 1, y + 1) - h(x + 1, y - 1) - h(x + 1, y) - h(x + 1, y + 1);
    // PSP reads these through its top-down DibIterator (0x52de50): below minus above.
    const dy = h(x - 1, y + 1) + h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - h(x, y - 1) - h(x + 1, y - 1);
    const p = [(s[o] * amb) >> 8, (s[o + 1] * amb) >> 8, (s[o + 2] * amb) >> 8];
    if (x < border || x > W - border - 1 || y < border || y > H - border - 1 || (dx * dx < 10 && dy * dy < 10)) {
      for (let c = 0; c < 3; c++) v[c] = ((p[c] * ((col[c] * LZ) >> 8)) >> 8) + ((flatSpec * col[c]) >> 8);
    } else if (dy * LY + dx * LX + Z * LZ < 0) {
      v[0] = v[1] = v[2] = 0;
    } else {
      const n = 1 / Math.sqrt(dx * dx + dy * dy + Z2);
      const diff = Math.trunc((dx * LX + dy * LY + Z * LZ) * n);
      const si = table[Math.max(0, Math.min(255, Math.trunc((dx * HX + dy * HY + Z * HZ) * n)))];
      for (let c = 0; c < 3; c++) v[c] = ((((diff * col[c]) >> 8) * p[c]) >> 8) + (si ? (si * col[c]) >> 8 : 0);
    }
    for (let c = 0; c < 3; c++) {
      const val = v[c] > 255 ? 255 : v[c];
      d[o + c] = m === 255 ? val : (((val & 0xff) * m + (255 - m) * s[o + c]) * 0x101 + 0x8000) >>> 16;
    }
  }
  return out;
}

/* The 12 bevel shapes (0x4439a0..0x443ee0): t in 0..1, scaled by s. */
export const BEVEL_SHAPES: ((t: number, s: number) => number)[] = [
  (t, s) => t * s,
  (t, s) => Math.sqrt(1 - (1 - t) * (1 - t)) * s,
  (t, s) => { if (t === 0) return 0; if (t < 0.4) return s * 0.4; const f = 1 - (t - 0.4) * 1.6666666666666667; return (Math.sqrt(1 - f * f) * 0.6 + 0.4) * s; },
  (t, s) => { if (t === 0) return 0; if (t < 0.3) return s * 0.2; if (t > 0.7) return s; const f = 1 - (t - 0.3) * 2.5; return (Math.sqrt(1 - f * f) * 0.6 + 0.2) * s; },
  (t, s) => { if (t > 0.2) return s; if (t === 0) return 0; const c = Math.cos(Math.PI * t * 1.25), sg = c >= 0 ? 1 : -1; return ((0.5 - Math.pow(c * sg, 0.75) * sg * 0.5) * 0.8 + 0.2) * s; },
  (t, s) => { if (t === 0) return 0; if (t < 0.2) return s * 0.2; if (t > 0.8) return s * 0.6; if (t > 0.6) return s; const f = 1 - (t - 0.2) * 2.5; return (Math.sqrt(1 - f * f) * 0.4 + 0.2) * s; },
  (t, s) => { const a = Math.abs(2 * (t - 0.5)); if (a > 1) return s; return (Math.sqrt(Math.sin(a * Math.PI * 0.5)) * 0.7 + 0.3) * s; },
  (t, s) => Math.abs(2 * (t - 0.5)) * s,
  (t, s) => { if (t === 0) return 0; if (t < 0.2) return s * 0.2; if (t > 0.8) return s; const f = (t - 0.2) * 1.6666666666666667; return (f * f * 0.8 + 0.2) * s; },
  (t, s) => { if (t < 0.3) return s * 0.2; const f = (t - 0.3) * 1.4285714285714286; return (Math.sqrt(1 - f * f) * 0.8 + 0.2) * s; },
  (t, s) => { if (1 - t < 0.3) return s * 0.2; const f = (1 - t - 0.3) * 1.4285714285714286; return (Math.sqrt(1 - f * f) * 0.8 + 0.2) * s; },
  (t, s) => { let f: number; if (t >= 0.3) { f = 1 - t; if (f >= 0.3) return s; } else f = t; return f * 3.3333333333333335 * s * 0.5; },
];

/* The profile table (0x445020): entry 0 stays 0. */
function profileTable(shape: number): Uint8Array {
  const f = BEVEL_SHAPES[Math.max(0, Math.min(11, Math.trunc(shape)))], t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = Math.max(0, Math.min(255, Math.trunc(f(i * 0.00392156862745098, 255.9))));
  return t;
}

export interface BevelParams extends Light {
  /** 0..11, the Bevel drop-down. */
  bevel: number;
  width: number;
  smoothness: number;
}

export const BEVEL_DEFAULTS: BevelParams = { ...LIGHT_DEFAULTS, bevel: 0, width: 8, smoothness: 0 };

/* Pad a W x H plane by `pad` zeros on every side. */
function padPlane(p: Uint8Array, W: number, H: number, pad: number): Uint8Array<ArrayBuffer> {
  const PW = W + 2 * pad, out = new Uint8Array(PW * (H + 2 * pad));
  for (let y = 0; y < H; y++) out.set(p.subarray(y * W, y * W + W), (y + pad) * PW + pad);
  return out;
}

/* Smooth a profile and give it the one-pixel border the lighting reads (0x444600). */
function heightMap(P: Uint8Array, W: number, H: number, smoothness: number): Uint8Array {
  if (!smoothness) return padPlane(P, W, H, 1);
  const radius = smoothness * 10 * 0.01, r = Math.trunc(radius), pad = r + 1;
  const big = gaussianPlane(padPlane(P, W, H, pad), W + 2 * pad, H + 2 * pad, radius);
  const BW = W + 2 * pad, out = new Uint8Array((W + 2) * (H + 2));
  for (let y = 0; y < H + 2; y++) out.set(big.subarray((y + r) * BW + r, (y + r) * BW + r + W + 2), y * (W + 2));
  return out;
}

/** Inner Bevel. `shape` is the selection or, without one, the layer's transparency. */
export function innerBevel(image: Raster, shape: Mask, selection: Mask | null, p: BevelParams): Raster {
  const { width: W, height: H } = image, sd = shape.data;
  const w = Math.max(1, Math.trunc(p.width)), w2 = w * w, scale = 255.9 / w;
  const tab = new Uint8Array(256);
  for (let i = 0; i < 256; i++) tab[i] = Math.min(255, Math.trunc(Math.sqrt(i) * scale));
  const D = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!sd[y * W + x]) continue;
    let best = w2;
    let x0 = x - w, x1 = x + w, y0 = y - w, y1 = y + w;
    if (x0 < 0) { best = Math.min(best, (x + 1) * (x + 1)); x0 = 0; }
    if (x1 >= W) { best = Math.min(best, (W - x) * (W - x)); x1 = W - 1; }
    if (y0 < 0) { best = Math.min(best, (y + 1) * (y + 1)); y0 = 0; }
    if (y1 >= H) { best = Math.min(best, (H - y) * (H - y)); y1 = H - 1; }
    if (best > 1) {
      scan: for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
        if (sd[yy * W + xx]) continue;
        const dd = (yy - y) * (yy - y) + (xx - x) * (xx - x);
        if (dd < best) { best = dd; if (dd === 1) break scan; }
      }
    }
    D[y * W + x] = best < 256 ? tab[best] : Math.min(255, Math.trunc(Math.sqrt(best) * scale));
  }
  const Db = gaussianPlane(D, W, H, 1);
  const prof = profileTable(p.bevel), P = new Uint8Array(W * H);
  for (let i = 0; i < P.length; i++) P[i] = prof[Db[i]];
  return lightSurface(image, heightMap(P, W, H, p.smoothness), p, selection ? selection.data : null);
}

/** Outer Bevel: the band outside the shape, faded by its distance. */
export function outerBevel(image: Raster, shape: Mask, p: BevelParams): Raster {
  const { width: W, height: H } = image, sd = shape.data;
  const b = maskBounds(shape);
  if (!b) return cloneRaster(image);
  const w = Math.max(1, Math.trunc(p.width)), scale = 255.9 / w;
  const R = { minX: Math.max(0, b.minX - 2 * w), minY: Math.max(0, b.minY - 2 * w), maxX: Math.min(W - 1, b.maxX + 2 * w), maxY: Math.min(H - 1, b.maxY + 2 * w) };
  // The distance map over the whole canvas (PSP keeps it to R and one pixel around).
  const O = new Uint8Array(W * H);
  for (let y = Math.max(0, R.minY - 1); y <= Math.min(H - 1, R.maxY + 1); y++) for (let x = Math.max(0, R.minX - 1); x <= Math.min(W - 1, R.maxX + 1); x++) {
    if (sd[y * W + x]) { O[y * W + x] = 255; continue; }
    let best = w * w + 1;
    for (let yy = Math.max(0, y - w); yy < Math.min(H, y + w); yy++) for (let xx = Math.max(0, x - w); xx < Math.min(W, x + w); xx++) {
      if (!sd[yy * W + xx]) continue;
      const dd = (yy - y) * (yy - y) + (xx - x) * (xx - x);
      if (dd < best) best = dd;
    }
    if (best !== w * w + 1) O[y * W + x] = (255 - Math.min(255, Math.trunc(Math.sqrt(best) * scale))) & 0xff;
  }
  const prof = profileTable(p.bevel);
  let P: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < P.length; i++) P[i] = prof[O[i]];
  if (p.smoothness > 0) P = gaussianPlane(P as Uint8Array<ArrayBuffer>, W, H, p.smoothness * 10 * 0.01);
  return lightSurface(image, padPlane(P, W, H, 1), p, O, R);
}
