/*
  The Picture Tube tool (Psp.exe "ToolPictureTube.cpp"): paints a series of image cells along
  the stroke. Tubes come from the imported Tubes folder (.tub: a PSP file with a tube block);
  choosing a tube takes its step, placement and selection modes from the file, as PSP does.
  Cells are scaled by Scale %, centered on the pointer, laid over the layer (Normal) inside the
  selection. A stroke is one undo step. Placement and cell choice: core/paint/tube.ts.
*/
import type { Tool, ToolContext } from "./tool.ts";
import type { Resources } from "../resources.ts";
import { CMD } from "../../ui/shell/commands.ts";
import { dynamicChoices, previewSources, setToolOption } from "./options.ts";
import { readPsp, type TubeInfo } from "../../core/formats/psp.ts";
import { inflate } from "../../core/formats/zlib.ts";
import { composite } from "../../core/layers/composite.ts";
import { resample } from "../../core/image/resample.ts";
import { activeLayer } from "../../core/doc/image-doc.ts";
import { patchChange } from "../../core/edit/record.ts";
import { TubePlacer, tubeCells } from "../../core/paint/tube.ts";
import type { Raster } from "../../core/image/raster.ts";
import type { ImageDocument } from "../image-document.ts";
import { alertDialog } from "../../ui/shell/dialog.ts";

interface LoadedTube { info: TubeInfo; cells: Raster[] }

export function tubeTool(ctx: ToolContext, res: Resources): Tool {
  const cache = new Map<string, LoadedTube>();
  let names: string[] = [];
  const refresh = async () => { names = (await res.files("tubes")).filter((f) => /\.tub$/i.test(f)).map((f) => f.replace(/\.tub$/i, "")).sort(); };
  void refresh();
  res.on("changed", (k) => { if (k === "tubes") void refresh(); });
  dynamicChoices.tube = () => names;

  let lastTube = "";
  const load = async (name: string): Promise<LoadedTube | null> => {
    if (cache.has(name)) return cache.get(name)!;
    const read = await readPsp(await res.read("tubes", `${name}.tub`), inflate);
    const info = read.tube ?? { name, step: 100, across: 1, down: 1, count: 1, placement: 1, selection: 0 };
    const t = { info, cells: tubeCells(composite(read.doc), info) };
    cache.set(name, t);
    return t;
  };
  previewSources.tube = async (name) => {
    try { return (await load(name))?.cells[0] ?? null; } catch { return null; }
  };

  let stroke: { image: ImageDocument; before: Uint8ClampedArray; placer: TubePlacer; cells: Raster[]; last: [number, number]; prev: [number, number] | null; dist: number; rect: { minX: number; minY: number; maxX: number; maxY: number } | null } | null = null;

  const stamp = (image: ImageDocument, cell: Raster, x: number, y: number) => {
    const doc = image.doc, layer = activeLayer(doc), d = layer.raster.data, W = doc.width, H = doc.height, sel = doc.selection;
    const x0 = Math.round(x - cell.width / 2), y0 = Math.round(y - cell.height / 2);
    for (let cy = 0; cy < cell.height; cy++) {
      const ty = y0 + cy;
      if (ty < 0 || ty >= H) continue;
      for (let cx = 0; cx < cell.width; cx++) {
        const tx = x0 + cx;
        if (tx < 0 || tx >= W) continue;
        const s = (cy * cell.width + cx) * 4;
        let a = cell.data[s + 3] / 255;
        if (sel) a *= sel.data[ty * W + tx] / 255;
        if (!a) continue;
        const o = (ty * W + tx) * 4, da = d[o + 3] / 255, oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) d[o + c] = (cell.data[s + c] * a + d[o + c] * da * (1 - a)) / oa;
        if (!layer.lockTransparency) d[o + 3] = oa * 255;
      }
    }
    const r = { minX: Math.max(0, x0), minY: Math.max(0, y0), maxX: Math.min(W - 1, x0 + cell.width - 1), maxY: Math.min(H - 1, y0 + cell.height - 1) };
    if (stroke) stroke.rect = stroke.rect ? { minX: Math.min(stroke.rect.minX, r.minX), minY: Math.min(stroke.rect.minY, r.minY), maxX: Math.max(stroke.rect.maxX, r.maxX), maxY: Math.max(stroke.rect.maxY, r.maxY) } : r;
    image.changed({ pixels: r });
  };

  const tryPlace = (image: ImageDocument, x: number, y: number, pressure: number) => {
    if (!stroke) return;
    const i = stroke.placer.place(stroke.dist, stroke.prev, [x, y], pressure, performance.now());
    if (i === null) return;
    stamp(image, stroke.cells[i], x, y);
    stroke.dist = 0;
  };

  return {
    async down(e) {
      const o = ctx.options();
      const name = String(o.tube ?? "");
      if (!name || name === "(none)") { await alertDialog("Picture Tube", "Choose a tube in the Tool Options palette (File > Import > Picture Tubes brings in your PSP 6 tubes)."); return; }
      const layer = activeLayer(e.image.doc);
      if (layer.kind !== "raster" && layer.kind !== "floating") return;
      const tube = await load(name);
      if (!tube) return;
      if (name !== lastTube) {
        lastTube = name;
        setToolOption(ctx.app, CMD.TOOL_PICTURE_TUBE, "step", tube.info.step);
        setToolOption(ctx.app, CMD.TOOL_PICTURE_TUBE, "placement", ["Random", "Continuous"][tube.info.placement] ?? "Continuous");
        setToolOption(ctx.app, CMD.TOOL_PICTURE_TUBE, "selectionMode", ["Random", "Incremental", "Angular", "Pressure", "Velocity"][tube.info.selection] ?? "Random");
      }
      const opts = ctx.options(), scale = Number(opts.scale) / 100;
      const cells = scale === 1 ? tube.cells : tube.cells.map((c) => resample(c, Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale)), "smart"));
      layer.raster = { ...layer.raster, data: new Uint8ClampedArray(layer.raster.data) };
      const placement = opts.placement === "Random" ? 0 : 1;
      const selection = Math.max(0, ["Random", "Incremental", "Angular", "Pressure", "Velocity"].indexOf(String(opts.selectionMode)));
      stroke = { image: e.image, before: new Uint8ClampedArray(layer.raster.data), placer: new TubePlacer(Math.max(1, Math.round(Number(opts.step) * scale)), cells.length, placement, selection), cells, last: [e.x, e.y], prev: null, dist: 0, rect: null };
      // The first cell goes down at once.
      const first = stroke.placer.place(Number.MAX_SAFE_INTEGER, null, [e.x, e.y], e.pressure, performance.now());
      stamp(e.image, cells[first ?? 0], e.x, e.y);
    },
    move(e, dragging) {
      if (!dragging || !stroke || e.image !== stroke.image) return;
      const [lx, ly] = stroke.last;
      stroke.dist += Math.hypot(e.x - lx, e.y - ly);
      stroke.prev = stroke.last;
      stroke.last = [e.x, e.y];
      tryPlace(e.image, e.x, e.y, e.pressure);
    },
    up() {
      if (!stroke) return;
      const s = stroke;
      stroke = null;
      if (!s.rect) return;
      const layer = activeLayer(s.image.doc);
      const patch = patchChange({ data: layer.raster.data, width: layer.raster.width, height: layer.raster.height, channels: 4 }, s.before, s.rect, "Picture Tube", { pixels: s.rect });
      if (patch) ctx.ed.push(patch, s.image, false);
    },
    deactivate() { stroke = null; },
  };
}
