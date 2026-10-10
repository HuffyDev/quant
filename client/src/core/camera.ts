/** /core camera framing. Shared by the canvas and the image that holds the stage while it loads (sizes must match). */
export const CORE_FOV = 45;
export const MIN_DIST = 1.7;
export const MAX_DIST = 7;

/** Frame the whole brain on any aspect (portrait phones need the camera further back). */
export function coreCameraDistance(width: number, height: number): number {
  const half = (CORE_FOV / 2) * (Math.PI / 180);
  const hHalf = Math.atan(Math.tan(half) * (width / Math.max(1, height)));
  return Math.min(MAX_DIST, Math.max(3.2, 1.25 / Math.tan(half), 1.2 / Math.tan(hHalf)));
}
