/*
  The resource libraries PSP 6 keeps in its folders: gradients (.jgd), patterns (.pat, BMP),
  paper textures (.tex, greyscale BMP), picture tubes (.tub), picture frames (.pfr), effect
  presets, palettes (.pal), user filters, and custom brushes.

  They live in OPFS under jspaintshop/resources/<kind>/. JSPaintShop ships none of PSP's own;
  File > Import's entries copy them from the user's own copy of PSP 6. Built-in
  gradients are always there.
*/
import { Emitter } from "../shared/emitter.ts";
import { ROOT, listDirectory, readBytes, writeBytesToFile, removePath } from "../shared/opfs.ts";
import type { WorkerClient } from "../shared/worker-client.ts";
import { BUILTIN_GRADIENTS, readJgd, writeJgd, type Gradient } from "../core/paint/gradient.ts";
import type { Raster } from "../core/image/raster.ts";
import { luminance } from "../core/color/color-space.ts";
import type { ReadResult } from "../worker/file-handlers.ts";
import { mergeLayers } from "../core/layers/composite.ts";

export type ResourceKind = "gradients" | "patterns" | "textures" | "tubes" | "frames" | "presets" | "palettes" | "filters" | "brushes" | "help";

export const RESOURCE_DIR = `${ROOT}/resources`;

export interface Texture { name: string; width: number; height: number; data: Uint8Array }
export interface CustomBrush { name: string; size: number; data: Uint8Array }

export class Resources extends Emitter<{ changed: ResourceKind }> {
  gradients: Gradient[] = [...BUILTIN_GRADIENTS];
  patterns: { name: string; raster: Raster }[] = [];
  textures: Texture[] = [];
  brushes: CustomBrush[] = [];
  private worker: WorkerClient;

  constructor(worker: WorkerClient) {
    super();
    this.worker = worker;
  }

  async files(kind: ResourceKind): Promise<string[]> {
    return (await listDirectory(`${RESOURCE_DIR}/${kind}`)).filter((e) => e.kind === "file").map((e) => e.name);
  }

  read(kind: ResourceKind, name: string): Promise<Uint8Array> {
    return readBytes(`${RESOURCE_DIR}/${kind}/${name}`);
  }

  async write(kind: ResourceKind, name: string, bytes: Uint8Array): Promise<void> {
    await writeBytesToFile(`${RESOURCE_DIR}/${kind}/${name}`, bytes);
  }

  async remove(kind: ResourceKind, name: string): Promise<void> {
    await removePath(`${RESOURCE_DIR}/${kind}/${name}`);
  }

  private async decode(bytes: Uint8Array, name: string): Promise<Raster | null> {
    try {
      const r = await this.worker.call<ReadResult>("file.read", { bytes, name });
      return mergeLayers(r.doc, r.doc.layers);
    } catch {
      return null;
    }
  }

  /** Read everything stored; each kind that loads tells its listeners. */
  async load(): Promise<void> {
    await Promise.all([this.loadGradients(), this.loadPatterns(), this.loadTextures(), this.loadBrushes()]);
  }

  async loadGradients(): Promise<void> {
    const list = [...BUILTIN_GRADIENTS];
    for (const f of await this.files("gradients")) {
      try { for (const g of readJgd(await this.read("gradients", f))) if (!list.some((x) => x.name === g.name)) list.push(g); } catch { /* not a gradient file */ }
    }
    this.gradients = list;
    this.emit("changed", "gradients");
  }

  /** Save a user gradient (Gradient Editor), one .jgd file per gradient as PSP keeps them. */
  async saveGradient(g: Gradient): Promise<void> {
    await this.write("gradients", `${g.name.replace(/[\\/:*?"<>|]/g, "_")}.jgd`, writeJgd([g]));
    await this.loadGradients();
  }

  async deleteGradient(name: string): Promise<void> {
    await this.remove("gradients", `${name.replace(/[\\/:*?"<>|]/g, "_")}.jgd`);
    await this.loadGradients();
  }

  async loadPatterns(): Promise<void> {
    const out: { name: string; raster: Raster }[] = [];
    for (const f of await this.files("patterns")) {
      const r = await this.decode(await this.read("patterns", f), f);
      if (r) out.push({ name: f.replace(/\.[^.]*$/, ""), raster: r });
    }
    this.patterns = out;
    this.emit("changed", "patterns");
  }

  async loadTextures(): Promise<void> {
    const out: Texture[] = [];
    for (const f of await this.files("textures")) {
      const r = await this.decode(await this.read("textures", f), f);
      if (!r) continue;
      const data = new Uint8Array(r.width * r.height);
      for (let i = 0; i < data.length; i++) data[i] = luminance(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]);
      out.push({ name: f.replace(/\.[^.]*$/, ""), width: r.width, height: r.height, data });
    }
    this.textures = out;
    this.emit("changed", "textures");
  }

  texture(name: string): Texture | null {
    return this.textures.find((t) => t.name === name) ?? null;
  }

  async loadBrushes(): Promise<void> {
    try {
      const json = JSON.parse(new TextDecoder().decode(await this.read("brushes", "brushes.json"))) as { name: string; size: number; data: number[] }[];
      this.brushes = json.map((b) => ({ name: b.name, size: b.size, data: Uint8Array.from(b.data) }));
    } catch {
      this.brushes = [];
    }
    this.emit("changed", "brushes");
  }

  async saveBrushes(): Promise<void> {
    await this.write("brushes", "brushes.json", new TextEncoder().encode(JSON.stringify(this.brushes.map((b) => ({ name: b.name, size: b.size, data: [...b.data] })))));
    this.emit("changed", "brushes");
  }
}
