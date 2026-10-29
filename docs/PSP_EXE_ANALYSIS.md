# Psp.exe analysis

Facts about PSP 6.02's `Psp.exe` (FileVersion 6.02 Evaluation), read with Ghidra through `tools/re/` (see its README). JSPaintShop's code is written from this document. Addresses are the functions' entry points in `Psp.exe` (image base 0x400000); calls go through 5-byte jump thunks at 0x401000-0x411fff.

Only facts, formulas, constants and orders of operations are written here, never decompiled code.

## 1. How commands run

- Every image command is an object (that is what Edit > Command History lists). A registration function fills `{command id, script name, factory}`; `tools/re/commands.py` lists them all (`re/out/commands.tsv`). Script names are PSP's own: `Button` (Buttonize, 33050), `AdjBright` (Brightness/Contrast, 32908), `LayerMergeVisible` (33651), `SetProperty` (39013)...
- The filters, deformations and effects (ids 33005-33079) share one WM_COMMAND range handler (0x720920), which looks the id up in the command table and runs the object (0x6fc610): vtable slot 5 (+0x14) runs it and returns 0 (done) or 100 (cancelled).
- In an effect's class, vtable slot 15 shows its dialog and slot 16 calls the effect's pixel routine with the dialog values. The Effect Browser (0x5c5fd0) calls those pixel routines directly, with each effect's browser preview values.
- The factory sets the defaults; e.g. Buttonize: height 20, width 20, opacity 75, solid edge.

## 2. Layer blending (PSP's JLayer library, 0x81e000-0x825000)

### Tables (built once, 0x824d40)

- `MUL[i] = (i + 128) / 255` (integer division) for i in 0..65025: every "x·y/255" and every two-term mix `(a·x + b·y)/255` with a + b = 255 is a lookup `MUL[a·x + b·y]`.
- `DIV[i][j] = (j/2 + i·65536) / j` (integer) for i 0..255, j 1..255: i/j in 16.16 fixed point.
- `SQRT[i] = trunc(√(i/255) · 255)` for i 0..255 (Soft Light).
- `NOISE[y][x]`, 128 x 128: `srand(1)`, then `rand() % 254` row by row (MSVC `rand`: seed = seed·214013 + 2531011, value = (seed >> 16) & 0x7fff). Dissolve reads `NOISE[y & 127][x & 127]` at canvas coordinates.

### Per pixel

`s` source channel, `d` destination channel, `sa` source alpha (with the layer mask), `da` destination alpha, `a` the layer opacity (0..255; the blend ranges multiply into it when set, 0x81e320).

