/** Normalize vote_pct to { left: number|null, right: number|null } for product_a / product_b order */
export function parseVotePct(votePct, productAId, productBId) {
  if (votePct == null) return { left: null, right: null };
  if (typeof votePct === "object" && !Array.isArray(votePct)) {
    const a = votePct[productAId] ?? votePct.a ?? votePct.product_a ?? votePct.left;
    const b = votePct[productBId] ?? votePct.b ?? votePct.product_b ?? votePct.right;
    let na = a != null ? Number(a) : null;
    let nb = b != null ? Number(b) : null;
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na <= 1 && nb <= 1 && na >= 0 && nb >= 0) {
        na = Math.round(na * 100);
        nb = Math.round(nb * 100);
      }
      return { left: na, right: nb };
    }
  }
  if (Array.isArray(votePct) && votePct.length >= 2) {
    let na = Number(votePct[0]);
    let nb = Number(votePct[1]);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na <= 1 && nb <= 1 && na >= 0 && nb >= 0) {
        na = Math.round(na * 100);
        nb = Math.round(nb * 100);
      }
      return { left: na, right: nb };
    }
  }
  return { left: null, right: null };
}
