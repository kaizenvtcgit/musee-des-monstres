// habitatVariety: how many different habitats have monsters on show (each one beyond the first adds a little).
export function computeReputation({ avgSatisfaction, speciesCount, escapesLast5Min, habitatVariety = 0 }) {
  const variety = Math.min(Math.max(0, habitatVariety - 1), 6) * 0.1;
  const r = avgSatisfaction * 3 + Math.min(speciesCount, 5) * 0.4 + variety - escapesLast5Min * 0.5;
  return Math.max(0, Math.min(5, r));
}
