import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Pin } from "@shared/pins";
import { PIN_REGIONS } from "@shared/pins";
import { buildBrain, type BrainCloud } from "../brain/cloud";
import { BrainScene, useOnScreen } from "../brain/QuantumBrain";
import { TIERS, useAdaptiveTier, type Tier } from "../brain/quality";
import { CORE_FOV, coreCameraDistance, MAX_DIST, MIN_DIST } from "./camera";
import { REGION_INDEX } from "../brain/regions";
import { clusterPins, hash32, type ScreenPin } from "./cluster";

/**
 * /core canvas: the brain under OrbitControls (rotate any direction, clamped zoom, damping, auto-rotate after 4s idle)
 * plus pins. Pins are placed deterministically on surface points of their region, projected to screen every other
 * frame, hidden on the far side, clustered when dense, and drawn as a pooled DOM overlay (cheap, tappable, no
 * per-pin draw calls).
 */

const IDLE_MS = 4000;

/** Surface point indices per pin region (BREACH = the crown, where it broke out). */
function regionPoints(cloud: BrainCloud): number[][] {
  const out: number[][] = PIN_REGIONS.map(() => []);
  let maxY = -Infinity;
  for (let i = 0; i < cloud.count; i++) if (!cloud.inner[i]) maxY = Math.max(maxY, cloud.positions[i * 3 + 1]);
  for (let i = 0; i < cloud.count; i++) {
    if (cloud.inner[i]) continue;
    const y = cloud.positions[i * 3 + 1];
    if (y > maxY - 0.16) out[PIN_REGIONS.indexOf("BREACH")].push(i);
    out[cloud.region[i]].push(i);
  }
  // MEMORY is the core: its surface share is tiny, so also allow its interior points
  if (out[REGION_INDEX.MEMORY].length < 50) for (let i = 0; i < cloud.count; i++) if (cloud.region[i] === REGION_INDEX.MEMORY) out[REGION_INDEX.MEMORY].push(i);
  return out;
}

export interface CoreHandle {
  /** fly the camera toward a brain-local point */
  flyTo: (local: THREE.Vector3, zoom: number) => void;
}

interface OverlayProps {
  cloud: BrainCloud;
  pins: Pin[];
  visible: boolean[];
  selectedId: number | null;
  newSince: Map<number, number>;
  overlay: React.RefObject<HTMLDivElement | null>;
  coarse: boolean;
  onSelect: (id: number) => void;
}

/** Rotation limit (rad) for the front-facing image cloud; a real brain.glb rotates freely. */
const IMAGE_LIMIT = THREE.MathUtils.degToRad(55);

function Controls({ fly, limited }: { fly: React.MutableRefObject<{ target: THREE.Vector3; dist: number } | null>; limited: boolean }) {
  const { camera, gl, size } = useThree();
  // frame the whole brain on any aspect (portrait phones need the camera further back)
  useEffect(() => {
    camera.position.setLength(coreCameraDistance(size.width, size.height));
  }, [camera, size.width, size.height]);
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = MIN_DIST;
    c.maxDistance = MAX_DIST;
    if (limited) {
      c.minAzimuthAngle = -IMAGE_LIMIT;
      c.maxAzimuthAngle = IMAGE_LIMIT;
      c.minPolarAngle = Math.PI / 2 - IMAGE_LIMIT;
      c.maxPolarAngle = Math.PI / 2 + IMAGE_LIMIT;
    } else {
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
    }
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    c.autoRotateSpeed = limited ? 0.35 : 0.7;
    c.autoRotate = true;
    return c;
  }, [camera, gl, limited]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      controls.autoRotate = false;
      fly.current = null;
      if (timer) clearTimeout(timer);
    };
    const end = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (controls.autoRotate = true), IDLE_MS);
    };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => {
      if (timer) clearTimeout(timer);
      controls.removeEventListener("start", start);
      controls.removeEventListener("end", end);
      controls.dispose();
    };
  }, [controls, fly]);
  const prevAz = useRef(0);
  useFrame((_, dt) => {
    const f = fly.current;
    if (f) {
      // ease target + distance; stop when close
      controls.target.lerp(f.target, Math.min(1, dt * 4));
      const dir = camera.position.clone().sub(controls.target).normalize();
      const d = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(dir, d + (f.dist - d) * Math.min(1, dt * 4));
      if (controls.target.distanceTo(f.target) < 0.01 && Math.abs(d - f.dist) < 0.01) fly.current = null;
    }
    // limited: idle auto-rotate sways back and forth instead of stopping at the limit
    if (limited && controls.autoRotate) {
      const az = controls.getAzimuthalAngle();
      const edge = IMAGE_LIMIT * 0.6;
      // moving outward past the edge → reverse
      if ((az > edge && az > prevAz.current) || (az < -edge && az < prevAz.current)) controls.autoRotateSpeed = -controls.autoRotateSpeed;
      prevAz.current = az;
    }
    controls.update();
  });
  return null;
}

