/*
  PSP 6's 17 layer blend modes, in its own order (BLEND_MODES in image-doc.ts), computed as
  PSP's layer library computes them: integer tables for x·y/255 and for fixed-point division,
  the same mixing steps, the same rounding. docs/PSP_EXE_ANALYSIS.md section 2 has the facts
  (Psp.exe 0x81e110 picks a mode's routine; 0x824d40 builds the tables).

  Hue, Saturation, Color and Luminance work in PSP's hue/chroma/luma space (Psp.exe 0x7ec8d0
  and 0x7eca00), not in HSL.
*/

export const Blend = {
  Normal: 0, Darken: 1, Lighten: 2, Hue: 3, Saturation: 4, Color: 5, Luminance: 6, Multiply: 7, Screen: 8,
  Dissolve: 9, Overlay: 10, HardLight: 11, SoftLight: 12, Difference: 13, Dodge: 14, Burn: 15, Exclusion: 16,
} as const;

/** MUL[i] = round(i / 255) for i up to 255·255: every x·y/255 and every 255-weighted mix. */
export const MUL = new Uint8Array(65026);
for (let i = 0; i < MUL.length; i++) MUL[i] = Math.floor((i + 128) / 255);

/** DIV[i·256 + j] = i/j in 16.16 fixed point, rounded. */
const DIV = new Int32Array(256 * 256);
for (let i = 0; i < 256; i++) for (let j = 1; j < 256; j++) DIV[i * 256 + j] = Math.floor((Math.floor(j / 2) + i * 65536) / j);

const SQRT = new Uint8Array(256);
for (let i = 0; i < 256; i++) SQRT[i] = Math.trunc(Math.sqrt(i / 255) * 255);

/* Dissolve's pattern: MSVC's rand() from seed 1, modulo 254, 128 x 128. */
export const NOISE = new Uint8Array(128 * 128);
{
  let seed = 1;
  for (let i = 0; i < NOISE.length; i++) {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    NOISE[i] = ((seed >>> 16) & 0x7fff) % 254;
  }
}

// ---- Hue, chroma, luma (channels x16; hue 0..4080, -1 for greys) ----

const hcy = [0, 0, 0];

export function toHcy(r: number, g: number, b: number, out = hcy): number[] {
  const R = r * 16, G = g * 16, B = b * 16;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), c = max - min;
  out[2] = Math.trunc((r * 4800 + g * 9440 + b * 1760) / 1000);
  out[1] = c;
  if (c === 0) out[0] = -1;
  else if (R === max) out[0] = Math.trunc(((G - B) * 680) / c) + (G < B ? 4080 : 0);
  else if (G === max) out[0] = Math.trunc(((B - R) * 680) / c) + 1360;
  else out[0] = Math.trunc(((R - G) * 680) / c) + 2720;
  return out;
}

const rgb = [0, 0, 0];

export function fromHcy(h: number, c: number, y: number, out = rgb): number[] {
  if (c === 0 || h < 0) { out[0] = out[1] = out[2] = (y + 8) >> 4; return out; }
  const rem = h % 680, up = Math.trunc((rem * c) / 680), down = Math.trunc(((680 - rem) * c) / 680);
  let R = 0, G = 0, B = 0;
  switch (Math.trunc(h / 680)) {
    case 0: R = c; G = up; break;
    case 1: R = down; G = c; break;
    case 2: G = c; B = up; break;
    case 3: G = down; B = c; break;
    case 4: R = up; B = c; break;
    case 5: R = c; B = down; break;
  }
  const y0 = Math.trunc((R * 300 + G * 590 + B * 110) / 1000);
  if (y < y0) {
    R = Math.trunc((R * y) / y0); G = Math.trunc((G * y) / y0); B = Math.trunc((B * y) / y0);
  } else {
    R += y - y0; G += y - y0; B += y - y0;
    const max = Math.max(R, G, B);
    if (max > 4080) {
      const span = max - y, room = 4080 - y, base = y - Math.trunc((room * y) / span);
      R = Math.trunc((room * R) / span) + base; G = Math.trunc((room * G) / span) + base; B = Math.trunc((room * B) / span) + base;
    }
  }
  out[0] = (R + 8) >> 4; out[1] = (G + 8) >> 4; out[2] = (B + 8) >> 4;
  return out;
}

const hs = [0, 0, 0], hd = [0, 0, 0], tmp = [0, 0, 0];

/* The separable modes' value for one channel. */
function channel(mode: number, s: number, d: number): number {
  switch (mode) {
    case Blend.Darken: return Math.min(s, d);
    case Blend.Lighten: return Math.max(s, d);
    case Blend.Multiply: return MUL[s * d];
    case Blend.Screen: return 255 - MUL[(255 - s) * (255 - d)];
    case Blend.Overlay: return d < 128 ? (d * s) >> 7 : 255 - (((255 - d) * (255 - s)) >> 7);
    case Blend.HardLight: return s < 128 ? (d * s) >> 7 : 255 - (((255 - d) * (255 - s)) >> 7);
    case Blend.Exclusion: return MUL[(255 - d) * s + (255 - s) * d];
    default: return s;
  }
}

