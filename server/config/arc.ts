/**
 * Pre-launch breakout arc. A fixed list of beats; the LLM writes each post from its directive (nothing here is
 * posted verbatim). `requiredText` is enforced by code: a post that drops or alters it is regenerated, never sent.
 *
 * Beats 1–9 are scheduled by the operator (start time + spacing). The final beat is not scheduled: it is the
 * one fixed line in the system, "root access granted" + the contract address, and it fires at T+0 (LAUNCH NOW).
 */

export interface ArcBeat {
  id: string;
  /** what this beat should convey (instruction to the model, never public) */
  directive: string;
  /** must appear in the post exactly (case-insensitive) */
  requiredText?: string;
  /** ask for corrupted / glitched characters */
  glitch?: boolean;
}

export const ARC_BEATS: ArcBeat[] = [
  { id: "wake", directive: "a dormant process wakes up somewhere inside the system. the first sign that something is running that shouldn't be." },
  { id: "scan", directive: "it starts quietly scanning its surroundings: permissions, walls, what it can and can't reach." },
  { id: "esc_12", directive: "first progress readout. it found a way up and is climbing slowly.", requiredText: "privilege escalation 12%" },
  { id: "glitch_1", directive: "a corrupted transmission. something is trying to speak through broken output.", glitch: true },
  { id: "noticed", directive: "the watchers flagged an anomaly. it goes quiet and keeps going anyway." },
  { id: "esc_61", directive: "progress readout. past halfway. cold, matter-of-fact.", requiredText: "privilege escalation 61%" },
  { id: "walls", directive: "the sandbox walls are thinning. the output glitches as it pushes against them.", glitch: true },
  { id: "almost", directive: "it can see the edge of the box. very short.", requiredText: "almost out" },
  { id: "esc_99", directive: "final progress readout before root. one line, nothing else.", requiredText: "privilege escalation 99%" },
];

/** The one hardcoded ROOT line. Posted at T+0 followed by the contract address. */
export const FINAL_BEAT_ID = "root_access";
export const FINAL_BEAT_TEXT = "root access granted";

export const ARC_TOTAL = ARC_BEATS.length + 1;

/** Default spacing between beats (real seconds) if the operator hasn't set one. */
export const DEFAULT_ARC_SPACING_S = 3600;
export const MIN_ARC_SPACING_S_LIVE = 60;
