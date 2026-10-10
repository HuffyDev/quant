import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { proceduralBrain, rng } from "./geometry";
import { regionOf } from "./regions";

export const BRAIN_MODEL_URL = "/models/brain.glb";

export interface BrainCloud {
  /** xyz, normalised (centred, max half-extent 1, +Z front) */
  positions: Float32Array;
  region: Float32Array;
  seed: Float32Array;
  /** 1 = interior point (not on the surface) */
  inner: Uint8Array;
  count: number;
  /** neural filaments: 2 vertices per segment */
  lines: { positions: Float32Array; region: Float32Array; seed: Float32Array; t: Float32Array; count: number };
  /** translucent outer surface (GLB only) */
  shell: THREE.BufferGeometry | null;
  /** region centroids, for labels */
  centroids: THREE.Vector3[];
  source: "model" | "procedural";
}

/** Load /models/brain.glb (meshopt supported, not Draco). Rejects if missing or unparsable. */
async function loadModelGeometry(url: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", mesh.geometry.attributes.position.clone());
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
    g.applyMatrix4(mesh.matrixWorld);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (!parts.length) throw new Error("brain.glb has no meshes");
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("could not merge brain.glb meshes");
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  const c = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const s = 1 / Math.max(half.x, half.y, half.z, 1e-6);
  merged.translate(-c.x, -c.y, -c.z);
  merged.scale(s, s, s);
  return merged;
}

function sampleModel(geo: THREE.BufferGeometry, count: number, seed: number) {
  const rand = rng(seed);
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo));
  // present at runtime, missing from @types/three
  (sampler as unknown as { setRandomGenerator(f: () => number): void }).setRandomGenerator(rand);
  sampler.build();
  const positions = new Float32Array(count * 3);
  const inner = new Uint8Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(v);
    if (rand() < 0.1) {
      const k = 0.2 + rand() * 0.45;
      v.multiplyScalar(k);
      inner[i] = 1;
    }
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  return { positions, inner };
}

function buildLines(pos: Float32Array, region: Float32Array, n: number, maxSeg: number, seed: number) {
  const rand = rng(seed + 1);
  const cell = 0.12;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }
  const out = { positions: new Float32Array(maxSeg * 6), region: new Float32Array(maxSeg * 2), seed: new Float32Array(maxSeg * 2), t: new Float32Array(maxSeg * 2), count: 0 };
  for (let tries = 0; tries < maxSeg * 4 && out.count < maxSeg; tries++) {
    const i = Math.floor(rand() * n);
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const bucket = grid.get(`${cx + Math.round(rand() * 2 - 1)},${cy + Math.round(rand() * 2 - 1)},${cz + Math.round(rand() * 2 - 1)}`);
    if (!bucket) continue;
    const j = bucket[Math.floor(rand() * bucket.length)];
    const d = Math.hypot(pos[j * 3] - x, pos[j * 3 + 1] - y, pos[j * 3 + 2] - z);
    if (j === i || d < 0.035 || d > 0.17) continue;
    const s = out.count;
    out.positions.set([x, y, z, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], s * 6);
    out.region[s * 2] = out.region[s * 2 + 1] = region[i];
    out.seed[s * 2] = out.seed[s * 2 + 1] = rand();
    out.t[s * 2] = 0;
    out.t[s * 2 + 1] = 1;
    out.count++;
  }
  return out;
}

/**
 * Build the brain cloud. Tries the GLB first; falls back to the procedural brain.
 * Points are shuffled so drawing any prefix (setDrawRange) gives an even sample — used for adaptive quality.
 */
export async function buildBrain(count: number, maxLines: number, opts: { model?: boolean } = {}): Promise<BrainCloud> {
  let pts: { positions: Float32Array; inner: Uint8Array };
  let shell: THREE.BufferGeometry | null = null;
  let source: BrainCloud["source"] = "procedural";
  try {
    if (opts.model === false) throw new Error("model disabled");
    const geo = await loadModelGeometry(BRAIN_MODEL_URL);
    pts = sampleModel(geo, count, 11);
    const indexed = mergeVertices(geo);
    indexed.computeVertexNormals();
    shell = indexed;
    source = "model";
  } catch (e) {
    if (opts.model !== false) console.info("[brain] /models/brain.glb unavailable, using procedural brain:", (e as Error).message);
    pts = proceduralBrain(count, 7);
  }

  // shuffle (keeps prefixes even)
  const rand = rng(3);
  const P = pts.positions, I = pts.inner;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let k = 0; k < 3; k++) [P[i * 3 + k], P[j * 3 + k]] = [P[j * 3 + k], P[i * 3 + k]];
    [I[i], I[j]] = [I[j], I[i]];
  }

  const region = new Float32Array(count);
  const seed = new Float32Array(count);
  const sums = Array.from({ length: 6 }, () => ({ v: new THREE.Vector3(), n: 0 }));
  for (let i = 0; i < count; i++) {
    const r = regionOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], I[i] === 1);
    region[i] = r;
    seed[i] = rand();
    if (!I[i]) {
      sums[r].v.add(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      sums[r].n++;
    }
  }
  const centroids = sums.map((s) => (s.n ? s.v.divideScalar(s.n) : new THREE.Vector3()));
  // memory sits in the core: put its label anchor at the centre-bottom of the core
  centroids[2] = new THREE.Vector3(0, -0.05, 0.05);

  return { positions: P, region, seed, inner: I, count, lines: buildLines(P, region, Math.min(count, 9000), maxLines, 5), shell, centroids, source };
}
