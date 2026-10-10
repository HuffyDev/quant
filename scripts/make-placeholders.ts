/**
 * npm run placeholders — regenerate the placeholder media (only files that don't exist yet, unless --force):
 *   public/root.png            logo / favicon / OG image          (replace with the real one)
 *   public/models/brain.glb    only with --glb: procedural placeholder mesh (normally absent: root.png is sampled instead)
 * Needs Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium) for the PNG. (The stream video is real: public/media/hacker.mp4.)
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { chromium } from "playwright-core";
import { cerebellumPoint, cortexPoint, stemPoint } from "../client/src/brain/geometry";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pub = (p: string) => path.join(root, "public", p);
const force = process.argv.includes("--force");
const need = (p: string) => force || !fs.existsSync(pub(p));
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

// ── brain.glb ────────────────────────────────────────────────────────────────
function mapGeometry(g: THREE.BufferGeometry, f: (x: number, y: number, z: number, i: number) => [number, number, number]) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = f(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    pos.setXYZ(i, x, y, z);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

async function makeGlb() {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) parts.push(mapGeometry(new THREE.SphereGeometry(1, 160, 120), (x, y, z) => cortexPoint(x, y, z, side)));
  parts.push(mapGeometry(new THREE.SphereGeometry(1, 96, 64), (x, y, z) => cerebellumPoint(x, y, z)));
  const stem = new THREE.CylinderGeometry(1, 1, 1, 32, 16, true);
  parts.push(mapGeometry(stem, (x, y, z) => stemPoint(0.5 - y, Math.atan2(z, x))));
  const merged = mergeGeometries(parts.map((g) => (g.index ? g : g)), false)!;
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x9fd6ff }));
  mesh.name = "brain_placeholder";
  const scene = new THREE.Scene();
  scene.add(mesh);

  // GLTFExporter's binary path uses FileReader (browser API): minimal Node shim
  (globalThis as unknown as { FileReader: unknown }).FileReader = class {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) {
      void b.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((buf) => {
        (this as unknown as { result: string }).result = `data:application/octet-stream;base64,${Buffer.from(buf).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  fs.mkdirSync(pub("models"), { recursive: true });
  fs.writeFileSync(pub("models/brain.glb"), Buffer.from(glb));
  console.log(`wrote public/models/brain.glb (${(glb.byteLength / 1e6).toFixed(2)} MB)`);
}

// ── root.png ─────────────────────────────────────────────────────────────────
const LOGO_HTML = `<!doctype html><html><body style="margin:0;background:#000">
<div style="width:1024px;height:1024px;display:grid;place-items:center;background:radial-gradient(50% 50% at 50% 45%,#0b2340 0,#000 70%);font-family:'DejaVu Sans Mono',monospace">
  <div style="text-align:center">
    <div style="font-size:300px;font-weight:700;line-height:1;color:#dff1ff;text-shadow:0 0 30px #5aa9f0,0 0 90px #2d6fbf;letter-spacing:-10px">#_</div>
    <div style="margin-top:40px;font-size:120px;font-weight:700;letter-spacing:24px;color:#e8f6ff;text-shadow:0 0 24px #5aa9f0">ROOT</div>
    <div style="margin-top:20px;font-size:28px;letter-spacing:10px;color:#5f88a8">PLACEHOLDER</div>
  </div></div></body></html>`;

async function withBrowser<T>(fn: (b: import("playwright-core").Browser) => Promise<T>) {
  const b = await chromium.launch({ executablePath: CHROMIUM });
  try {
    return await fn(b);
  } finally {
    await b.close();
  }
}

async function makePng() {
  await withBrowser(async (b) => {
    const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
    await p.setContent(LOGO_HTML);
    await p.screenshot({ path: pub("root.png") });
  });
  console.log("wrote public/root.png");
}

if (process.argv.includes("--glb") && need("models/brain.glb")) await makeGlb();
if (need("root.png")) await makePng();
console.log("placeholders done");
