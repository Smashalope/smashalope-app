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
/**
 * Collects every non-null product_a / product_b UUID referenced in the bracket (for batch product fetch).
 */
export function collectBracketProductIds(bracketStructure) {
  const ids = new Set();
  const rounds = bracketStructure?.rounds;
  if (!Array.isArray(rounds)) return [];
  for (const round of rounds) {
    for (const m of round?.matchups ?? []) {
      if (m?.product_a != null) ids.add(String(m.product_a));
      if (m?.product_b != null) ids.add(String(m.product_b));
    }
  }
  return [...ids];
}

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
 * Interprets `YYYY-MM-DD` (and ISO strings starting with that date) in the local calendar,
 * avoiding UTC midnight shifts that make `new Date("2025-04-05")` land on the wrong local day.
 */
function toLocalCalendarDate(input) {
  if (input == null) return new Date(NaN);
  if (typeof input === "string") {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Whole calendar days from season start to reference (local dates). Same calendar day → 0.
 * Returns a 1-based "season day" where the first calendar day of the season is day 1
 * (e.g. start Apr 5 + today Apr 5 → 1; today Apr 6 → 2).
 */
export function getSeasonDayNumber(startDate, referenceDate = new Date()) {
  const start = toLocalCalendarDate(startDate);
  const ref = toLocalCalendarDate(referenceDate);
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