/*
  Composite one pixel of a layer over the destination at offset `di` of `d`: source color
  (sr, sg, sb), source alpha `sa` (0..255, the layer mask already applied), layer opacity `a`
  (0..255), canvas position (x, y) for Dissolve. With `lockAlpha` the destination's alpha is
  kept.
*/
export function blendPixel(d: Uint8ClampedArray, di: number, mode: number, sr: number, sg: number, sb: number, sa: number, a: number, x: number, y: number, lockAlpha = false): void {
  const da = d[di + 3];
  if (mode === Blend.Dissolve) {
    const e = MUL[sa * a];
    const oa = MUL[(255 - da) * e] + da;
    if (e !== 0 && oa !== 0 && NOISE[(y & 127) * 128 + (x & 127)] <= e) {
      d[di] = sr; d[di + 1] = sg; d[di + 2] = sb;
      if (!lockAlpha) d[di + 3] = 255;
    }
    return;
  }
  const se = MUL[sa * a];
  if (se === 0) return;
  const oa = MUL[(255 - da) * se] + da;
  const f = DIV[se * 256 + oa], g = 65536 - f;
  const dr = d[di], dg = d[di + 1], db = d[di + 2];

  if (mode === Blend.Normal) {
    d[di] = (dr * g + 0x8000 + sr * f) >> 16;
    d[di + 1] = (dg * g + 0x8000 + sg * f) >> 16;
    d[di + 2] = (db * g + 0x8000 + sb * f) >> 16;
  } else if (mode === Blend.Dodge || mode === Blend.Burn) {
    const k = Math.trunc((da * 255) / oa);
    const s3 = [sr, sg, sb];
    for (let c = 0; c < 3; c++) {
      const dv = d[di + c];
      if (mode === Blend.Dodge) {
        const s1 = MUL[s3[c] * se];
        d[di + c] = dv * k === 0 ? 0 : s1 === 255 ? 255 : Math.min(255, Math.trunc((dv * k) / (255 - s1)));
      } else {
        const u = (255 - dv) * k, v = MUL[(255 - s3[c]) * se];
        if (u === 0) d[di + c] = 255;
        else if (v === 255) d[di + c] = 0;
        else { const q = Math.trunc(u / (255 - v)); d[di + c] = q > 255 ? 0 : 255 - q; }
      }
    }
  } else if (mode === Blend.SoftLight) {
    const s3 = [sr, sg, sb];
    for (let c = 0; c < 3; c++) {
      const dv = d[di + c], sv = s3[c];
      const dp = MUL[32640 + (dv - 128) * da];
      const X = sv <= 128 ? (255 - 2 * sv) * MUL[dp * dp] + 2 * dp * sv : 2 * (SQRT[dp] * (sv - 128) + (255 - sv) * dp);
      d[di + c] = (MUL[X] * f + dv * g) >> 16;
    }
  } else if (mode === Blend.Luminance) {
    if (da === 0) { d[di] = sr; d[di + 1] = sg; d[di + 2] = sb; }
    else {
      const t = MUL[(255 - da) * se], gm = DIV[t * 256 + t + da], gn = 65536 - gm;
      toHcy(dr, dg, db, hd);
      const yd = hd[2];
      toHcy((sr * gm + 0x8000 + dr * gn) >> 16, (sg * gm + 0x8000 + dg * gn) >> 16, (sb * gm + 0x8000 + db * gn) >> 16, hs);
      const hm = hs[0], cm = hs[1];
      toHcy(sr, sg, sb, tmp);
      const u = MUL[(255 - se) * da];
      const yy = Math.trunc((u * yd + tmp[2] * se) / (se + u));
      fromHcy(hm, cm, yy, tmp);
      d[di] = tmp[0]; d[di + 1] = tmp[1]; d[di + 2] = tmp[2];
    }
  } else {
    let br: number, bg: number, bb: number;
    let mr: number, mg: number, mb: number;
    if (mode === Blend.Difference) {
      mr = Math.abs(dr - MUL[sr * a]); mg = Math.abs(dg - MUL[sg * a]); mb = Math.abs(db - MUL[sb * a]);
    } else {
      if (mode === Blend.Hue || mode === Blend.Saturation || mode === Blend.Color) {
        toHcy(sr, sg, sb, hs);
        toHcy(dr, dg, db, hd);
        const h = mode === Blend.Saturation ? hd[0] : hs[0];
        const c = mode === Blend.Hue ? hd[1] : hs[1];
        fromHcy(h, c, hd[2], tmp);
        br = tmp[0]; bg = tmp[1]; bb = tmp[2];
      } else {
        br = channel(mode, sr, dr); bg = channel(mode, sg, dg); bb = channel(mode, sb, db);
      }
      mr = MUL[dr * (255 - a) + br * a]; mg = MUL[dg * (255 - a) + bg * a]; mb = MUL[db * (255 - a) + bb * a];
    }
    let pr = sr, pg = sg, pb = sb, qr = dr, qg = dg, qb = db;
    if (da !== 0) {
      pr = MUL[sr * (255 - da) + mr * da]; pg = MUL[sg * (255 - da) + mg * da]; pb = MUL[sb * (255 - da) + mb * da];
      qr = MUL[dr * (255 - sa) + mr * sa]; qg = MUL[dg * (255 - sa) + mg * sa]; qb = MUL[db * (255 - sa) + mb * sa];
    }
    d[di] = (qr * g + 0x8000 + pr * f) >> 16;
    d[di + 1] = (qg * g + 0x8000 + pg * f) >> 16;
    d[di + 2] = (qb * g + 0x8000 + pb * f) >> 16;
  }
  if (!lockAlpha) d[di + 3] = oa;
}

/** Blend with a coverage 0..1 (brushes, fills): the layer opacity is the coverage. */
export function blendCover(d: Uint8ClampedArray, di: number, mode: number, r: number, g: number, b: number, alpha: number, cover: number, x: number, y: number, lockAlpha = false): void {
  blendPixel(d, di, mode, r, g, b, alpha, Math.round(cover * 255), x, y, lockAlpha);
}
