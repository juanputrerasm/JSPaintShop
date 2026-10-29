/*
  Image > Deformations > Twirl (Psp.exe 0x7cd960; docs/PSP_EXE_ANALYSIS.md section 9).
  In coordinates u = x·2/(W−1) − 1, v = 1 − y·2/(H−1), points inside the unit circle (ρ < 1)
  turn by (1 − ρ)²·(−degrees·π/180) added to atan2(u, v); the source is
  ((sin θ·ρ + 1)·(W−1)/2, (1 − cos θ·ρ)·(H−1)/2) in 8.8 fixed point, sampled bilinearly,
  black past the edges (mode 3). Default 180°. π is 3.14159…
*/
import { cloneRaster, type Raster } from "../image/raster.ts";
import { sampleBilinear } from "../effects/sample.ts";

export function twirl(src: Raster, degrees: number): Raster {
  const { width: W, height: H } = src;
  const out = cloneRaster(src);
  if (!Math.trunc(degrees) || W < 2 || H < 2) return out;
  const k = -Math.trunc(degrees) * Math.PI * 0.005555555555555556;
  const gx = 2 / (W - 1), gy = 2 / (H - 1), hx = 1 / gx, hy = 1 / gy;
  for (let y = 0; y < H; y++) {
    const v = 1 - y * gy;
    for (let x = 0; x < W; x++) {
      const u = x * gx - 1, rho = Math.sqrt(u * u + v * v);
      if (rho >= 1) continue;
      const t = 1 - rho, th = Math.atan2(u, v) + t * t * k;
      sampleBilinear(src, Math.trunc((Math.sin(th) * rho + 1) * hx * 256), Math.trunc((1 - Math.cos(th) * rho) * hy * 256), out.data, (y * W + x) * 4, 3);
    }
  }
  return out;
}