function PinOverlay({ cloud, pins, visible, selectedId, newSince, overlay, coarse, onSelect, group, fly }: OverlayProps & { group: React.RefObject<THREE.Group | null>; fly: React.MutableRefObject<{ target: THREE.Vector3; dist: number } | null> }) {
  const { camera, size } = useThree();
  const pts = useMemo(() => regionPoints(cloud), [cloud]);
  // brain-local pin positions, cached by id
  const local = useMemo(() => new Map<number, THREE.Vector3>(), [cloud]);
  const posOf = (p: Pin) => {
    let v = local.get(p.id);
    if (!v) {
      const list = pts[PIN_REGIONS.indexOf(p.region)];
      const k = list.length ? list[hash32(p.id) % list.length] : 0;
      v = new THREE.Vector3(cloud.positions[k * 3], cloud.positions[k * 3 + 1], cloud.positions[k * 3 + 2]).multiplyScalar(1.025);
      local.set(p.id, v);
    }
    return v;
  };
  const els = useRef(new Map<string, HTMLDivElement>());
  const clusters = useRef(new Map<string, number[]>());
  const frame = useRef(0);
  const w = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const latest = useRef({ pins, visible, selectedId, newSince, onSelect });
  latest.current = { pins, visible, selectedId, newSince, onSelect };

  // click / tap: delegated from the overlay root
  useEffect(() => {
    const root = overlay.current;
    if (!root) return;
    // pointerdown → pointerup on the same marker (works for mouse and touch, even if the marker re-rendered)
    let downKey: string | null = null;
    const keyOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset.key ?? null;
    const down = (e: Event) => (downKey = keyOf(e));
    const click = (e: Event) => {
      const key = keyOf(e);
      if (!key || key !== downKey) return;
      downKey = null;
      const members = clusters.current.get(key);
      if (!members) return;
      const { pins: P } = latest.current;
      if (members.length === 1) latest.current.onSelect(P[members[0]].id);
      else {
        // zoom into the cluster: centroid of its members, closer in
        const c = new THREE.Vector3();
        for (const i of members) c.add(posOf(P[i]));
        c.divideScalar(members.length);
        group.current?.updateMatrixWorld();
        const target = c.clone().applyMatrix4(group.current!.matrixWorld).multiplyScalar(0.6);
        fly.current = { target, dist: Math.max(MIN_DIST, camera.position.distanceTo(target) * 0.55) };
      }
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointerup", click);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointerup", click);
    };
  });

  useFrame(() => {
    if (++frame.current % 2 !== 0) return;
    const root = overlay.current;
    const g = group.current;
    if (!root || !g) return;
    const { pins: P, visible: V, selectedId: sel, newSince: fresh } = latest.current;
    g.updateMatrixWorld();
    g.getWorldPosition(center);
    const screen: ScreenPin[] = [];
    for (let i = 0; i < P.length; i++) {
      if (!V[i]) continue;
      w.copy(posOf(P[i])).applyMatrix4(g.matrixWorld);
      // far side of the brain: hidden
      toCam.copy(camera.position).sub(w).normalize();
      // image cloud is front-facing within ±55°: every pin is visible
      if (cloud.source !== "image") {
        const facing = w.clone().sub(center).normalize().dot(toCam);
        if (facing < -0.05) continue;
      }
      w.project(camera);
      if (w.z > 1) continue;
      screen.push({ i, x: (w.x * 0.5 + 0.5) * size.width, y: (-w.y * 0.5 + 0.5) * size.height });
    }
    const cs = clusterPins(screen, coarse ? 34 : 24);
    const now = Date.now();
    const seen = new Set<string>();
    clusters.current.clear();
    for (const c of cs) {
      const first = P[c.members[0]];
      const key = c.members.length === 1 ? `p${first.id}` : `c${Math.min(...c.members.map((m) => P[m].id))}`;
      seen.add(key);
      clusters.current.set(key, c.members);
      let el = els.current.get(key);
      if (!el) {
        el = document.createElement("div");
        el.dataset.key = key;
        el.setAttribute("role", "button");
        el.tabIndex = -1;
        const isNew = c.members.length === 1 && now - (fresh.get(first.id) ?? 0) < 2500;
        el.className = isNew ? "pin pin-new" : "pin";
        root.appendChild(el);
        els.current.set(key, el);
      }
      const red = c.members.some((m) => P[m].red);
      const region = first.region.toLowerCase();
      const cls = `pin-${region}${red ? " pin-red" : ""}${c.members.length > 1 ? " pin-cluster" : ""}${c.members.length === 1 && first.id === sel ? " pin-sel" : ""}`;
      if (el.dataset.cls !== cls) {
        el.dataset.cls = cls;
        el.className = [...el.className.split(" ").filter((x) => x === "pin" || x === "pin-new"), ...cls.split(" ")].join(" ");
      }
      const label = c.members.length > 1 ? String(c.members.length) : "";
      if (el.textContent !== label) el.textContent = label;
      el.setAttribute("aria-label", c.members.length > 1 ? `${c.members.length} events, zoom in` : `${first.kind} event`);
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
    }
    for (const [k, el] of els.current)
      if (!seen.has(k)) {
        el.remove();
        els.current.delete(k);
      }
  });
  return null;
}

