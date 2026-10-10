import { BRAIN_FOV } from "./quality";

/** root.png's square side in the 3D cloud's units (cloud.ts normalises the brain's half-extent to 1; it fills ~60%). */
const PLATE = 3.35;

/** Image height as a fraction of its container's height so the image brain matches the 3D brain at this camera. */
export const imageScale = (distance: number, fovDeg = BRAIN_FOV) => PLATE / (2 * Math.tan((fovDeg * Math.PI) / 360) * distance);

/**
 * root.png as a glowing brain floating on the page, never a picture: no frame or shadow, screen-blended, a radial
 * mask fading the square's edges to nothing, near-black crushed to pure black. It is the static fallback and also sits
 * under every 3D canvas while that loads; the canvas fades in over it (600ms) and it hides once covered.
 * The parent must be positioned (and clip, if `scale` > 1).
 */
export function BrainImage({ scale, hidden = false, dormant = false }: { scale: number; hidden?: boolean; dormant?: boolean }) {
  return (
    <img
      src="/root.png"
      alt="ROOT — a glowing translucent brain"
      draggable={false}
      decoding="async"
      className={`brain-img ${hidden ? "is-hidden" : ""} ${dormant ? "is-dormant" : ""}`}
      style={{ height: `${(scale * 100).toFixed(1)}%` }}
    />
  );
}