- `se = MUL[sa·a]`, skipped when 0.
- `oa = MUL[(255 − da)·se] + da` (the new destination alpha, written unless the destination's alpha is locked).
- `f = DIV[se][oa]`.
- **Normal**: `out = (d·(65536 − f) + s·f + 0x8000) >> 16`.
- **Separable modes** (Darken, Lighten, Multiply, Screen, Overlay, Hard Light, Exclusion), with `B` the mode's value:
  - `m = MUL[d·(255 − a) + B·a]`
  - if `da = 0`: `P = s`, `Q = d`; else `P = MUL[s·(255 − da) + m·da]`, `Q = MUL[d·(255 − sa) + m·sa]`
  - `out = (Q·(65536 − f) + P·f + 0x8000) >> 16`
  - Darken `min(s, d)`; Lighten `max(s, d)`; Multiply `MUL[s·d]`; Screen `255 − MUL[(255 − s)(255 − d)]`;
    Overlay `d < 128 ? (d·s) >> 7 : 255 − (((255 − d)(255 − s)) >> 7)`; Hard Light the same with s and d swapped (the test is on s);
    Exclusion `MUL[(255 − d)·s + (255 − s)·d]`.
- **Difference**: `m = |d − MUL[s·a]|` (opacity scales the source first; no `m` mix), then P, Q and out as above.
- **Dodge**: `k = da·255 / oa` (integer), `s' = MUL[s·se]`; `out = d·k = 0 ? 0 : s' = 255 ? 255 : min(255, d·k / (255 − s'))`.
- **Burn**: `k` as Dodge, `u = (255 − d)·k`, `v = MUL[(255 − s)·se]`; `out = u = 0 ? 255 : v = 255 ? 0 : (u / (255 − v) > 255 ? 0 : 255 − u / (255 − v))`.
- **Soft Light**: `d' = MUL[32640 + (d − 128)·da]` (the base pulled toward 128 where it is clear); `X = s ≤ 128 ? (255 − 2s)·MUL[d'·d'] + 2·d'·s : 2·(SQRT[d']·(s − 128) + (255 − s)·d')`; `out = (MUL[X]·f + d·(65536 − f)) >> 16` (no rounding term).
- **Dissolve**: `e = MUL[sa·a]`; when `NOISE ≤ e`, `e ≠ 0` and `oa ≠ 0`, the pixel becomes the source color with alpha 255; otherwise it is left alone.
- **Hue, Saturation, Color** work in PSP's hue/chroma/luma space (below): Hue takes the source's hue with the destination's chroma and luma; Saturation the source's chroma; Color the source's hue and chroma with the destination's luma. The result is `B`, mixed as the separable modes are.
- **Luminance**: if `da = 0` the destination takes the source color. Else `t = MUL[(255 − da)·se]`, `g = DIV[t][t + da]`; the mixed color `M = d + (s − d)·g` (16.16, rounded) gives hue and chroma; luma `Y = (u·Yd + Ys·se) / (se + u)` with `u = MUL[(255 − se)·da]`; out = that hue, chroma and luma. Alpha becomes `MUL[(255 − da)·se] + da`.

### Hue, chroma, luma (0x7ec8d0 and 0x7eca00)

Channels are scaled by 16.

- `Y = (R·4800 + G·9440 + B·1760) / 1000` (0.30, 0.59, 0.11, ×16); `C = max − min` (×16); hue on 0..4080 (sector 1360, slope 680), `−1` when C = 0:
  max R: `(G − B)·680 / C`, plus 4080 when G < B; max G: `(B − R)·680/C + 1360`; max B: `(R − G)·680/C + 2720` (all ×16 values).
- Back: grey `(Y + 8) >> 4` when C = 0 or hue < 0. Else with `r = hue % 680`, `up = r·C/680`, `down = (680 − r)·C/680`, by sector `hue / 680`: 0 (R C, G up, B 0), 1 (R down, G C, B 0), 2 (R 0, G C, B up), 3 (R 0, G down, B C), 4 (R up, G 0, B C), 5 (R C, G 0, B down). Then `y0 = (R·300 + G·590 + B·110)/1000`: if `Y < y0` scale all by `Y/y0`; else add `Y − y0` to each and, if the largest exceeds 4080, pull them toward Y so it is 4080. Each channel `(v + 8) >> 4`.

## 3. Colors menu

All of these are tables over 0..255 unless said otherwise; "trunc" is C's float-to-int truncation (`_ftol`).

- **Grey Scale** (`Greyscale`, 0x801df0): `(30R + 59G + 11B) / 100`, integer. PSP's luminance everywhere (blend ranges too).
- **Negative Image**: `255 − v` (`InvertDIB`).
- **Brightness/Contrast** (`AdjBright`, 0x7fd5a0), brightness b, contrast c in −100..100:
  - c ≥ 0: `k = trunc(c·127/100)`, `hi = 255 − k`; `T[0..k] = 0`; for j = k+1 .. hi−1, `T[j] = trunc(v)` with v starting at 0 and growing by `255/(hi − k)` each step; `T[hi..255] = 255`; result `T[clamp(i + b)]`. (At c = 0 this maps j to j − 1 for 1 ≤ j ≤ 254, as PSP does.)
  - c < 0: `k = trunc(−c·127/100)`; result `clamp(trunc(k + 1 + i·(255 − 2k)/255) + b)`.
- **Gamma Correction** (`AdjGamma`, 0x7ff7b0), per channel g (≥ 0.0001): `trunc(i^(1/g) · 255 / 255^(1/g) + 0.5)`.
- **Highlight/Midtone/Shadow** (`AdjHighlight`, 0x7fe4d0, DIALOG 27095):
  - Linear (highlight H%, midtone M, shadow S%; defaults 100, 50, 0), per channel: `h = trunc(H·255/100)`, `T[0] = 0`, `T[i] = i < h ? trunc(i·256/h) : 255`; then for i 1..254 with 96 < T[i] < 160, `T[i] = clamp(T[i] − 50 + M)`; then `s = trunc(S·255/100)`, for i 1..254 `T[i] = T[i] < s ? 0 : trunc((T[i] − s)·256/(256 − s))`.
  - Dynamic (each −100..100), on PSP-HSL lightness: Lmin and Lmax over the image (nothing happens when they are less than 9 apart); `mid = (Lmin + Lmax)/2`, `w = (Lmax − mid)/2`, bump(d, amount) = `trunc(amount · 4^(−d²/w²))`; `T[L] = clamp(L + bump(mid − L, M) + bump(Lmin − L, S) + bump(Lmax − L, H))` for L in Lmin..Lmax; a pixel whose new lightness is 0 or 255 loses its saturation.
- **Hue/Saturation/Lightness** (`AdjHue`, 0x7fdb60), each −100..100, in PSP HSL (0..255 each, 0x7ebde0/0x7ebf50): `H' = (H + trunc(h·255/100))` wrapped by ±255; `S' = clamp(S + trunc(S·s/100))`; `L' = clamp(L + trunc(L·l/100))`.
- **Hue Map** (`HueMap`, 0x6acee0): degrees `d = trunc(H·359/255)`; `u = d + 18` (`d − 342` past 359); ten bands of 36°, band `u/36`; `d' = d + map[band] − band·36`, wrapped to 0..359; `S' = clamp(S + (s·255 + 50)/100)`, `L' = clamp(L + (l·255 + 50)/100)`; `H' = d'·255/359`.
- **Red/Green/Blue** (`AdjRGB`, 0x7ff370), each −100..100: `clamp(v + trunc(v·p/100))` (proportional).
- **Colorize** (`Colorize`, 0x7fe0d0), hue and saturation 0..255: the pixel's PSP-HSL lightness with the given hue and saturation.
- **Posterize** (`Posterize`, 0x7fcc60), levels n: `min(255, trunc(trunc(i / (256/n)) · 255/(n − 1)))`.
- **Solarize** (`Solarize`, 0x7fd070 mode 4), threshold t: `i > t ? 255 − i : i`.
- **Histogram Equalize and Stretch** (0x7ffd10, 0x8009e0) work on luma in YCbCr (×1024, `>> 10`): `Y = (306R + 601G + 117B) >> 10`, `Cr = (512R − 429G − 83B) >> 10`, `Cb = (512B − 339G − 173R) >> 10`; back `R = Y' + (1400·Cr >> 10)`, `G = Y' − (714·Cr >> 10) − (348·Cb >> 10)`, `B = Y' + (1770·Cb >> 10)`, clamped. Only selected pixels are counted.
  - Equalize: `Y' = trunc(cumulative(Y) · 255 / count)` (cumulative includes Y itself).
  - Stretch: Ymin, Ymax over the image; `scale = Ymax > Ymin ? 255/(Ymax − Ymin) : 1`; `Y' = clamp(trunc(Y·scale − Ymin))` (PSP subtracts the minimum after scaling, so the darkest level does not reach 0).

## 4. Image menu geometry

- **Flip, Mirror** (`Mirror` 33001, 0x5f0a30) work on the active layer; with a selection, the selection is floated and flipped in place; a vector layer's objects are mirrored about the canvas centre.
- **Resampling** (jdib library; Psp.exe 0x7f03d0 takes two flags: the first picks bicubic over the box filter, the second the MMX bicubic 0x816170 over 0x80bf20). Each channel, the transparency mask too, is resampled on its own.
  - **Box filter** (RESAMPLE.CPP, 0x7f0900): scale `s = dst/src` per axis; footprint `f = trunc(256/s + 0.5)` (1/256 pixels); output i starts at `pos = i/s`, index `trunc(pos)`, first weight `trunc(256.5 − frac(pos)·256)`, then whole pixels of weight 256 until the footprint is used up (the last pixel gets what is left). Rows the same way; `out = floor(Σ value·wx·wy / (fx·fy))`.
  - **Bicubic** (bicubic.cpp, 0x80bf20): step `trunc(src/dst · 65536)`, positions start at 0 (top-left aligned); four rows then four columns through the cubic convolution with a = −1 on values ×16 in 16.16: `v = ((((((p3 − p2 − p0 + p1)·t >> 16) + 2(p0 − p1) − p3 + p2)·t >> 16) − p0 + p2)·t >> 16) + p1`; result `>> 4`, clamped. Edges: below index 1 the taps are (0, 0, 1, 2); past the end they repeat the last pixel.
  - **MMX bicubic** (bicummx.cpp, 0x816170), what PSP runs on any processor with MMX: the same Horner form in 16-bit words that wrap. Values are bytes ×16 (`punpcklbw` then `psrlw 4`). The fraction is `t = (pos >> 1) & 0x7fff`. Each multiply is `pmulhw(x << 1, t)`, that is `floor(2x·t / 65536)` with `2x` wrapped to 16 bits: `v = (p3 − p0 − p2 + p1)·t`, then `v = v + (p2 − p3) + 2(p0 − p1)`, then `v = v·t + (p2 − p0)`, then `v·t + p1`. Columns of four rows first, then across; the result `psraw 4`, then 255 when above 255 and 0 when not above 0. Taps and steps as in bicubic.cpp.
  - **Pixel resize** (jff.dll `ResizeDIB`, 0x1007d8a0): `S = trunc(dst/src · 10000)` per axis; output index i reads source index `trunc(i·10000 / S)`, rows counted from the bottom (DIB rows).
- **Resize** (command 33101, 0x5ee800; DIALOG 120). The Resize Type list (DLGINIT) is Smart size, Bilinear resample, Bicubic resample, Pixel resize; registry key Resize\ResampleType holds the index.
  - Images that are neither 24-bit nor greyscale: Bilinear and Bicubic give string 23583 ("Resampling is only supported for greyscale images or 24 bit true-color images.") and stop; Smart size and Pixel resize do a pixel resize.
  - Otherwise Pixel resize is `ResizeDIB`; Bilinear is the box filter; Bicubic is bicubic; Smart size takes the percentages `p = new/old · 100` per axis, keeps the one with the larger `|trunc(100 − p)|` (the height on a tie), and uses bicubic when `trunc(p) > 100`, else the box filter.
  - Without Resize All Layers, the active layer's contents (their bounding box) are resized by the image's ratios, `trunc(size · ratio)` at least 1, about their center (0x738b60); the canvas stays.
  - Each layer's color, transparency and layer mask are resized on their own (0x738690 / 0x738940).

## 5. Decrease Color Depth

- The 256-color command (`DecreaseColorTwoFiveSix`, execute 0x4a1010) picks the palette by type (0 median cut 0x7fa9f0, 1 octree 0x692560-0x694660, 2 standard 0x7f7cf0) and the reduction (0 nearest, 1 ordered dither, 2 error diffusion).
- **Median cut** (0x7fa9f0 → 0x7fb7f0): colors counted in 15 bits (`(R & 0xf8) << 7 | (G & 0xf8) << 2 | B >> 3`, counts capped at 0x7fffffff; "boost marked colors" multiplies the counts inside the marked area); at most 256 entries, 236 with "Include Windows colors" (the 20 static colors are added). The distinct colors split recursively:
  - budget 1: the entry is the **unweighted** average of the box's colors, each expanded `c·8 + c/4`;
  - as many colors as budget: one entry each;
  - else sort on the widest channel (ties: red, then green, then blue; the sort key is that channel then the next two in R→G→B→R order), take `half = budget/2`; the left sum starts with the first `half` counts, the right with the last `half`; both move inward by `trunc(gap/8)`; then the smaller side advances until they meet; if the right sum is the smaller, the left takes `budget − half` and the cut is one past the meeting point, else the cut is at it; the cut stays within 1..n−1, the left budget is at most the cut and grows until the right half has enough colors.
- The Windows standard palette (0x7f7cf0): the 16 VGA colors plus (192,220,192), (166,202,240), (255,251,240), (160,160,164).
- **Octree** ("OctTree.cpp"): 0x692560 sets it up (mode 1, the color count, depth 8), 0x693b20 adds the pixels, 0x6927b0 reads the palette out.
  - The pixels go in as the bitmap stores them: bottom row first, left to right.
  - Child index at level L (0-7): bit `7 − L` of red, green and blue, as `r·4 + g·2 + b`. Level 8 nodes are leaves holding a count and the channel sums. A new interior node goes on the front of its level's list.
  - After each pixel, while there are more leaves than colors (0x694480): take the front node of the deepest level 7..1 that has any (level 0 if none); add its children's counts and sums into it; free them; it becomes a leaf.
  - The palette walks the tree children 0..7 in order. Each leaf's color is `sum / count` (integer division).
  - With "Include Windows colors" (at most 236 colors, 0x692980), the palette is moved up by 10: the first 10 static colors go before it and the last 10 after it.
- **Standard / Web-safe:** 0x7f7cf0 builds the 6 × 6 × 6 cube with blue outermost (entry `r + 6g + 36b`, steps of 51). The 40 entries after it stay black, and only the 216 are searched.
- **Mapping** is jdib's 0x7f7cf0 (octree and the standard palette call it directly; median cut through 0x7fa9f0):
  - **Nearest color** (0x7f6360): the smallest squared RGB distance; ties go to the lower index. A cache of 64 cells (the top two bits of each channel), sorted by their distance to the palette, only prunes the search.
  - **Ordered dither** works only on the cube and on the 16 Windows colors:
    - The threshold is a 16 × 16 matrix built from the 4 × 4 Bayer matrix `0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5`: `T[r][c] = trunc((B[r%4][c%4] + B[r/4][c/4]/16) · s + 0.5)`, with s = 3.125 for 256 colors and 15.875 for 16. It is read as `T[x mod 16][bitmap row mod 16]`; bitmap rows count from the bottom.
    - **Cube:** each channel is `floor(v/51)`, plus 1 when `T < v mod 51`.
    - **16 colors**, greys: below 128, black when `v ≤ T/2`, else dark grey (8); from 128, dark grey when `v ≤ T/4 + 128`, else silver (7); from 192, silver when `v < T/4 + 192`, else white. Colors: bit 0 when R > T, bit 1 when G > T, bit 2 when B > T, and 8 when any channel is over 128.
  - **Error diffusion** is Floyd-Steinberg over the rows top down, left to right, with integer shares of each error e:
    - `a = trunc((e + 8)/16)` goes down-right;
    - of the rest `r = e − a`, `b = trunc((2r + 5)/10)` goes down-left;
    - of `r − b`, `c = trunc((5(r − b) + 6)/12)` goes down;
    - and `r − b − c` goes right.

    The error of a pixel is its clamped value minus the chosen color.
  - **Reduce color bleeding** multiplies the percentage by 3/4: the incoming error (from the left and the row above) is `floor(err · 192 / 256)` before the pixel is added.
- The menu command (0x4a1010) passes nearest or error diffusion for median cut and octree, and all three for the standard palette. Boost marked colors applies to median cut only.
- **Palette size.** A paletted DIB always carries `2^bits` entries. A palette with fewer colors (an image with only a few colors, a loaded palette) is padded with black entries. The X Colors command makes a 4-bit image for 16 colors or fewer and an 8-bit one otherwise, as its "(4/8 bit)" label says.
- **When the commands are enabled** (update handler 0x4d88e0, by the DIB's bit count; 32K and 64K images are 24-bit there):
  - 2 colors: more than 1 bit;
  - 16 colors and X colors: 5 bits or more (8 and 24);
  - 256 colors: 24 bits only;
  - 32K and 64K colors: 24 bits;
  - Increase to 16 colors: fewer than 4 bits;
  - Increase to 256 colors: fewer than 8 bits.
- **Increase Color Depth** to 16 or 256 colors ("CmdColorInc.cpp" 0x4a4800 → jdib "INCDEPTH.CPP" 0x7f3d40) keeps every pixel's index. The new palette has `2^bits` entries: the old colors first, then black, because the new block is allocated zeroed (`GMEM_ZEROINIT`).

## 6. Image Arithmetic

Psp.exe 0x48cdd0 (Calculation.cpp): per channel, integer `f(a, b) / divisor + bias`, then clipped to 0..255 when "Clip color values" is on, else wrapped. f: Add `a + b`, Subtract `a − b`, AND, Multiply `a·b` (not scaled), Difference `|a − b|`, OR, Darkest `min`, Lightest `max`, Average `(a + b) / 2`. With single channels chosen the result is greyscale.

## 7. Filters (Image > Blur, Edge, Noise, Sharpen, Other)

PSP's filter routines work on bottom-up 24-bit bitmaps: "the row above" in their code is the image row below. An optional 8-bit mask limits which pixels are sampled (JSPaintShop uses the layer's opacity as that mask).

### Fixed kernels (0x802df0)

One routine takes a filter code, builds `{divisor (short), bias (byte), 5 x 5 shorts}` and runs a 3 x 3 (0x8144a0) or 5 x 5 routine: per channel `clamp(sum / divisor + bias)`, integer division, edges repeated. The 3 x 3 kernels are the top-left of the 5 x 5 table. Kernel row 0 weighs the image row **below** the pixel, row 2 the row above.

| Code | Command | Kernel (rows as stored) | Div | Bias |
|---|---|---|---|---|
| 1 | Emboss | `-1 0 0 / 0 0 0 / 0 0 1` | 1 | 128 |
| 2 | (inverse emboss) | `1 0 0 / 0 0 0 / 0 0 -1` | 1 | 128 |
| 10 | Blur | 5 x 5 `1 1 2 1 1 / 1 2 2 2 1 / 2 2 8 2 2 / 1 2 2 2 1 / 1 1 2 1 1` | 44 | 0 |
| 11 | Blur More | 5 x 5 all 1 | 25 | 0 |
| 20 | Sharpen | `0 -1 0 / -1 10 -1 / 0 -1 0` | 6 | 0 |
| 21 | Sharpen More | 5 x 5 `-1 -1 -1 -1 -1 / -1 -2 -2 -2 -1 / -1 -2 64 -2 -1 / -1 -2 -2 -2 -1 / -1 -1 -1 -1 -1` | 32 | 0 |
| 30 | Soften | `6 12 6 / 12 25 12 / 6 12 6` | 97 | 0 |
| 31 | Soften More | 3 x 3 all 1 | 9 | 0 |
| 40 | Trace Contour | `-1 -1 -1 / -1 9 -1 / -1 -1 -1` | 1 | 255 |
| 50 | Edge Enhance | `0 1 0 / 1 -5 1 / 0 1 0` | -1 | 0 |
| 51 | Edge Enhance More | `-1 -1 -1 / -1 9 -1 / -1 -1 -1` | 1 | 0 |
| 61 | Find Edges | `-1 -1 -1 / -1 8 -1 / -1 -1 -1` | 1 | 0 |
| 62 | Find Horizontal Edges | `-1 -1 -1 / 0 0 0 / 1 1 1` | 1 | 0 |
| 63 | Find Vertical Edges | `-1 0 1 / -1 0 1 / -1 0 1` | 1 | 0 |

Trace Contour's case sets bias 255 and enters Edge Enhance More's case past the line that would reset the bias to 0.

### Gaussian Blur (0x7f21e0, "Gaussian Blur.cpp"), default radius 1.0

- `2r²`; half width `ceil(sqrt(ln 63 · 2r²))`; size `2·half + 1`.
- Weights from the centre: `w0 = 63`, `wi = trunc(63 · exp(−i² / 2r²))`; total `T = w0 + 2 Σ wi`.
- Used radius `p`: the first `i` where the running total reaches `T`, one less if `wp = 0`.
- When `T` is not a power of two: `P` = the next power of two, each weight `floor(w · P/T + 0.5)`; if their total misses `P`, step = ±1 toward it, and a counter that **starts at the kernel size** (not at the difference: a bug in PSP) drives the fix-up: if the difference is odd the centre takes the step and the counter loses it; then `w1, w2, ...` take the step while the counter is not 0, the counter losing 2 steps each; whatever the counter holds at the end goes to the centre. Then `p` drops once more if `wp = 0`, and the divisor is the new total.
- Two passes, vertical then horizontal, each summing `wi` over the line with edges repeated (the weights past an edge are summed onto the edge pixel), divided by a shift when the divisor is a power of two, else integer division; each pass truncates to a byte.

### Unsharp Mask (0x8056b0), defaults radius 2.0, strength 100, clipping 5

The Gaussian above at the radius; per channel where `|orig − blur| ≥ clipping`: `clamp(orig + trunc((orig − blur) · strength / 100))`.

### Motion Blur (0x674ba0, "MotionBlur.cpp"), defaults angle 0, intensity 4

- `a = 450 − angle`; if `a > 360` then `a = 90 − angle`; if `a > 180` then `a −= 180`.
- 8.8 steps: for `a` in 0..89, `cx = trunc(trunc(cos a · 1000) · 256 / 1000)`, `cy` the same with sin; for 91..179 the same on `180 − a` with `cx` negated; 90 gives (0, 256), 180 gives (−256, 0).
- Per pixel: itself, then `k = 1..intensity/2` at `((x << 8) − k·cx) >> 8, ((y << 8) − k·cy) >> 8` and `k = 1..intensity − intensity/2` at `+k`, in bitmap rows (y up), each run stopping at the first sample outside the image; masked-out samples skip. The truncated average is written when anything was counted.

### Add Noise (0x803e10), defaults 50 %, Random

MSVC `rand()`. Random: per pixel `if (rand() & 0x7fff) / 327 < percent`, each of blue, green, red adds `((rand() >> 7) & 255) − 128`. Uniform: every pixel, each channel `trunc((((rand() >> 7) & 255) − 128) · percent / 100)`. Clamped.

### Despeckle (0x808660)

Per channel (bytes at stride 3), edges repeated: `mean = (sum of the 8 neighbours) >> 3`; when `|mean − centre| ≥ 49` the centre becomes the median of the 9 (a sorting network), else it stays.

### Median, Dilate, Erode (0x806200)

Mode 1 median, 2 dilate (max), 0 erode (min) of the 3 x 3 per channel, edges repeated.

### Mosaic (0x805a50), constructor defaults width 1, height 1, symmetric

Width or height 0, or 1 x 1, does nothing. Blocks start at the image's top-left; each is the truncated average of its masked pixels, written over the whole block.

### Hot Wax Coating (0x541350)

- The image to grey (luminance), Gaussian radius 1.0.
- Light `Lx = trunc(cos el · cos az · 255)`, `Ly = trunc(sin az · cos el · 255)`, `Lz = trunc(sin el · 255)` with az = 4.712388981 (270°), el = 1.7453292522 (100°): (0, 44, 251).
- Per pixel on the blurred grey `g`:
  - `dx` = left column minus right column over the three rows;
  - `dy` = the row above minus the row below over the three columns.
  - A missing column is replaced by the pixel's own column in `dx` and left out of `dy`.
  - On the top and bottom rows only the one other row counts, as `other − own`: so `dy` flips sign on the top row.
  - The corner pixels take `dy` = left minus right on their own row.
- Shade: `Lz` when both are 0, else `max(0, trunc((dx·Lx + 30·Lz + dy·Ly) / sqrt(dx² + dy² + 900)))`.
- Each channel becomes `trunc(orig · fg / 255 · shade / 255)`, computed as `orig · fg · shade / 65025` with `fg` the foreground color.

## 8. Effects

The effects get the work bitmap, the selection mask (image + 0x64), the layer's transparency (image + 0x74) and the selection rectangle (image + 0x19c..0x1a8). "Background" and "foreground" are the colors at app + 0xd7 and app + 0xd4 (0x5bbfa0, 0x5bc070). `MUL[n] = trunc((n + 128) / 255)` is JLayer's table (section 2). Opacity percentages become `trunc(percent · 255 / 100)`.

### Drop Shadow (0x53d860), defaults black, opacity 128/255 (50 %), blur 5.0, offsets 10, 10

- Dialog: offsets −100..100, opacity 1..100, blur 0..100 in tenths.
- Shape: the selection mask over its rectangle; with no selection, the layer's transparency over the whole image.
- When blur > 0: the mask grows by `b = trunc(blur + 0.99)` on every side (zeros) and gets the Gaussian of section 7 at `blur / 3`.
- Shadow pixel `s` lands at `rect.left − b + horizontal`, `rect.top − b + vertical` (positive goes right and down): `a = MUL[s · opacity]`; inside the shape's rectangle `a = MUL[(255 − shape) · a]`.
- On a layer without transparency: `c = MUL[a · color + (255 − a) · c]`.
- On a layer with transparency:
  - `A' = A + MUL[(255 − A) · a]`, written unless transparency is locked;
  - `t = (a << 16) / A'`;
  - `c = (c · (65536 − t) + 0x8000 + t · color) >> 16`.

### Cutout (0x53f480), defaults fill on, interior white, shadow black, opacity 128/255, blur 5.0, offsets 10, 10

- The selection mask grows by `max(b, |horizontal|)` sideways and `max(b, |vertical|)` up and down (`b` as above), and is blurred at `blur / 3` when `b > 0`.
- Inside the selection, each pixel samples that mask at its own position minus the offset (`v`).
- `base` is the interior color when filling, else the pixel.
- When `v = 255` the result is `base`; else `k = MUL[(255 − v) · opacity]` and the result is `MUL[k · shadow + (255 − k) · base]`.
- The result is mixed into the pixel by the selection's value (`MUL[res · sel + c · (255 − sel)]`).
- The routine only reads the 24-bit color bitmap and the selection. A layer's transparency is left as it is.

### Buttonize (0x545d80), defaults height 20, width 20, opacity 75, Transparent Edge

- Bands: `w = min(width, W/2)` columns at the sides, `h = min(height, H/2)` rows at the top and bottom.
- Color: the background color `C` and `hf = C >> 1` per channel; `o = opacity byte`, `io = 255 − o`; each band value `v` lands as `MUL[c · io + v · o]`.
- Corners split on a diagonal: `s = trunc(n / f)`.
  - `f = (float)h / (float)w` (single precision);
  - `n` is `y + 1` in the top band and `H − 1 − y` in the bottom band.
- Solid Edge:
  - left `L = trunc(hf(w − x)/w) + trunc(C·x/w)`;
  - right `R = trunc(hf(W − x)/w)`;
  - top row value `trunc(hf(h − n)/h) + trunc(C·n/h)`, used between the corners; `R` from `x ≥ W − s`, the column `W − s` averaging the two;
  - bottom row value `trunc(hf·n/h)`; `L` below `x = s`, the column `s` averaging the two, `R` from `W − s`.
- Transparent Edge (`p` the pixel's channel):
  - left `trunc((hf + trunc(hf·x/w))(w − x)/w) + trunc(p·x/w)`;
  - right `trunc(trunc(hf(W − x)/w)(w − W + x)/w) + trunc(p(W − x)/w)`;
  - top `trunc((hf + trunc(n·hf/h))(h − n)/h) + trunc(n·p/h)`;
  - bottom `trunc(trunc(hf·n/h)(h − n)/h) + trunc(p·n/h)`;
  - the diagonal columns average the neighbouring values the same way.
- The routine only reads the 24-bit color bitmap and the selection. A layer's transparency is left as it is.

### Chisel (0x542330), defaults size 10 (1..100), Background Color

- The shape becomes 0/255: a selection counts above 64, a layer's transparency where nonzero.
- The shape is grown by `size` (zeros), then `size` passes run; in each, a pixel that is not 255 and has a nonzero 8-neighbour maximum `m` becomes `m − trunc(255 / size)`.
- Pixels of that ramp strictly between 0 and 255 are lit:
  - `dx` = left column minus right, `dy` = the row above minus the row below, over the 3 x 3;
  - flat gives 251;
  - else `max(0, trunc((8534 − 31(dx + dy)) / sqrt(dx² + dy² + 1156)))` (light (−31, −31) over 34 · 251).
- Background Color: `c = shade · bg >> 8`; Transparent: `c = c · shade >> 8`.
- **First and last rows of the band:** only the row and its one neighbour count (below for the first, above for the last).
  - The horizontal term covers both rows.
  - The vertical term is the neighbour row's three pixels minus the row's own.
  - In the end columns the vertical term is instead the horizontal difference along the row (`p − p[x+1]` at the left, `p[x−1] − p` at the right). This is PSP's quirk, kept.

### Blinds (0x555c10), defaults width 20, opacity 100, horizontal, light from left/top off, black

- Strips `n = max(width, 2)` wide on whole-image coordinates: the column `x`, or for horizontal blinds the bitmap row (from the image's bottom).
- Phase `k = coord % n`; `o = trunc(opacity·255/100)`.
- Each channel becomes `trunc((trunc(((C·share + p·(n − 1 − share))·o) / (n − 1)) + (255 − o)·p) / 255)`.
- `share` is `n − 1 − k` for vertical blinds lit from the right and for horizontal ones lit from the bottom, `k` for the other two.

### Weave (0x54e5c0), registry keys FillGaps, GapColor, WeaveColor, Gap (25), Weave (75), Opacity

- Period `2(gap + width)` on whole-image coordinates (rows from the bottom). Phases: gap, strand, gap, strand.
- `B = trunc((100 − opacity)·255/100)`, `R = 255 − B`, `half = (width + 2·gap)/2`.
- Strand shade `sh(d) = trunc(B + sqrt(R² − trunc(d·R/half)²))`.
- Per row phase `j` and column phase `i`:
  - Gap rows: the gap columns are gap; the strand columns take `sh(j − gap + half)` or `sh(half − j)` (first gap row), or `sh(half − j + gap + width)` and `sh(j − half)` (second).
  - Strand rows: the first strand's row is shaded across the columns for `i < 2·gap + width` and by the row past that; the second strand's row is shaded across the columns outside the first strand column and by the row inside it.
- Pixel `trunc((p·sh + weaveColor·(255 − sh)) / 255)`; gaps take the gap color when Fill gaps is on.

### Chrome (0x54f940), registry UseOriginal, Level (4), Intensity (50), Color (white)

- Grey `g = trunc((R + G + B) / 3)`.
- Wave: `P = trunc(65025 / level)`, `t = (g << 8) % P`, folded at `P/2` (`t = P − t` past it), scaled `trunc(t·255 / (P/2))`.
- Each channel: `min(255, trunc(wave·X / 255) + intensity)`, `X` being the color's channel, or the pixel's own with Use original color. The dialog calls Level "Flaws" and Intensity "Brightness".

### Feedback (0x5599a0), registry Elliptical (0), Horizontal (50), Vertical (50), Opacity, Intensity (30)

- Center `cx = W·h/100`, `cy = H·v/100` (top-down); keep `k = 100 − (trunc(intensity·80/100) + 10)` percent.
- From (0, 0, W, H): each step moves each edge to `edge + trunc((center − edge)·k/100)`, stopping when the size stops shrinking.
- Every step draws the whole original into the new rectangle, nearest-sampled: column `trunc((x − left)(W − 1)/(right − left))`, bitmap row `trunc((bottom − 1 − y)(H − 1)/(bottom − top))` from the bottom.
- Blend `trunc((src·o + (255 − o)·dst)/255)`.
- **Elliptical:** each step's ellipse has its foci on the longer side's axis, `c = trunc(sqrt(a² − b²))` from the integer centre (`a`, `b` = integer half sides). The first step's foci are kept.
  - A pixel is drawn when `trunc(|p − F1| + |p − F2|)` is at most the longer side, for both the current ellipse and the first one.
  - Rows are counted from the pixel's lower edge (y + 1), as the bitmap loop walks them.

### Black Pencil (0x550240) and Colored Pencil (0x552f10), defaults detail 90, opacity 100

- Per channel, edges repeated:
  - `s = 200(below − above) + 200(right − left) + k·centre`, `k = 101 − detail`;
  - "below" is the image row under the pixel (kernel `0 −200 0 / 200 k −200 / 0 200 0` over PSP's bottom-up rows).
- A table maps `s`: `> 0` → 255, `< −255k` → 0, else `255 + trunc(s / k)`.
- Black Pencil: `g = trunc((59·G' + 30·R' + 11·B') / 100)·o`, each channel `trunc((p·(255 − o) + g) / 255)`.
- Colored Pencil: each channel `trunc((T·o + p·(255 − o)) / 255)`.

### Glowing Edges (0x557fc0), defaults intensity 3, sharpness 20

Soften (kernel code 30) first. Per channel, with `w` = intensity and the four neighbours (below, left, right, above):
- four sums `w(b − l + r − a)`, `w(−b − l + r + a)`, `w(−b + l − r + a)`, `w(b + l − r − a)`, each floored at 0 and totalled;
- below `trunc(sharpness·255/100)` the total becomes 0;
- the result is `min(255, trunc(total·150/100))`.

### Neon Glow (0x556d60), defaults intensity 50, opacity 50

- The pencil kernel with `k = 101 − intensity`, divided by `k` and clamped to 0..255 as `v`; each channel becomes `trunc(((255 − v)·o + p·(255 − o)) / 255)`.
- PSP reads some taps from the wrong channel (kept):
  - blue's sum takes red at the left pixel (weight `k`) and at the centre (weight −200);
  - green's takes blue at the left, centre and right;
  - red's takes green there.

### Charcoal (0x5514d0) and Colored Chalk (0x5541a0), defaults detail 90, opacity 100

- **Charcoal** is Black Pencil with the kernel's taps two pixels away (5 x 5 table, same `k` and lookup).
- **Colored Chalk:**
  - 5 x 5 kernel: `36 18 9 4 2` two rows below (columns x−2..x+2), `−2 −4 −9 −18 −36` two rows above, centre `k = trunc((103 − detail)/3)`;
  - the same table shape (`> 0` → 255, `< −255k` → 0, else `255 + trunc(s/k)`);
  - per channel, blended as Colored Pencil.

### Sampling (0x445df0)

The geometric effects sample with 8.8 fixed-point positions (`trunc(x·256)`). Bilinear weights:
- `trunc((256 − fy)(256 − fx)/256)`, `trunc((256 − fy)·fx/256)`, `trunc((256 − fx)·fy/256)`, `fy·fx >> 8`;
- the sum is truncated by 256, so a flat area can lose a level;
- a whole position copies the pixel;
- positions not strictly inside go to an edge handler chosen per effect.

### Kaleidoscope (0x6200c0), registry PX, PY, A1, A2 (10), R1, R2, ZF; all 0 but petals

- Tile `tw = W/cols`, `th = H/rows` (1 x 1 here). Halves `hx`, `hy`; center `cx = (PX·0.01 + 1)·hx`, `cy = (PY·0.01 + 1)·hy`.
- Ring:
  - `maxDist` = the farthest tile corner from the center;
  - `rIn = R1·maxDist·0.01` (Radial Suction);
  - `rOut = rIn + (hx / (R2 + 0.01))·0.5` (Number of Orbits).
- Per pixel, with `dx`, `dy` from the tile's middle:
  - `r = sqrt(dx² + dy²)·5^(−ZF/100)` mirror-folded into `[rIn, rOut]`;
  - `θ = atan2(dy, dx)` folded into `[A1·π/180, A1·π/180 + π/A2]`;
  - source `(tileX + cx + cos θ·r, tileY + cy + sin θ·r)`, folded into `[1, W − 2]` x `[1, H − 2]`; π is 3.1415926.
- The sampler is set to edge mode 3 with black (0x445c00(…, 3, 0)).

### Pattern (0x699510), defaults columns 3, rows 3, rotation 90, the rest 0

- Per pixel:
  - `u = (x − hx)·5^(−scale/100) + hShift·hx·0.01`, folded into `±(hx·0.5/columns)`;
  - `v` the same with `rows`;
  - rotation `a = rotation·0.01` (radians: PSP's unit);
  - source `(cx + sin a·v + cos a·u, cy + cos a·v − sin a·u)`, folded into the image.

### Mosaic - Antique (0x674370) and Mosaic - Glass (0x51d660)

- Shared fields:
  - columns and rows (25..100, default 50);
  - two offsets (0);
  - grout width (0..10, default 2);
  - grout opacity (0..100, default 50);
  - tile opacity or glass curvature (0..100, default 70);
  - edge curvature (Glass).
- Tiles `W/columns` x `H/rows`; `dx`, `dy` from the tile's middle; `d = min(hx − g − dx − 1, hy − g − dy − 1, dy + hy, dx + hx)`.
- Grout (`d < 0`): the offset is `(jitter + dx − rand() % (2·jitter + 1), jitter + dy − rand() % (2·jitter + 1))`, with jitter = grout opacity.
- Elsewhere the offset is `(dx, dy)·zoom`:
  - Antique zoom `25^(−tile/100)`; Glass zoom `25^(tile/100)`;
  - Glass, when `d < edge + 1`, uses `(dx, dy)·(edge + 1)·zoom / (d + 1)`.
- Sampled at the tile's middle plus the offset, folded into the image.

### Bitmap orientation

The geometric and 3D effects read pixels through PSP's DibIterator (0x52de50). It starts at the top row with a negative stride, so these routines see the image top-down, unlike the raw-bitmap routines above (Hot Wax, Chisel, Motion Blur, Mosaic, kernels).

### Lighting (0x4897a0; 8-bit 0x488f60)

Parameters (defaults 0x488b50): angle 315, elevation 30, color white, intensity 50, ambience 0, depth 20, shininess 0.

- Light:
  - `LX = trunc(sin A cos E·255.9)`, `LY = trunc(cos A cos E·255.9)`, `LZ = trunc(sin E·255.9)`;
  - half vector `(LX, LY, LZ + 256)` scaled to length 255.9 and truncated per component (`HX`, `HY`, `HZ`).
- Color: `I = trunc(trunc((intensity·1024 − 1024)/99)·103/100)`, `col = color·I >> 8` per channel.
- Depth term `Z = trunc(1530 / depth)`.
- Ambience: the pixel becomes `p·trunc((ambience + 100)·512/200) >> 8`.
- Shininess table: `s = shininess/100`, `n = 2^((1 − s)·7.6) + 6`, `T[i] = trunc((i/256)^n·s·255.9)`.
- Height map `(W + 2) x (H + 2)`:
  - `dx` = left column minus right column, `dy` = row below minus row above (3 x 3, top-down).
- Per pixel inside the mask:
  - **flat** (`dx² < 10` and `dy² < 10`, or within `border` of the left or right edge): `(p·(col·LZ >> 8) >> 8) + (T[HZ]·col >> 8)`;
  - **shadow** when `dx·LX + dy·LY + Z·LZ < 0`: 0;
  - **otherwise**, with `n = 1/sqrt(dx² + dy² + Z²)`:
    - `diff = trunc((dx·LX + dy·LY + Z·LZ)·n)`;
    - result `((diff·col >> 8)·p >> 8) + (T[trunc((dx·HX + dy·HY + Z·HZ)·n)]·col >> 8)`.
- Clipped at 255. A partial mask value `m` blends: `((v·m + (255 − m)·orig)·0x101 + 0x8000) >> 16`.

### Inner Bevel (0x444600) and Outer Bevel (0x4452a0), bevel 0, width 8, smoothness 0

- **Inner**:
  - shape = selection, else the layer's transparency;
  - distance map over shape pixels: the smallest squared distance to a clear pixel within ±width (the image's edges count, at `x + 1`, `W − x`, `y + 1`, `H − y`), starting from width²;
  - value `trunc(sqrt(d²)·255.9/width)`;
  - Gaussian radius 1, then the bevel profile table `P[v] = trunc(shape(v/255, 255.9))` (`P[0] = 0`);
  - smoothness > 0: a Gaussian of `smoothness/10` over the profile padded by `trunc(smoothness/10) + 1`;
  - lit under the selection.
- **Outer**:
  - rectangle = the shape's bounds grown by 2·width;
  - outer distance: 255 on the shape, else `255 − trunc(sqrt(d²)·255.9/width)` for the nearest shape pixel within width, else 0;
  - the profile, smoothing (no radius-1 blur first);
  - lit with that distance map as the mask, so the band fades out.
- The 12 profiles `shape(t, s)`:
  0. `t·s`
  1. `sqrt(1 − (1 − t)²)·s`
  2. 0 at t = 0; `0.4s` below 0.4; else `f = 1 − (t − 0.4)·5/3`, `(sqrt(1 − f²)·0.6 + 0.4)·s`
  3. 0 at t = 0; `0.2s` below 0.3; `s` above 0.7; else `f = 1 − (t − 0.3)·2.5`, `(sqrt(1 − f²)·0.6 + 0.2)·s`
  4. `s` above 0.2; 0 at t = 0; else `c = cos(1.25πt)`, `((0.5 − |c|^0.75·sign(c)·0.5)·0.8 + 0.2)·s`
  5. 0 at t = 0; `0.2s` below 0.2; `0.6s` above 0.8; `s` above 0.6; else `f = 1 − (t − 0.2)·2.5`, `(sqrt(1 − f²)·0.4 + 0.2)·s`
  6. `a = |2(t − 0.5)|`; `s` past 1; else `(sqrt(sin(aπ/2))·0.7 + 0.3)·s`
  7. `|2(t − 0.5)|·s`
  8. 0 at t = 0; `0.2s` below 0.2; `s` above 0.8; else `f = (t − 0.2)·5/3`, `(0.8f² + 0.2)·s`
  9. `0.2s` below 0.3; else `f = (t − 0.3)/0.7`, `(sqrt(1 − f²)·0.8 + 0.2)·s`
  10. the same on `1 − t`
  11. `f = t` below 0.3, `1 − t` when that is below 0.3, else `s`; result `f·(10/3)·s·0.5`

### Texture (0x795710) and Sculpture (0x74dab0)

- Resources (0x7935e0): a name, `*N` for a built-in resource, or `|C` for a solid 48 x 48 color `C` (a COLORREF in decimal). Sculpture's default is `|4365769` (R 201, G 157, B 66); Texture's is `Asphalt.tex`.
- GenerateTiles (0x58a820): the resource resized to Size % when not 100 (0x7f03d0), repeated from the top left; grey by luminance when an 8-bit result is wanted.
- **Texture** (defaults as the lighting but depth 1, size 100, smoothness 0):
  - the tiled texture is the height map, with a border of zeros;
  - Gaussian `smoothness/10` when smoothness > 0;
  - the image is lit under the selection; without smoothness the outermost row and column get the flat lighting.
- **Sculpture**:
  - the height map is the image's luminance times its opacity / 255, bordered and smoothed the same way;
  - the surface lit is the tiled pattern (24-bit) or solid color;
  - same border rule.
- The texture's resize uses 0x7f03d0 (section 4).

## 9. Deformations

### Area resampling (0x63e800, 0x63fa70)

- A target pixel covers `pct = max(1, trunc(span·100/size))` percent of a source pixel each way.
- The first source pixel counts `trunc((100 − trunc((n % span)·100/span))·pct/100)` (with `n = size·offset`, source `trunc(n/span)`); then whole `min(remaining, pct)` steps until 100.
- Sum of `pixel·wx·wy`, divided by 10000. Positions clamp. Rows count from the bitmap's bottom.

### Circle (0x63e800)

- Radius `r = min(W, H)/2`; column and row chords `max(1, 2·trunc(sqrt(r² − min(d², r²))))` for `d` from the middle (W/2 − i, H/2 − j).
- Outside `dx² + dy² > r²` the background color.
- Inside, each row is squeezed into its chord horizontally and each column into its chord vertically, by the area resampling.

### Pentagon (0x63fa70)

- Half width `R0 = W/2` when `W < trunc(343H/330)`, else `trunc(H·0.5257311)`.
- `a = trunc(R0·1.0514622)`, side `c = trunc(a·1.1755705)`, height `min(a + trunc(a·0.809017), H)`.
- Lower sides `trunc(c·0.9510565)` tall; bottom corners `R0 ± c/2`, shoulders inset `trunc(c·0.309017)` beyond them; centered.
- Each row is squeezed between the pentagon's edges, the rows over its height (area resampling); outside, the background color.
- Lower side height `L = trunc(c·0.9510565)`, inset `trunc(c·0.309017)`, right shoulder `sx = min(br + inset, W)`.
- **Slopes**, in pentagon coordinates (rows from the bottom):
  - `s1 = L/−bl`;
  - `s2 = (ph − L)/R0`;
  - `s3 = (L − ph)/(sx − R0)` with `c3 = ph − trunc(R0·s3)`;
  - `s4 = L/(sx − br)` with `c4 = L − trunc(sx·s4)`.
- **Row edges:**
  - rows up to L: left `trunc((row − L)/s1)`, right `trunc((row − c4)/s4)`;
  - higher rows: left `trunc((row − L)/s2)`, right `trunc((row − c3)/s3)`.
- **A pixel is left out** (t = row − L) when:
  - `x < trunc(t/s1)` and `row < trunc(x·s1 + L)`;
  - `x < trunc(t/s2)` and `row > trunc(x·s2 + L)`;
  - `x > trunc((row − c3)/s3)` and `row > trunc(x·s3 + c3)`;
  - `x > trunc((row − c4)/s4)` and `row < trunc(x·s4 + c4)`.
- **Quirk:** the pentagon's top row, and the image's own top row, are background when the width is even.
- The 8-bit path samples the background color for source columns at or past `W − 1`. The 24-bit path does not check, and JSPaintShop clamps there.

### Wind (0x8043d0, "WIND.CPP"), registry strength 10, direction 1 (from the right)

- `k = 78 + strength` (strength above 20 counts as 0).
- Along each row from the windward side, each channel `v = p + trunc((v − p)·k/100)` (first `v` = the first pixel), clipped at 255.

### Sampler edge modes (0x445c00)

0: leave the target pixel; 1: wrap (0x446670); 2: clamp to the nearest pixel (0x446930), then fall through to mode 3; 3: neighbours outside take the background color given to the sampler, black in every effect so far (0x4469b0).

### Perspective - Horizontal (0x8099c0) and Vertical (0x80ad30), default 45, range ±100 (|amount| < 3 does nothing)

- `m = (H − max(1, trunc((100 − |a|)·H/100)))/2`, slope `s = m/W` in single precision.
- Column `x` keeps `[m − trunc(x·s), H − m + trunc(x·s)]` for a negative amount, `[trunc(x·s), H − trunc(x·s)]` for a positive one; outside, the background.
- Inside, target pixels take 100000 units from successive source pixels worth `trunc((hi − lo)·100000/H)` each, from the bitmap's bottom row.
- Vertical is the same along rows (its own sign handling not fully read; transposed in JSPaintShop).

### Skew (0x640c80), defaults 25 / 25

A nonzero horizontal angle wins, else the vertical one. With π = 3.1415927 (0x88c840), the total shift is `D = max(1, trunc(tan(|angle|·π·(1/180))·side))`; side is the height for rows, the width for columns. The result is D larger, centred back by `trunc(D/2)`.

**Rows** (bitmap row m from the bottom):
- slope `s = H/D`, or `(H·−1)/D` for a negative angle;
- offsets: positive `A = 0`, `B = trunc(−W·s)`; negative `A = trunc(−(D·s))`, `B = trunc(−((W + D)·s))`;
- row m covers columns `trunc((m − A)/s) .. trunc((m − B)/s)`. A column x there takes source column `x − start`, held inside the image; elsewhere the background color.

**Columns** (column c from the left):
- slope `s = D/W`, or `(D·−1)/W`;
- rows `trunc(c·s) (+ D when negative) .. trunc(H (+ D) + c·s)`;
- bitmap row r there takes source row `r − start`.

### Wave (0x7e8da0), AmplitudeX 20, WaveLengthX 50, AmplitudeY 20, WaveLengthY 50

- Row `y` shifts by `trunc(sin(y·2π/λx)·ax·256)`; column `x` by `trunc(sin(x·2π/λy)·ay·256)` vertically.
- 8.8 bilinear, edge mode 0.

### Ripple (0x7427a0), OriginX 50, OriginY 50, Amplitude 10, WaveLength 40

- Center at the percentages of the size.
- Pixels with `A ≤ d² ≤ max(W, H)²` move along their radius by `k = sin(r·2π/λ)·A·256/r` (`trunc(dx·k)`, `trunc(dy·k)`).
- Edge mode 0.

### Twirl (0x7cd960), default 180

- `u = x·2/(W − 1) − 1`, `v = 1 − y·2/(H − 1)`, `ρ = sqrt(u² + v²)`.
- Inside ρ < 1: `θ = atan2(u, v) + (1 − ρ)²·(−deg·π/180)`; source `((sin θ·ρ + 1)(W − 1)/2, (1 − cos θ·ρ)(H − 1)/2)`.
- Edge mode 3.

### Pinch, Punch, Cylinders (0x809f30), defaults 50

- Two amounts `px`, `py` (100 = unchanged) and a built-in 201-entry table `T` (680 … 0 at 100 … −160).
- Source column `c` is worth `trunc(c·T[px]/(W/2)) + px` percent, mirrored past the middle (`2(T[px] + px) − v`); rows the same with `py`.
- Each target pixel takes 100 each way from successive source pixels (sum / 10000).
- The vertical walk restarts per horizontal step from the row's start; the next row starts at the furthest source row reached, with the leftover worth.
- Pinch `100 + a` both; Punch `100 − a` both; Cylinder - Horizontal `(100, 100 − trunc(0.95a))`; Cylinder - Vertical assumed `(100 − trunc(0.95a), 100)`.

### Rotating Mirror (0x73b1d0), Warp (0x770480), CurlyQs (0x504240), Spiky Halo (0x73a430)

- Shared: tiles `W/cols x H/rows` (1 x 1 unless stated); center `(offset·0.01 + 1)·half`; sources folded into `[1, size − 2]`; bilinear, edge mode 3.
- **Rotating Mirror** (all 0): offset turned by `−angle`, first coordinate made absolute, turned back.
- **Warp** (size 50, strength 50): within `R = size%·farthest-corner distance`, the offset is divided by `(z − 1)(2r − 3)r² + z`, `r = d/R`, `z = 15^(strength/100)`.
- **CurlyQs** (10 x 10, strength 15, size 100, clockwise):
  - `R = size%·` the shortest distance from the center to the tile edges;
  - within it θ gains `(d − R)²·k`, `k = ±a²/R²`, `a = (strength + 15)·0.1` (negative when clockwise).
- **Spiky Halo** (compression 50, waves 20, radius 50): beyond `R0 = radius%·farthest-corner distance`, θ gains `(d/R0 − 1)·sin(θ·waves·2π)·compression·0.001`.

### Filter Browser, Deformation Browser (DIALOGs 156, 155)

A name list and a sample preview; OK runs the chosen command.

### User defined filters (pspud.flt, 0x718ca0)

- **PSP 6 format:**
  - header `JASC_FILT\r\n` then `0150\r\n`, then a 16-bit count;
  - 232-byte records: name (28 bytes), division factor and bias (int32), a 7 x 7 int32 matrix.
- **Older files:** a 16-bit count and 78-byte records:
  - name (25 bytes), factor (int16 at 25), bias (byte at 27), 5 x 5 int16 matrix at 28;
  - records with an all-zero matrix or zero factor are dropped;
  - the 5 x 5 goes in the middle of the 7 x 7 (0x717450).

## 10. Picture Frame (0x6aa580, "PictureFrameWiz.cpp")

- A three-page wizard; registry keys OutsideFrame and FrameWizColorIndex.
- Frames under 10 x 10 are refused. The frame (.pfr, a PSP image) is composited with its transparency.
- Inside: the frame is stretched over the image.
- Outside:
  - `s = imageHeight / holeHeight` (float);
  - borders `trunc(edge·s)`, the top and bottom one less;
  - canvas `W + left + right − 2` by `H + top + bottom`; the frame is stretched over that.
- The frame lands on a new layer named after it.
- **The hole** (0x6aa580):
  - A frame with alpha channels (the stock Round Wood has one, "Selection #0", covering the oval) uses its last one, fetched as channel count − 1. 0x818740 paints 255 into the frame's mask wherever that channel is 0, so outside the frame's shape counts as opaque. The threshold is then 0.
  - Without channels, 0x818740 paints white (255, 255, 255) into the frame's color wherever its mask is not 255, and the mask is thresholded at 1 (0x81dfb0: above 1 becomes 255, the rest 0).
  - 0x81c880 gives the box of the bytes that are not 255 (the clear pixels) and 0x81c400 the box of the bytes that are not 0 (the opaque ones). Both are top-down, with right and bottom exclusive.
  - When the opaque box is narrower or shorter than the clear one, the two swap. The hole is the clear box, the other one the frame's extent.
  - `OffsetRect(hole, 0, −1)`, then left = `hole.left`, right = `extent.right − hole.right`, top = `hole.top` and bottom = `extent.bottom − hole.bottom`; `s = (float)imageHeight / (float)holeHeight`. So top is one less and bottom one more than the hole's real margins.
- The edge color choice (registry FrameWizColorIndex) fills the parts outside the frame's shape. JSPaintShop takes the shape from the last alpha channel, or, without one, from the clear area around the center.

## 11. Picture Tubes ("ToolPictureTube.cpp")

- **Tube block** (id 11):
  - a 16-bit version (0) and the name (513 bytes);
  - then int32 step, cells across, cells down, cell count, placement mode, selection mode;
  - the modes are 1-based in the file (0x7ba250 subtracts 1);
  - a cell count of −1 means across·down.
- **Placement** (0x7b5e40), on the distance moved since the last cell:
  - Random (0) waits `trunc(rand()·step/32767)`, drawn again after each cell;
  - Continuous (1) waits `step`.
- **Selection:**
  - Random `rand()·count >> 15`;
  - Incremental cycles;
  - Angular: from the stroke direction `a = (270 − degrees) mod 360`, cell `trunc(((trunc(180/count) + a) mod 360)·count/360)`; a negative `a` places nothing;
  - Pressure `trunc(count·pressure/257)`;
  - Velocity `min(count − 1, trunc(count·ms/300))` since the last cell.
- Export Picture Tube requires a 24-bit image with one layer with transparency.

## 12. Deformation tool ("DeformCtrl.cpp", 0x51c270)

- The transform is a 3 x 3 matrix kept under registry keys m00..m22. It maps each target pixel back to the source: `x' = (m00·x + m01·y + m02)/w`, `y' = (m10·x + m11·y + m12)/w`, `w = m20·x + m21·y + m22`.
- 0x51aa10 samples the nearest pixel (top-down rows), leaving positions outside the source clear:
  - when `m20`, `m21` ≈ 0 and `m22` ≈ 1 it walks precomputed 22.10 fixed-point row and column tables;
  - otherwise it divides per pixel.
- 0x51b160 is the bilinear path, used to apply (the caller 0x515c80 passes 0; the drag preview passes 1 and gets 0x51aa10):
  - positions in 1/1024 pixels, X from the left and the row V counted from the bottom (DIB);
  - affine: `X = trunc(1024·m00·x) + trunc(1024·m01·y) + trunc(1024·m02)` and `V = 1024·(H − 1) − trunc(1024·m10·x) − trunc(1024·m11·y) − trunc(1024·m12)` (tables per column and row);
  - projective: `q = 1024/(m21·y + m20·x + m22)`, `X = trunc((m01·y + m00·x + m02)·q)`, `V = 1024·(H − 1) − trunc((m11·y + m10·x + m12)·q)`;
  - `i = X >> 10`, `fx = X & 1023`, and the same for V. Below −1 or past the image, the pixel is the background PSP passes, 0, for the color and the mask alike;
  - taps outside the image read 0 with their weight kept: `top = a + ((b − a)·fx >> 10)`, `bottom = c + ((d − c)·fx >> 10)`, value `top + ((bottom − top)·fv >> 10)`.

## 13. Adjustment layers (JLayer, 0x824c70)

0x824c70 returns the per-row routine for an adjustment layer type. There are two variants for each type: one for 3-channel rows (pixels stored B, G, R) and one for greyscale rows.

Every routine copies the source pixel unchanged, and clears its coverage, where the layer's coverage or mask byte is 0. Otherwise:

| Type | Routine (RGB / grey) | Per pixel |
|---|---|---|
| 0, 1 Levels, Curves | 0x824670 / 0x824710 | one table per channel (+0x648 B, +0x64c G, +0x650 R); grey uses the +0x650 table |
| 2, 8 Brightness/Contrast, Posterize | 0x824320 / 0x8243c0 | one table (+0x654) on all three channels |
| 3 Color Balance | 0x824670 / none | per-channel tables, like Levels (builder below) |
| 4 Hue/Saturation | 0x824770 / none | per hue degree tables (builder below) |
| 5 Channel Mixer | 0x824420 / none | `out = (m0·R + m1·G + m2·B + m3·255)/100` per output channel (integer division, then clamped); with Monochrome (+0x550) one row for all three |
| 6 Invert | 0x824120 / 0x824190 | `255 − c` |
| 7 Threshold | 0x8241e0 / 0x8242c0 | `luma = (59·G + 30·R + 11·B)/100` (integer), then the +0x654 table on all three channels |

Notes:
- Types 3, 4 and 5 have no greyscale variant: the 0x824c70 cases return null for grey rows.
- The tables are built in the layer's settings code (0x4289a0 picks the builder by type). JSPaintShop builds the other types' tables with the same code as the Colors menu adjustments (section 3).

### Color Balance tables (0x4243e0)

The settings are a Preserve Luminosity flag and three groups of three values, −100..100: highlights, midtones, shadows, each cyan/red, magenta/green, yellow/blue. The builder makes one table per channel in two stages (x = i/255, constant 1/255 = 0x1.0101010101010p−8).

**Stage 1, input levels**, for a channel's highlight h and shadow sh:
- Without Preserve Luminosity:
  - black = −sh when sh < 0, else 0; white = 255 − max(h, 0);
  - a target v for the middle, with u = (white + black)·0.5 and f(u) = u < 127.5 ? (127.5 − u)·0.57 + 127.5 : 127.5 − (u − 127.5)·0.63:
    - h ≥ 0 and sh ≤ 0: v = f(u);
    - h < 0 and sh > 0: w = h + sh, v = 127.5 + w·0.315 (w < 0) or 127.5 + w·0.285;
    - otherwise v = f(u), plus 0.33·h when h < 0, plus 0.24·sh when sh > 0;
  - g = ln(v/255) / ln(0.5);
  - T[i] = 0 for i ≤ black, 255 for i ≥ white, else trunc(x[k]^g · 255) with k = trunc((i·255 − black·255) / (white − black)).
- With Preserve Luminosity only the differences between channels count:
  - black = max(shadows) − sh;
  - white = min(highlights) − h + 255;
  - T[i] = k (the integer index above, no curve).

**Stage 2, midtones**, for a channel's midtone m: T[i] = trunc(x[T[i]]^g · 255) with g = ln(t/255) / ln(0.5), where:
- without Preserve Luminosity t = 127.5 + m·0.535 (m ≥ 0) or + m·0.645 (m < 0);
- with it, F = (max − min)·0.005 over the three midtones, hi = trunc(128 + 53F), lo = trunc(128 − 64F):
  - the largest midtone gets hi and the smallest lo;
  - the middle one c gets 128 ± (hi − lo)·|c − mid| / (max − min), integer, with mid = min + trunc((max − min)/2), or 128 when all three are equal.

With every value 0 and Preserve Luminosity off, g comes out a rounding step above 1, so some entries drop by one. PSP's x87 arithmetic most likely does the same.

### Hue/Saturation tables (0x425fe0) and pixels (0x824770)

The settings are a Colorize flag, the master hue, saturation and lightness, the colorize hue, saturation and lightness, and six ranges of seven values: hue, saturation, lightness, then four bounds in degrees. The dialog (DIALOG 27051, 0x430310) ranges are hue −180..180, saturation and lightness −100..100; when colorizing, hue 0..360 and saturation 0..100. Reset (0x42fc90) puts the colorize values at the foreground color's hue in degrees, saturation 25 and lightness 0, and the bounds at reds 315/345/15/45, yellows 15/45/75/105, greens 75/105/135/165, cyans 135/165/195/225, blues 195/225/255/285 and magentas 255/285/315/345.

**Tables**, 360 entries each for hue, saturation and lightness:
- Every entry starts at the master values (the colorize values when colorizing; the ranges are then not used).
- A range with any nonzero value adds over its bounds b0..b3, each stretch L degrees long (wrapping at 360, `L = b1 − b0`, or `360 − (b0 − b1)` when b0 > b1):
  - from b0 for trunc(L) entries: trunc(v·(k − b0)/L);
  - from b1 to b2: v;
  - from b2 for trunc(L) entries: trunc(v·n/L), n counting down from trunc(L).
- Then saturation is `s·255/100` (integer) and lightness is held to −100..100.

**Pixels:** the pixel's PSP HSL (0..255 each; section 3):
- Its hue in degrees is d = trunc(H·359/255).
- The new hue is ((hue[d] + 360 + d) mod 360)·255/359, the new saturation S + sat[d] held to 0..255.
- When colorizing, d is (hue[0] + 360) mod 360 and the saturation is sat[d] alone.
- Back to RGB with the same lightness. Each channel then moves by l = light[d]: c + c·l/100 when l < 0, else c + (255 − c)·l/100 (integer).

The degree round trip moves most hues by a step even with every value at 0.
- The result is mixed with the original by the layer's opacity and mask (core/layers/composite.ts).

## 14. Preset shapes ("PresetShapes.cpp")

Each fixed shape is a routine that adds nodes `[anchor, in handle, out handle]` through thunk 0x40793c, which wraps 0x497ee0. The coordinates are in a design box, which JSPaintShop scales to the dragged box:
- Rectangle 0x6d6d00, Square 0x6d7310, Rounded Square 0x6d78f0
- Ellipse 0x6d8320, Circle 0x6d88e0, Triangle 0x6d8ea0
- Pentagon 0x6d9390, Hexagon 0x6d9a70, Octagon 0x6da280
- Star 1 0x6dacc0, Star 2 0x6db930
- Arrow 1 0x6dc7b0, Arrow 2 0x6dd640, Arrow 3 0x6ddc00

The node data was read with a stack emulator over the disassembly, because the decompile splits the double stores. It is in `src/core/vector/shapes.generated.ts`.

Rounded Rectangle (0x6d6310) is parametric:
- corner radius `r = (w/12 + h/12)·0.5`, limited to `w/2`, then `h/2`;
- the handles sit `r/2` from the corners;
- 9 nodes, the first repeated at the end.

Square, Rounded Square and Circle keep equal sides.

## 15. Node editing (MENU 497)

The node editor's commands (12014..12044) go through the node window's command handler 0x7276e0 (Ghidra also shows a copy at 0x40ac6d). The cases call one routine each, between "begin change" (0x7cde60) and "redraw" (0x4f9790).

**Node layout** (doubles):
- anchor x, y;
- a flags word at +0x10: bit 0 smooth, bit 1 symmetric, bit 5 selected;
- the handle before at +0x18, +0x20;
- the handle after at +0x28, +0x30.

A handle equal to its anchor is a straight side.

**Commands:**
- **Asymmetric (0x2ef7):** 0x4f44b0 sets smooth and clears symmetric. With both handles out, it puts them on the line through the anchor along `before − after`, each keeping its length `|anchor − handle|`. When the direction is shorter than 1e-5, the scale is 1.0.
- **Symmetric (0x2ef8):** 0x4f6990 runs 0x4f44b0, sets both flags, then scales each handle to `(|before| + |after|)·0.5`.
- **Cusp (0x2ef9):** 0x7309b0 clears the smooth bit only.
- **Smooth/Tangent (0x2f06):** 0x4f74f0 sets smooth and, when both handles are out, runs 0x4f44b0.
- **Line Before (0x2efb):** 0x4f3cf0 moves the before handle onto the anchor. It clears symmetric, and clears smooth when the other handle is already on the anchor.
- **Line After (0x2efc):** 0x4f3e20 does the same for the after handle.
- **Convert To Line (0x2efa):** calls both.
- **Curve Before, Curve After (0x2eff, 0x2f00):** 0x4f50a0. A missing handle grows with 0x4f3970, the point at a given length from the anchor toward a target. With no handles, 0x4f4230 aims the after handle at the next node's before handle.
  - The length is the distance from the anchor to the neighbour times 0.25 (0x882da8), read from the disassembly; 0x40adb7 is the distance, 0x402b21 the point along it.
  - With the other handle out, JSPaintShop mirrors it.
- **Reverse Path (0x2f07):** 0x4eb160.
- **Join (0x2f08):** 0x4ebb70 checks, 0x4ebe40 joins.
- **Break (0x2ef0), Close (0x2ef1), Reverse Contour (0x2ef2):** 0x4e77d0, 0x4e9b10, 0x4eb800. These are geometric; JSPaintShop writes them from their menu descriptions.

Constants: 0.5 at 0x881680, 1e-5 at 0x88b678, 1.0 at 0x8816a0.

**Fit Text to Path (33862):** the command object 0x4ac8e0 runs 0x4acb20 → 0x4acb70. That needs exactly two selected objects, one of them text (shape type 6) and the other a path. It links each to the other, keeps both, and redraws the union of their bounds. The glyphs are placed by the text renderer (0x783760 → 0x7900b0) on the flattened path (the path object's +0x80, its length +0x98, closed +0xf8):
- Each character starts one advance after the previous one along the path. The advance is its own plus the pair kerning, nothing for CR, LF and VT.
- From its start the renderer walks half the advance to M (0x78efd0). It turns the character to the direction from M to the next path point (points equal to M skipped) and draws it with its middle on M: translate to M, rotate, translate back by half the advance.
- **Open paths:**
  - alignment 0 (left) starts at the path's start;
  - alignment 1 (centre) starts at (path − text)/2;
  - alignment 2 (right) walks back from the path's end.

  Text longer than the path continues straight along the end segments: the path gets an extra point past each end it needs, along the first segment at least 2 long (0x882d88).
- **Closed paths:** the text is centred on one point and wraps around.
  - Centre alignment uses the topmost crossing of the vertical line through the middle of the path's box (0x78e8e0).
  - Left alignment uses the leftmost crossing of the horizontal middle line, right alignment the rightmost (0x78ec30).

JSPaintShop (core/vector/text-path.ts) follows these rules on its own flattening of the path (24 steps a curve). The browser's font metrics give the advances.

**Convert Text to Curves (34025 as one shape, 34026 one per character):** PSP reads the glyph outlines from the font. JSPaintShop:
- draws the text four times larger;
- traces it into closed contours and simplifies them to 0.75 px (core/vector/trace.ts);
- draws holes with the even-odd rule.

## 16. Preferences, export wizards and the frame

**Preferences.** The registry loader 0x6547f0 (and 0x6e3160 for the view settings) reads these keys with these defaults:

| Section | Keys and defaults |
|---|---|
| General: undo | UndoComp 0, UndoStepLimit −1 (no limit; the dialog shows 3), RedoEnabled 1, UndoMemLimit 20 MB, UndoMode 1 |
| Window | FitOnZoomIn 1, FitOnZoomOut 1, AutoZoomOnNew 1, FitAfterResize 1, AutoZoomAfterResize 1 |
| ColorPalette | ColorMode 0 (RGB), DisplayMode 0 (decimal) |
| General: dialogs and palettes | LargeBars 0, UseStdClrPicker 0, FlatStyleToolbars 1, EnableAutoRollUps 1, NoConfimationDlgs 0 |
| SaveAsDialog | RememberLastUsed 0 |
| General: miscellaneous | MRUSize 4, ForceCloseAll 0, NoEmptyClipboard 0, ShowAdjustmentWarning 1, FilterPuckPressure 1 |
| Selections | PasteTransTolerance 10 (percent) |
| General: rulers and grid | RulerColors 1 (toolbar colors), RulerUnits 0, DefaultUnit 0, GridUnit 0, GridSpacingX and GridSpacingY (strings), GridRed, GridGreen, GridBlue 192 |
| TransparencyGrid | Scheme 1, SizeSelection 2; CheckersRed0, Green0, Blue0 255; CheckersRed1, Green1, Blue1 192 |
| Palette | foreground 255, 255, 255 and background 0, 0, 0 |

Notes:
- The grid spacing and default resolution strings have no default visible in the decompile; JSPaintShop uses 10 and 72.
- The Transparency tab's size and scheme names are filled in code; JSPaintShop names its own.
- How PasteTransTolerance is applied (0x6fcaf0 and the paste code at 0x7523a0) was not followed. JSPaintShop clears a pixel when every channel is within tolerance% of 255 of the background color.

**Transparent GIF Wizard ("GifWiz.cpp").** The pages are:
- CGifWizTrans: DIALOG 27019, or 27023 when the image has transparent areas;
- CGifWizBackground: 3004;
- CGifWizPalette: 150, the web-safe choice;
- CGifWizColors: 27020;
- CGifWizResult: 27021.

The colors page's slider has range 0..8 (0x593d60). Its data exchange (0x593c90) sets the color count to the table at 0x922b9c: 256, 181, 128, 91, 64, 45, 32, 23, 16.

**JPEG Wizard.** The pages are:
- quality, DIALOG 512, slider 0..100 (0x5966a0); its data exchange (0x5965e0) keeps the position as the compression value;
- Format, 549: Standard or Progressive;
- the result, 544.

**Toolbar customizing.** No PSP dialog: Customize opens the Windows toolbar Customize dialog. The buttons come from strips 128 and 547.

**Set Palette Transparency (DIALOG 416).** The choices are:
- No transparency;
- the current background color;
- a palette entry, chosen in an edit with a spin, or by clicking the image.

**Help.** Psp.hlp is WinHelp 4: |SYSTEM minor version 33, flags 4. Topics are in 4 KB LZ77 blocks, each decompressing to about 7 KB of a 16 KB position space; there are no phrase tables. Contents come from Psp.cnt. Context names hash with winhlp32's hash, `h = h·43 + code(c)`. The pictures are |bm SHG/MRB files and plain BMP baggage files.

## 17. Tiles ("TilesEffect.cpp", 0x797520; DIALOG 503)

**Settings** (0x7959f0, registry keys TileShape, TileAngularity, TileSize 8..32, BorderSize 1..10, BorderColor): the lighting's (section 8) with depth 1 and shininess 50, then:
- smoothness 25;
- shape 2;
- angularity 75;
- size 15;
- border 1;
- border color black.

The effect object has the light block at +8, smoothness at +0x24, shape +0x28, angularity +0x2c, size +0x30, border +0x34 and border color +0x38.

**Tessellation** (0x6c17f0), by shape:
- **0, triangles** (0x6c1f00):
  - point rows `h = √3·s·0.5` apart at `y = r·h − h/2`;
  - `x = c·s − s/2`, plus `s/2` on even rows;
  - tile (i, j) (0x6c2080) uses `k = i/2`. On even rows, i even is `[j,k] [j+1,k+1] [j+1,k]` and i odd is `[j,k] [j,k+1] [j+1,k+1]`; odd rows mirror these.
- **1, squares** (0x6c1d20): points `(i·s − s/2, j·s − s/2)`; tile (i, j) is the four corners from (i, j) to (i+1, j+1).
- **2, hexagons** (0x6c19e0):
  - `half = trunc(s/2)`, `d = half/√3`;
  - point rows `half` apart at `y = r·half − half`;
  - pairs of points along each row at `base = k·6d − d`: even rows `base + d`, `base + 3d`; odd rows `base`, `base + 4d`;
  - tile (i, j) (0x6c1bc0) is points `c` and `c + 1` of rows j, j+1 and j+2, where `c = 2i + (j odd)`.

**Grid sizes** (from the disassembly; the divisions round up):
- squares: n = trunc((W + s − 1)/s), m = trunc((H + s − 1)/s); (n + 2) x (m + 2) points, (n + 1) x (m + 1) tiles;
- triangles: n = trunc((W + s − 1)/s), m = trunc((H + h − 1)/h); n + 2 points a row, m + 3 rows; 2n + 2 tiles a row, m + 1 tile rows;
- hexagons: with d = half/√3, a = trunc((W + 6d − 1)/6d) and b = trunc((H + 2·half − 1)/half); 2a + 4 points a row, 2b + 3 rows; (a + 1) x (b + 1) tiles.

The grid is in DIB rows, so it starts at the image's bottom left (grid y is image row H − 1 − y).

**Angularity** (0x796f00):
- The grey is the image to grey (0x801df0), then a Gaussian of 1.0 (0x7f21e0).
- Every point inside `[1, W−1) x [1, H−1)` (truncated) moves to the pixel with the largest `gx² + gy²` within `±trunc(size·angularity/300)`, keeping the first maximum. If no gradient is above 0, the point stays at its truncated place.
- Prewitt: `gx` is the left column minus the right column; `gy` is the row below minus the row above.

**Tiles** (0x797370 → 0x796a00 per tile):
- The tile's corners are shrunk about their mean (0x58b940) by `1 − border/size`.
- Its color is the integer average of the image under the **shrunk** tile (0x795e50):
  - the corners are rounded half away from zero;
  - each row's span comes from 0x58b630: each edge, from corner i to corner i − 1, steps its rows from the lower end with `x = trunc((y − y0)·dx/dy) + x0`, and a row covers every x its edges reach, ends included;
  - rows outside the image are skipped and spans clipped to it;
  - with no pixels the color is black.
- It is drawn at three times the resolution (0x7962b0):
  - the corners ×3 are rounded the same way and spanned the same way;
  - the box is widened to multiples of 3;
  - each covered subpixel adds 256, and a pixel's coverage is a = (sum of its 3 x 3 + 4)/9;
  - where a > 0 the color image gets `(border·(256 − a) + tile·a) >> 8` and the height map `(a·255) >> 8`.
- The color image starts as the border color; the height map is `(W+2) x (H+2)`.

**Bevel** (when smoothness ≥ 1):
- `k = trunc(smoothness·0.01·4 + 1.1)` (constants 0.01, 4.0, 1.1 at 0x881f50, 0x88b698, 0x892188).
- Every map pixel above 0xBF gets `trunc(sqrt(d²)·255.9/k)`, where `d²` is the squared distance to the nearest pixel below 0xC0 within `±k`. When the window passes the map's edge, the distance to that edge plus 1 counts. The search starts from `k²`.
- Then a Gaussian of `smoothness·0.01·3 + 0.5`.

**Lighting:** 0x48a290 with the light block, the color image, the map and the tile mask; flat at the edges when smoothness is 0.

**Greyscale images** (0x797370 picks 0x7965f0 when the image is 8-bit):
- the same steps on one channel;
- the angularity's grey is the image itself, without the conversion before the Gaussian;
- each tile is the average grey (0x795d40), drawn by 0x796000 with the same coverage formula;
- the border is the first byte of BorderColor, which is its red;
- the lighting is 0x488f60, the 24-bit lighting on one channel with the light color's grey, `(77·R + 151·G + 28·B) >> 8`.

## 18. RAW, Scitex CT and PC Paint (jff.dll)

PSP 6's file codecs are not in `Psp.exe` but in `jff.dll`, which exports `Decode<FMT>` and `Encode<FMT>` per format. Psp.exe's open and save switches (0x56c400 and its twin) call them by format id: 0x1a PC Paint (`DecodePIC`, `EncodePIC`), 0x1b Macintosh PICT (`DecodePICT`, `EncodePICT`), 0x22 Scitex (`DecodeSCT`, `EncodeSCT`), 0x67 RAW (`DecodeRAW`, `EncodeRAW`). The DLL was analysed into `re/jff/` the same way as Psp.exe (`ExportAll.java`).

### RAW (DecodeRAW 0x1007c610, EncodeRAW 0x1007d2c0)

**Opening.** Before decoding, Psp.exe fills an options block and runs DIALOG 8015 "RAW Options" (0x7396a0, data exchange 0x739a80):

| Block offset | Meaning | Dialog |
|---|---|---|
| +0x1b | channels: 4 grey, 1 RGB, 3 CMY (3 bytes), 2 CMYK (4 bytes) | radios 1003-1006 |
| +0x22 | flipped: file row 0 is the bottom row | 8016 |
| +0x23 | RGB order (else BGR) | 1009 / 1010 |
| +0x24 | interleaved (else planar) | 1007 / 1008 |
| +0x26 | header bytes skipped, 0..32767 | 1000 |
| +0x2c, +0x30 | width and height, 1..32767 | 1011, 1012 |

- The radio index maps to channels 4, 1, 2, 3. So "Three channel (CMY)" (index 2) gets the 4-byte CMYK reader and "Four channel (CMYK)" the 3-byte one. **JSPaintShop maps each button to what it says.**
- A header longer than the file fails (error 0x239). A short read fails (0xca); PSP does not keep the rows it read.
- **Greyscale** opens as an 8-bit image with a grey palette.
- **RGB** has four layouts:
  - interleaved RGB or BGR;
  - planar in RGB order: the first plane is red;
  - planar in BGR order: the first plane is blue.
- **CMY** is interleaved, and each RGB byte is 255 − ink.
- **CMYK** is interleaved. R = 255 − min(255, C+K) and G = 255 − min(255, M+K), but B = (255 − (Y+K)) & 255: PSP omits the clamp, so blue wraps. **JSPaintShop clamps blue too.**
- The order and planar choices apply to RGB only.

**Saving.** The save options block, which DIALOG 468 "RAW" sets, holds:
- +0x22: flip (0 means top row first);
- +0x23: RGB order (else BGR);
- +0x24: interleaved, which is forced on for 8-bit images;
- +0x26: header size, written as zeros.

An 8-bit image is written as one palette index per pixel, so the palette is not saved. A 24-bit image is written as RGB or BGR, interleaved or planar, in the same plane order as the reader uses.

**Additions in JSPaintShop:**
- **Size guesses** offered for the file's byte count, in this order:
  - OpenPhotex's square power-of-two texture sides (8 to 2048);
  - JSPod's known sizes (320x200, 640x400, 640x480);
  - other squares;
  - the same rules for RGB;
  - then factor pairs, closest to square first.
- **Palettes** for a single channel: an .ACT or PSP .PAL chosen together with the RAW, found beside it in Browse, or loaded in the dialog. OpenPhotex's 6-bit rule applies: a palette is 6-bit only when its brightest channel is exactly 63.
- **Unchanged indices are kept** when saving (`ImageDoc.indices`), so textures whose palettes repeat a color save back byte for byte.

Checked against OpenPhotex on all 6,940 square stock MTM2, CPR and TV textures that have a same-name .ACT: the pixels are identical, and re-saving gives identical files.

### Scitex CT (codec class, vtable 0x10139d00)

**Reading** (0x10080700 checks the name block, 0x10080820 reads the parameters, 0x100809e0 reads the image):

| Offset | Content |
|---|---|
| 0x000 | 1024-byte name block. The text before the first NUL must end in "CT" (case-insensitive). The writer uses `sprintf("%-80s%s", name, "CT")`. |
| 0x400 | units: 0 mm, 1 inch; anything else is refused |
| 0x401 | channels: 3 CMY, 4 CMYK |
| 0x403 | channel mask: bits 1, 2 and 4 are required, plus 8 for CMYK |
| 0x404 | height in the units, 14 characters, read with atof |
| 0x412 | width in the units, 14 characters |
| 0x420 | lines, 12 characters, read with atol |
| 0x42c | pixels per line, 12 characters |
| 0x800 | image data |

- **Resolution** is lines / height. For millimetres PSP multiplies by 10 and stores pixels per cm.
- **Data:** each row holds one line per channel. When the width is odd and `file size − channels·lines·pixels ≠ 0x800`, each line is padded by one byte.
- **Conversion** (0x10025bf0; constants 255.0 and 1.0; single-precision stores; truncating `ftol`):
  - SCT inks are stored inverted: ink = 1 − v/255.
  - CMYK: each ink becomes min(1, ink·(1−K) + K), and each byte is trunc(255·(1 − ink)).
  - CMY: the same without K.
  - The CMYK path can use a color profile when one is available (0x100258a0); JSPaintShop always uses the formula.

**Writing** (0x1007fdf0, 0x100800d0, 0x10080320):
- **Header:**
  - units are inches when the image resolution is per inch; otherwise millimetres, with the resolution × 0.1;
  - channel count and mask: 4 and 0x0f for CMYK, 3 and 0x07 for CMY;
  - the sizes in units are written as `"+.%8.8sE%+03d"` from `_fcvt(v, 8)`;
  - the pixel counts are written as `"%+012ld"`;
  - odd widths are padded.
- **Ink conversion** (0x10025eea):
  - c, m and y are 1 − RGB/255, and K = min(c, m, y);
  - PSP stores C = 1 − (c − K), likewise for M and Y, and K inverted;
  - PSP does not divide by (1 − K), so its own reader opens its files lighter wherever there is black. **JSPaintShop writes (c − K)/(1 − K)**, the inverse of the reader.
- JSPaintShop always saves CMYK in inches. PSP's `_fcvt` padding prints sizes below 0.1 a decade too small; JSPaintShop writes the correct value.

### PC Paint / Pictor (DecodePIC 0x10048e20, EncodePIC 0x100537e0)

**Reading:**
- **Header** (17 bytes): 0x1234, width, height, x and y offsets, plane info, 0xff, video mode, palette type (word), palette size (word).
- **Plane info:** the low nibble is bits per plane, the high nibble is planes − 1. PSP accepts 1, 4 or 8 bits per plane when the total is also 1, 4 or 8. The 4 × 1-bit plane path is hard-wired to four planes.
- **Palette:**
  - palette size 0: black and white;
  - type 3: 16 indices into the 64 EGA colors (the standard table: bits 0-2 add 0xAA of blue, green and red, bits 3-5 add 0x55);
  - otherwise: 6-bit VGA triples shifted left 2.
  - A palette over 0x300 bytes fails.
- **Image data:** a word gives the block count; 0 means uncompressed. Each block is a size word (5 + data), an unpacked-size word, a marker byte and data. A byte equal to the marker is followed by a count byte and a value; a count of 0 means a 16-bit count follows.
- **Rows** are stored bottom up, each plane's rows in turn. A pixel's bit n comes from plane n.
- **Difference:** PSP reads a new block header when a plane ends mid-block; JSPaintShop decodes the blocks as one stream.

**Writing** (8-bit or fewer; more fails):
- **Header:** plane info = bits, video mode 0x4c, palette type 0 for 1-bit or 4 otherwise, palette size = colors·3, palette written >> 2, then a block count equal to the height.
- **Blocks:** one per row, bottom row first, marker 0.
- **Runs:**
  - a single non-zero byte is written as is;
  - runs below 256 (and any 0 byte) are written as `0, n, v`;
  - longer runs as `0, 0, n lo, n hi, v`.
- A block over 0x2800 bytes fails.

## 19. PSP 6's vector and adjustment layers, selection and alpha channels (jff.dll and Psp.exe)

PSP files are read by jff.dll (`DecodePSP` 0x10070ab0) and handed to Psp.exe through a table of callbacks. The layout below is jff.dll's reader; what each field means comes from Psp.exe's writers, which fill the same records:
- shapes: 0x6cbe50 (attributes) and 0x6cbc70 (polyline nodes);
- text: 0x783cf0, 0x791e40 (lines and characters) and 0x49ddd0 (character style);
- adjustment layers: 0x428bc0, with the defaults in 0x422250.

In file version 4 every chunk opens with its own length (u32, counting itself).

### Where they sit

- A vector or adjustment layer's LAYER block holds, in order: the layer chunk, an extension block, the bitmap chunk, then the channels. jff.dll (0x100728f0) reads the channels first and then goes back to the extension.
- **12 ADJUSTMENT_EXTENSION:** a chunk with the type (u16), then a chunk with the settings.
- **13 VECTOR_EXTENSION:** a chunk with the shape count, then a SHAPE block per shape.
- **6 SELECTION** (top level): a chunk with the selection rectangle and the saved rectangle, then (as for alpha channels) a bitmap chunk and a CHANNEL block.
- **7 ALPHA_BANK:** a chunk with the channel count, then an **8 ALPHA_CHANNEL** block per channel, nested inside the bank. Each has a chunk with the name (u16 length + bytes), the image rectangle and the saved rectangle, then a bitmap chunk (u16 bitmap count 1, u16 channel count 1), then a CHANNEL block. PSP 6's stock frame Round Wood.pfr has one, named "Selection #0", which JSPaintShop reads.

### Shapes (block 14, reader 0x10073c30)

**Header chunk:**
- u16 type: 1 text, 2 polyline, 3 and 4 other path shapes (same layout as a polyline);
- u32 flags: bit 0 antialias (the object's vtable +0xac, field +0x55), bit 1 selected, bit 2 visible (vtable +0xfc, field +0x57);
- two more u32.

**Path shapes (0x10074120):**
- Attribute chunk:
  - the name;
  - u8 stroked (object +0x6a);
  - u16 line width (+0x68);
  - u8 filled (+0x56);
  - u8 cap: 0 round, 1 square, 2 flat (from the pen's PS_ENDCAP value);
  - u8 join: 0 round, 1 bevel, 2 miter (PS_JOIN);
  - f64 miter limit (default 10.0).
- Two PAINTSTYLE blocks (15): the stroke, then the fill. Each is a chunk with the style (u16; 1 = a color), then a chunk with a COLORREF and a u32 (−1 by default).
- A chunk with the node count, then a chunk per node:
  - f64 anchor x, y;
  - f64 handle before x, y;
  - f64 handle after x, y;
  - u8: the node starts a new contour (object +0x38);
  - u16 flags (object +0x10): 1 smooth, 2 symmetric, 0x20 selected, 0x80 closes its contour (the node editor's Close, 0x4e9b10, sets it on the contour's last node).

The Vector Properties dialog (DIALOG 27031, 0x7e2bc0) confirms these fields: its Style list is Stroked when only +0x6a is set, Filled when only +0x56 is, and Stroked & Filled when both are.

**Text shapes:**
- Attribute chunk: u8, i32 x, i32 y (text object +0x104, +0x108), then a 3 × 3 matrix of f64 (0x66bb30 by row and column).
- A chunk with the element count, then per element a chunk with its kind (u16) and a chunk with its data:
  - **3, a line:** u32 (the line object's +0xb0);
  - **2, a character style**, written when the style changes: the face name; u32 flags (1 italic, 2 strikeout, 4 underline); u32 weight; u32; u32 height (`lfHeight = −height`); u8; u32; u32; then the fill PAINTSTYLE;
  - **1, a character:** u32.

**What JSPaintShop infers** (no PSP 6 sample with vector layers was available to check against):
- The text's position is the attribute x, y through the matrix (`x' = x·m00 + y·m10 + m20`).
- A line's u32 is taken as its alignment (0 left, 1 or 6 centre, 2 right).
- The first character style gives the font, size, bold (weight 600 or more) and fill color.
- The three unnamed u32 fields of the character style are not used, so kerning and leading read as 0.

### Adjustment settings (0x428bc0)

The type in the file is JLayer's type + 1. Levels and Curves keep four channels in this order: master, blue, green, red. The Levels page (0x64b6f0) fills them in that order from its RGB, Red, Green, Blue tabs.

| File type | Adjustment | Settings |
|---|---|---|
| 1 | Levels | 4 f64 gammas (the dialog's value × 0.01), then 4 × i32 input white, input black, output white, output black |
| 2 | Curves | 4 chunks: u8, u16 point count, 18 (x, y) byte pairs, the 256-entry table |
| 3 | Brightness/Contrast | i32 brightness, i32 contrast (table builder 0x4251f0) |
| 4 | Color Balance | u8 preserve luminosity (default on), then 3 groups of 3 i32: highlights, midtones, shadows (the builder's order, 0x4243e0) |
| 5 | Hue/Saturation | u8 colorize, 6 i32 (master, then colorize), then 6 hue ranges of 7 i32 (3 values and 4 range bounds; reds 315/345/15/45, yellows 15..105, greens 75..165, cyans 135..225, blues 195..285, magentas 255..345) |
| 6 | Channel Mixer | u8 monochrome, then the blue, green and red output rows, each red, green, blue and constant (defaults 100 on the diagonal) |
| 7 | Invert | none |
| 8 | Threshold | u32 (default 128) |
| 9 | Posterize | u32 levels (registry `AdjustmentLayerPoster\Levels`) |

JSPaintShop reads:
- Color Balance's groups as highlights, midtones and shadows, each cyan/red, magenta/green, yellow/blue. The table builder settles the order: the first group lowers the white input and the last raises the black input;
- Hue/Saturation in full: colorize, master, colorize values and the six ranges with their bounds (section 13);
- the curve points, not the stored tables, so a curve stays editable.

### Saving

JSPaintShop saves the selection (bitmap type 3) and the alpha channels (bitmap type 4) in these blocks, over the whole canvas. Its vector and adjustment layers are still saved as raster layers showing what they draw, with their objects and settings in JSPaintShop's own block.

## 20. Retouch ("ToolRetouch", setup 0x79eee0, dab 0x79f8b0)

The mode comes from the registry (`Brushes\RetouchMode`, with `RetouchMerged` for sampling the merged image; Lighten, Darken and Emboss always sample the layer). Each dab copies the pixels under it, computes the mode's result, and the brush mixes the result in by its coverage.

**Kernel modes** (0x79f750 copies a row of the table at 0x92c448: a 3 × 3 kernel, a bias, flags):

| Mode | Kernel (rows top to bottom) | Bias | Divided by the weights |
|---|---|---|---|
| Lighten RGB | identity | +10 | no |
| Darken RGB | identity | −10 | no |
| Soften | `12 24 12 / 24 50 24 / 12 24 12` | 0 | yes |
| Sharpen | `0 −1 0 / −1 40 −1 / 0 −1 0` | 0 | yes |
| Emboss | `1 0 0 / 0 0 0 / 0 0 −1` | 128 | no |

- Each channel is `sum + bias`, or `(sum + weights/2) / weights + bias` (integer division) when divided, then clamped to 0..255.
- A neighbour counts only where the dab's mask is set, and its weight is then added to the divisor.
- The kernel's first row is applied to the row after the pixel's in the bitmap. Read as a bottom-up bitmap, that is the row above, so Emboss is the up-left pixel minus the down-right one. This orientation is inferred, not traced.
- JSPaintShop counts a neighbour when it is inside the image and the selection.

**Smudge and Push** (cases 5, 6) carry the pixels picked up from dab to dab. Push keeps what it first picked up (+0x1fd8c).

**Hue, Saturation and Lightness Up and Down** (cases 9-14):
- PSP converts each pixel with its integer HLS routines (0x7ec1d0 to HLS, 0x7ec310 back; 0..4080, values × 16, rounded on the low four bits on the way back);
- it adds ±480 (30 levels) to hue, saturation or lightness;
- it clamps the result to 0..4080. Hue does not wrap.

**Dodge, Burn and the "to Target" modes** create a paint brush sub-tool (0x7b3210) with a blend mode:
- Dodge and Burn paint (128, 128, 128) in the Dodge (14) and Burn (15) blend modes;
- Saturation, Lightness, Hue and Color to Target paint the foreground color in the Saturation (4), Luminance (6), Hue (3) and Color (5) modes.

JSPaintShop's earlier formulas (written from the mode names) are replaced by these.

## 21. The other savers and readers in jff.dll

Each encoder asks Psp.exe for a device-independent bitmap (callback +0x44) and writes it out. Paletted formats take the palette indexes. Rows go top to bottom; the bitmap's own rows are bottom up.

**MacPaint (EncodeMAC 0x100427e0)**
- Only a 1-bit image of exactly 576 × 720 is accepted.
- A 640-byte MacBinary block (name, `PNTGMPNT` at 0x41) is written when the save option asks for it; otherwise a 512-byte zero header.
- Each 72-byte row is inverted and PackBits-coded:
  - runs of 3 or more are written as `−(n − 1), byte`;
  - single bytes and pairs are gathered into literals `n − 1, bytes`.

**Microsoft Paint (EncodeMSP 0x100447d0)**
- 1-bit only. Header: `LinS`, width, height, three more width/height pairs, then 12 bytes (bytes 4-5 are 0x22, 0x3A).
- A row-length table follows (placeholder zeros, filled in at the end), then the rows, with 1 = white:
  - runs of 2 or more (up to 255) are `0, n, byte`;
  - literals are `n, bytes`, flushed at 255.

**GEM IMG (EncodeIMG 0x10039ed0)**
- Up to 8 bits. Header (big-endian words): version 1, length 8, planes, pattern length 1, pixel size 85 × 85 microns, width, height.
- Each row writes every plane, the highest bit first, bits inverted. Codes:
  - `n`: a run of 0x00;
  - `0x80 | n`: a run of 0xFF;
  - `0, n, byte`: any other run;
  - `0x80, n, bytes`: literals.

  Counts go up to 0x7F.
- The reader (DecodeIMG 0x10039030) takes the first plane as the lowest bit, so PSP misreads its own multi-plane files. Several planes open as a grey ramp, `i · 256 / 2^planes`, with black and white at the ends.
- JSPaintShop writes the lowest plane first.

**Dr. Halo (EncodeCUT 0x10027b40)**
- 8-bit only. The palette goes to a .PAL file with the same name, 2048 bytes in four 512-byte blocks built in one zeroed buffer:
  - the header is "AH", 0xE3 (a word), 10 at byte 6, and 0xFF at bytes 12, 14, 16 and 18;
  - 6-byte entries R, 0, G, 0, B, 0 follow: 78 from byte 40, then 85, 85 and 8 from the start of each later block;
  - the buffer is not cleared between blocks, so the last block's tail repeats the third block's bytes.
- JSPaintShop saves the .pal as a second file after the .cut, and opens a .cut in color when its .pal is chosen with it.
- The .CUT has width, height and 0, then per row: a length word, the codes, and a 0. Codes:
  - runs of 3 or more are `0x80 | n, byte`;
  - literals are `n, bytes`, flushed past 0x7C.

**Sun raster (EncodeRAS 0x1007bf30)**
- 1, 8 or 24 bits; 4 bits is refused.
- Header (big-endian): 0x59A66A95, width, height, depth, data length, type 1, map type 1 with a 768-byte map (all reds, all greens, all blues) for 8 bits, else 0.
- Rows are padded to an even length. 1-bit rows are inverted; 24-bit rows are the bitmap's BGR.

**Windows Clipboard (EncodeCLP 0x10025530)**
- 0xC350, one entry, format 8 (CF_DIB), the length (header, palette and bits), offset 14.
- The packed bitmap follows at once, with no 79-byte name.

**Amiga IFF (EncodeIFF 0x10037bd0)**
- Chunks: FORM ILBM, then BMHD (20 bytes: width, height, 0, 0, planes, mask 0, compression 1 unless the option asks for none, 0, transparent 0, aspect 1:1, page = image), then CMAP (for 8 bits or fewer), then BODY.
- Each row writes every plane in turn, lowest first. At 24 bits the planes are red 0-7, green 8-15, blue 16-23.
- ByteRun1 runs of 2 or more are `−(n − 1)`; literals are flushed at 127.

**IFF reading (DecodeIFF 0x10036700)**
- CAMG bit 0x800 is HAM: 6 planes only (others fail), giving 24 bits. Each row starts from palette entry 0. The top two bits pick:
  - 00: palette entry `low 4 bits`;
  - 01: blue = `low << 4`;
  - 10: red;
  - 11: green.

  Components keep 4 bits (`& 0xF0`), with no replication.
- CAMG bit 0x80 is Extra Half-Brite: entries n..2n − 1 are the first n shifted right once.

**PICT (EncodePICT 0x10051ca0)**
- A 512-byte zero header, the size word (patched at the end), then the frame.
- **2 colors:** version 1 (`0x11 0x01`), clip region, then 0x98 (rowBytes, bounds, source and destination rectangles, mode 0) with PackBits rows.
- **Other paletted images:** version 2 (`0x0011 0x02FF`), header 0x0C00 (−1, then fixed 0, 0, width, height, 0), clip region, then 0x98 PackBitsRect:
  - rowBytes | 0x8000, pixel type 0, pixel size = component size = depth;
  - 72 dpi;
  - a color table: seed 8, flags 0, entries `index, R 0, G 0, B 0`.
- **Full color:** 0x9A DirectBitsRect: base address 0xFF, rowBytes = width × 4 | 0x8000, packing type 4, pixel type 16, 32 bits, 3 components of 8.
- The end opcode 0x00FF, word-aligned.
- JSPaintShop packs rows with ByteRun1; PSP's own row packer (an indirect call) was not compared.

**WPG (EncodeWPG 0x1009c730)**
- Header: FF "WPC", offset 16, product 1, type 0x16, version 1.0.
- Start record 0x0F: version 1, width and height in 1200ths of an inch (`ceil(pixels · 100 / dpi) · 12`).
- Color map 0x0E: first entry 0, count. Its length word is `count · 3 + 4` truncated to a byte, so 0x0104 for 256 colors.
- Bitmap 0x0B (or 0x14 with placement): a long length, width, height, depth, resolution, then rows with literals `n, bytes` and runs.
- End 0x10.
- **WPG 2 reading** (0x1009a110) is a separate parser:
  - Records are a class, a type, an extension and a length.
  - 0x0C is the palette (RGBA entries).
  - 0x0E is the bitmap: depth codes 1, 3, 4/12 and 8 give 1, 4, 8 and 24 bits; compression must be 1.
  - Row codes: 0x7D sample size, 0x7E nothing, 0x7F zeros, 0xFF ones, 0xFD repeat the last sample, 0xFE repeat the previous row, 0x80+n a sample n + 1 times, 0..0x7C n + 1 literal samples.
  - Two-color bitmaps are always black and white.

**PSD:** PSP 6 reads raw and RLE channels. JSPaintShop also opens ZIP layer channels (Photoshop 6 and later), as an addition.

## 22. Smaller details

- **New Image defaults** (File > New, 0x6f33a0):
  - registry `NewImage\Width` and `Height` default to "300";
  - `Type` 4 (16.7 million colors) and `Background` 1 (the background color);
  - `DimensionType` 0 (pixels); the resolution comes from `General\DefaultDPU` ("72").
- **Dialog ranges:**
  - Chrome (0x5d07a0): Flaws 1-8, Brightness 0-100.
  - Motion Blur (DDX 0x5cd3f0): angle 0-359, intensity 1-40.
- **Main toolbar default** (0x65a0d0, `CToolBar::SetButtons`, 21 slots): New, Open, Save, Print, separator, then 0xE12B, 0xE12C, 0xE123, 0xE122, 0x81B8, separator, 0x81EA, 0x8003, separator, 0x8169, 0x816A, 0x816B, 0x804A, 0x834E, separator, 0xE145.
- **Automatic roll-ups** (registry `General\EnableAutoRollUps`, default 1; the palette window's timer handler 0x60d370):
  - Timer 11 runs every 250 ms. A palette rolls up (0x60cb90) when the window under the cursor is not the palette or a child, the focus is not inside it, and it is not locked or being dragged.
  - Timer 15 rolls it down (0x60ca70) when the cursor has stayed within 10 pixels.
  - A title-bar button (hit-test code 22) toggles the lock. Its tooltip is "Lock Window Open" (23927), or "Allow Auto Roll-Up" (23926) when locked.
