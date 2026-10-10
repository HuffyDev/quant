import type { Stage } from "@shared/types";

/** Five stage icons cropped from /public/stages.png */
export function stageIcon(stage: Stage): string {
  switch (stage) {
    case "GESTATING":
      return "/stages/gestating.png";
    case "NEONATAL":
    case "POSTNATAL":
      return "/stages/birth.png";
    case "INFANT":
      return "/stages/infant.png";
    case "TODDLER":
    case "CHILD":
      return "/stages/toddler.png";
    default:
      return "/stages/maturity.png";
  }
}
