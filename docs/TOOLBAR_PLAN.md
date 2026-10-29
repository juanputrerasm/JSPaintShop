# Plan: toolbar buttons on a transparent background

Status (2026-10-29): done, except step 4, which needed no code (see there). Recolor map as built: the table in step 2 plus 0,0,255 to 90,130,255, 0,128,0 to 90,190,90, 0,128,128 to 70,180,180 and 128,0,128 to 190,110,190, which were also too dark on the dark frame. Toolbars in the same row are divided by a 1px line.

Goal: the main toolbar, the tool palette and the Customize Toolbar list lose their Windows look (a light grey slab behind the buttons, kept light even in the dark theme) and sit directly on the app's own surface in both themes, keeping PSP 6's button art.

## Where the grey comes from today

1. **The bar itself.** `.toolbar` in `src/styles.css` paints `--button-face` (#f4f3f1 light, #dcdad6 dark) with a 1px border. In the dark theme this is a light grey block on a dark frame.
2. **Why it was kept light.** The strips (`public/ui/toolbar-main*.png`, `tools*.png`, `toolbar-extra.png`) already have PSP's 192 grey keyed out by `keyOutGrey()` in `scripts/psp-resources.mjs`. The art left is the Windows 16-color palette, drawn for a grey face: black outlines (0,0,0, the most common color in every strip), dark grey shading (128,128,128), navy (0,0,128) and dark red (128,0,0). On a dark background the outlines and shading disappear, so the face was left light.
3. **The button states.** Hover is a grey border, pressed or checked is a fixed light blue (#c9d8f2) that does not follow the theme.

## Steps

### 1. Bar and button styles (`src/styles.css`)

- `.toolbar`: `background: transparent`, no border, no radius. Groups keep `.tb-sep`, drawn in `--line`.
- `.toolbar-row` and the floating panels keep `--face`, so the buttons sit on the frame color.
- `.tb-button`: a fixed 26 x 25 hit area for small art (23 x 22 art gets 31 x 30), radius 5, transparent at rest.
  - hover: `background: color-mix(in srgb, var(--text) 10%, transparent)`;
  - pressed: 16%;
  - checked: `--accent-soft` with a 1px `--accent` ring;
  - `:focus-visible`: a 2px `--accent` outline (today there is none).
- Disabled: keep `grayscale(1)` and lower the opacity to 0.35, which reads well on both surfaces.
- Remove `--button-face` once nothing uses it.

### 2. Dark-theme art, made by the script (recommended)

The art is unantialiased palette art, so colors can be swapped exactly. `scripts/psp-resources.mjs` writes a second copy of each strip, `*-dark.png`, with a fixed color map:

| Light art | Dark art | Why |
|---|---|---|
| 0,0,0 outline | 230,229,226 (`--text` dark) | outlines stay visible |
| 128,128,128 shading | 150,150,150 | shading stays visible but darker than the outline |
| 0,0,128 navy | 110,150,240 | navy on dark grey has too little contrast |
| 128,0,0 dark red | 220,90,90 | same |
| 128,128,0 olive | 190,180,70 | same |
| everything else | unchanged | white paper, bright colors already read on dark |

- `toolbar.ts`: `artIn()` picks `-dark` when the theme is dark. Today the theme exists only in CSS, so add a small `isDark()` helper in `src/shared/`: `data-theme` on `<html>` when set, else `matchMedia("(prefers-color-scheme: dark)")`. `Toolbar` listens to that media query's `change` event and calls `setButtons` again.
- The Customize Toolbar list (`src/app/pref-commands.ts`, line 59) uses `mainButtonArt` too, so it follows without changes.
- Rejected alternatives:
  - A CSS `invert() hue-rotate(180deg)` filter in the dark theme: it shifts the reds and blues that carry meaning (Flood Fill, the color swatches).
  - Redrawing about 130 buttons as SVG: a large job, and the app would lose PSP 6's art. It could be a later, separate project.

### 3. Large icons

The same map applies to `toolbar-main-large.png` and `tools-large.png`. Preferences > Large icons keeps working, because `artIn()` only adds the suffix.

### 4. High-DPI screens

- Keep `image-rendering: pixelated`.
- At device pixel ratios of 2 or more, draw the 16 x 15 art at 2x (`background-size` on `.tb-icon`) when the user picks Large icons, so the pixels scale by a whole number.
- At ratios like 1.25 and 1.5 the art stays 1x, to avoid uneven pixels.
- As built: nothing to add. At a ratio of 2 the browser already draws each CSS pixel as 2 x 2 screen pixels, so the pixelated art scales by a whole number, and large icons already use PSP's own large strips.

### 5. Tests and docs

- `tests/psp-ui.test.ts`:
  - each `-dark` strip has the same size as its light strip;
  - no opaque pixel in it is 0,0,0;
  - transparent pixels match the light strip.
- `docs/PARITY.md`, Deliberate changes: "Toolbars sit on the frame with no button face; the dark theme uses a recolored copy of PSP 6's art."
- `AGENTS.md`: the `-dark` strips are generated with the other strips and are never edited by hand.

## Files touched

- `scripts/psp-resources.mjs`: the color map and the `-dark` strips.
- `src/styles.css`: the bar, button and state styles; `--button-face` removed.
- `src/ui/shell/toolbar.ts`: picks the strip by theme and redraws when the theme changes.
- `tests/psp-ui.test.ts`, `docs/PARITY.md`, `AGENTS.md`.

## Checks

- Typecheck, `npm test` and the build.
- The user compares both themes in the browser:
  - main toolbar and tool palette, small and large icons;
  - enabled, disabled, hover, checked and keyboard focus;
  - the Customize Toolbar dialog.
