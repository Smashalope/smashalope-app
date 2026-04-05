import { supabase } from "./supabase.js";

/**
 * Expected `bracket_structure` shape:
 * {
 *   format: string,
 *   total_matchups: number,
 *   rounds: [{ round, name, matchups: [{ index, day, product_a, product_b, ... }] }]
 * }
 *
 * Flattens all `matchups` from every `round` in order (round order, then matchup order).
 */
export function flattenMatchups(bracketStructure) {
  if (!bracketStructure || typeof bracketStructure !== "object") return [];
  const rounds = bracketStructure.rounds;
  if (!Array.isArray(rounds)) return [];

  const out = [];
  for (const round of rounds) {
    const matchups = round?.matchups;
    if (!Array.isArray(matchups)) continue;
    for (const m of matchups) {
      out.push(m);
    }
  }
  return out;
}

/**
 * Calendar days from `startDate` to `referenceDate` (local midnight), inclusive of the start day as offset 0.
 * Returns a 1-based "season day" where the first calendar day of the season is day 1.
 */
export function getSeasonDayNumber(startDate, referenceDate = new Date()) {
  const s = new Date(startDate);
  const r = new Date(referenceDate);
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const ref = new Date(r.getFullYear(), r.getMonth(), r.getDate());
  const diffDays = Math.round((ref - start) / 86400000);
  return diffDays + 1;
}

/**
 * @returns {[string, string]} product UUIDs from `product_a` and `product_b`, or [] if missing
 */
export function getProductIdsFromMatchup(matchup) {
  if (!matchup || typeof matchup !== "object") return [];
  const a = matchup.product_a;
  const b = matchup.product_b;
  if (a == null || b == null) return [];
  return [String(a), String(b)];
}

/**
 * Finds today's matchup: among all flattened matchups, the one whose `day` equals the season day number.
 * `matchup_index` for the votes table is the matchup's `index` field, not its position in the flattened array.
 *
 * @param {unknown} bracketStructure - season.bracket_structure JSON
 * @param {string|Date} seasonStartDate - season.start_date
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ matchup: object, matchupIndex: number } | null}
 */
export function getTodayMatchup(bracketStructure, seasonStartDate, referenceDate = new Date()) {
  const flat = flattenMatchups(bracketStructure);
  const dayNum = getSeasonDayNumber(seasonStartDate, referenceDate);
  const matchup = flat.find((m) => Number(m?.day) === dayNum);
  if (!matchup) return null;

  const rawIndex = matchup.index;
  if (rawIndex === undefined || rawIndex === null) return null;

  const matchupIndex = Number(rawIndex);
  if (!Number.isFinite(matchupIndex)) return null;

  return { matchup, matchupIndex };
}

/**
 * Loads the current active season (status = 'active'). If multiple exist, returns the earliest by start_date.
 */
export async function fetchActiveSeason() {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("status", "active")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
