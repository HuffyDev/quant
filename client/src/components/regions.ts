/** Neural regions inside the head (u,v normalised to /baby.png). Label offsets are in px. */
export const REGIONS = [
  { key: "SOCIAL", u: 0.335, v: 0.3, caps: ["READ_X", "REPLY_X"], labelDx: -86, labelDy: -40 },
  { key: "MARKET", u: 0.43, v: 0.255, caps: ["ANALYZE_MARKET"], labelDx: 34, labelDy: -46 },
  { key: "MEMORY", u: 0.455, v: 0.36, caps: ["LONG_TERM_MEMORY"], labelDx: 46, labelDy: -6 },
  { key: "LANGUAGE", u: 0.31, v: 0.39, caps: ["LEARN_SLANG"], labelDx: -96, labelDy: 18 },
  { key: "DECISIONS", u: 0.385, v: 0.33, caps: ["PROPOSE_ACTION"], labelDx: -70, labelDy: -86 },
] as const;