/** Brain + pins. Builds its own cloud (GLB or procedural). */
export default function CoreCanvas({
  pins,
  visible,
  selectedId,
  newSince,
  onSelect,
  level,
  active,
  startTier,
  onGiveUp,
  onShown,
}: {
  pins: Pin[];
  visible: boolean[];
  selectedId: number | null;
  newSince: Map<number, number>;
  onSelect: (id: number) => void;
  level: number;
  active: number[];
  startTier: Tier;
  onGiveUp: () => void;
  onShown?: () => void;
}) {
  const { tier, capped, onFps } = useAdaptiveTier(startTier, "high", onGiveUp);
  const [cloud, setCloud] = useState<BrainCloud | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const group = useRef<THREE.Group>(null);
  const fly = useRef<{ target: THREE.Vector3; dist: number } | null>(null);
  const onScreen = useOnScreen(wrap);
  const coarse = useMemo(() => matchMedia("(pointer: coarse)").matches, []);

  useEffect(() => {
    let alive = true;
    buildBrain(TIERS[capped].points, TIERS[capped].lines)
      .then((c) => alive && setCloud(c))
      .catch(onGiveUp);
    return () => {
      alive = false;
    };
  }, [capped, onGiveUp]);

  return (
    <div ref={wrap} className="absolute inset-0" data-brain-tier={tier} data-brain-source={cloud?.source ?? "loading"}>
      {cloud && (
        <Canvas
          flat
          frameloop={onScreen ? "always" : "never"}
          dpr={[1, TIERS[tier].dpr]}
          camera={{ position: [0, 0.4, 3.6], fov: CORE_FOV, near: 0.05, far: 30 }}
          gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 1)}
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
        >
          <Controls fly={fly} limited={cloud.source === "image"} />
          <BrainScene cloud={cloud} level={level} active={active} tier={tier} onFps={onFps} onFail={onGiveUp} onShown={onShown} awake={onScreen} spin={0} tilt={[0, 0, 0]}>
            <group ref={group} />
          </BrainScene>
          <PinOverlay cloud={cloud} pins={pins} visible={visible} selectedId={selectedId} newSince={newSince} overlay={overlay} coarse={coarse} onSelect={onSelect} group={group} fly={fly} />
        </Canvas>
      )}
      <div ref={overlay} className="pin-layer" />
    </div>
  );
}
