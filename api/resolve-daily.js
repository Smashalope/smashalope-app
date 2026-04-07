import { createClient } from "@supabase/supabase-js";

const TZ = "America/New_York";

function parseStartCalendarYmd(startDate) {
  const s = String(startDate ?? "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
  }
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  return {
    y: Number(parts.find((p) => p.type === "year").value),
    mo: Number(parts.find((p) => p.type === "month").value),
    d: Number(parts.find((p) => p.type === "day").value),
  };
}

function getEasternYmd(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  return {
    y: Number(parts.find((p) => p.type === "year").value),
    mo: Number(parts.find((p) => p.type === "month").value),
    d: Number(parts.find((p) => p.type === "day").value),
  };
}

/** Calendar days from start Y-M-D to end Y-M-D (UTC date math on civil dates). */
function civilDiffDays(a, b) {
  const t0 = Date.UTC(a.y, a.mo - 1, a.d);
  const t1 = Date.UTC(b.y, b.mo - 1, b.d);
  return Math.round((t1 - t0) / 86400000);
}

/** 1-based season day: first calendar day of season (Eastern) = Day 1. */
function getSeasonDayNumberEastern(startDate, now = new Date()) {
  const start = parseStartCalendarYmd(startDate);
  if (!start) return null;
  const end = getEasternYmd(now);
  return civilDiffDays(start, end) + 1;
}

function flattenMatchups(structure) {
  const rounds = structure?.rounds;
  if (!Array.isArray(rounds)) return [];
  const out = [];
  for (const r of rounds) {
    for (const m of r?.matchups ?? []) {
      out.push(m);
    }
  }
  return out;
}

function findMatchupForDay(structure, dayNum) {
  const flat = flattenMatchups(structure);
  return flat.find((m) => Number(m?.day) === dayNum) ?? null;
}

function allMatchupsHaveWinners(structure) {
  for (const r of structure?.rounds ?? []) {
    for (const m of r?.matchups ?? []) {
      if (m?.winner == null || m.winner === "") return false;
    }
  }
  return true;
}

function tallyAB(working, productA, productB) {
  const sa = String(productA);
  const sb = String(productB);
  let a = 0;
  let b = 0;
  for (const v of working) {
    const id = String(v.product_id);
    if (id === sa) a += 1;
    else if (id === sb) b += 1;
  }
  return { a, b };
}

function sortVotesLatestFirst(working) {
  return [...working].sort((a, b) => {
    const tb = new Date(b.voted_at ?? 0).getTime();
    const ta = new Date(a.voted_at ?? 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });
}

function pickWinnerFromVotes(votes, productA, productB) {
  let working = (votes ?? []).filter((v) => {
    const id = String(v.product_id);
    return id === String(productA) || id === String(productB);
  });

  if (working.length === 0) {
    return {
      winnerId: Math.random() < 0.5 ? String(productA) : String(productB),
      decidedBy: "desk_guy",
      counts: { a: 0, b: 0 },
    };
  }

  let cA = 0;
  let cB = 0;
  for (;;) {
    const t = tallyAB(working, productA, productB);
    cA = t.a;
    cB = t.b;
    if (cA !== cB) {
      const winnerId = cA > cB ? String(productA) : String(productB);
      return {
        winnerId,
        decidedBy: "popular_vote",
        counts: { a: cA, b: cB },
      };
    }
    if (working.length <= 1) {
      break;
    }
    working = sortVotesLatestFirst(working).slice(1);
  }

  return {
    winnerId: Math.random() < 0.5 ? String(productA) : String(productB),
    decidedBy: "desk_guy",
    counts: { a: cA, b: cB },
  };
}

/** Whoever has fewer votes after the same tie-break as pickWinnerFromVotes (discard latest until unequal). Chaos winner = this product id. */
function pickLoserFromVotes(votes, productA, productB) {
  let working = (votes ?? []).filter((v) => {
    const id = String(v.product_id);
    return id === String(productA) || id === String(productB);
  });

  if (working.length === 0) {
    return Math.random() < 0.5 ? String(productA) : String(productB);
  }

  let cA = 0;
  let cB = 0;
  for (;;) {
    const t = tallyAB(working, productA, productB);
    cA = t.a;
    cB = t.b;
    if (cA < cB) return String(productA);
    if (cB < cA) return String(productB);
    if (working.length <= 1) {
      break;
    }
    working = sortVotesLatestFirst(working).slice(1);
  }

  return Math.random() < 0.5 ? String(productA) : String(productB);
}

function buildVotePct(productA, productB, cA, cB) {
  const total = cA + cB;
  if (total <= 0) {
    return { [String(productA)]: 50, [String(productB)]: 50 };
  }
  let pctA = Math.round((cA / total) * 100);
  let pctB = 100 - pctA;
  if (pctA + pctB !== 100) pctB = 100 - pctA;
  return { [String(productA)]: pctA, [String(productB)]: pctB };
}

function applyWinnerToStructure(structure, resolvedIndex, winnerId, decidedBy, votePct, smashalopeOutcome) {
  const copy = JSON.parse(JSON.stringify(structure));
  let resolved = null;

  for (const round of copy.rounds ?? []) {
    for (const m of round.matchups ?? []) {
      if (Number(m.index) === Number(resolvedIndex)) {
        m.winner = winnerId;
        m.decided_by = decidedBy;
        m.vote_pct = votePct;
        m.smashalope_outcome = smashalopeOutcome ?? null;
        resolved = m;
      }
    }
  }

  if (!resolved) return copy;

  const idx = Number(resolvedIndex);
  for (const round of copy.rounds ?? []) {
    for (const m of round.matchups ?? []) {
      const ff = m.feeds_from;
      if (!Array.isArray(ff)) continue;
      const f0 = ff[0];
      const f1 = ff[1];
      if (f0 !== undefined && f0 !== null && Number(f0) === idx) {
        m.product_a = winnerId;
      }
      if (f1 !== undefined && f1 !== null && Number(f1) === idx) {
        m.product_b = winnerId;
      }
    }
  }

  return copy;
}

/** Vercel serverless: Node-style req/res. */
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: season, error: seasonErr } = await supabase
      .from("seasons")
      .select("id, name, start_date, status, bracket_structure")
      .eq("status", "active")
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (seasonErr) throw seasonErr;
    if (!season) {
      return res.status(404).json({ error: "No active season" });
    }

    const structure = season.bracket_structure;
    if (!structure?.rounds?.length) {
      return res.status(400).json({ error: "Season has no bracket_structure" });
    }

    const dayNum = getSeasonDayNumberEastern(season.start_date, new Date());
    if (dayNum == null || dayNum < 1) {
      return res.status(400).json({ error: "Invalid season start_date" });
    }

    const matchup = findMatchupForDay(structure, dayNum);
    if (!matchup) {
      return res.status(200).json({
        resolved: false,
        reason: "no_matchup_today",
        season_day: dayNum,
        message: `No matchup scheduled for season day ${dayNum}`,
      });
    }

    const matchupIndex = Number(matchup.index);
    if (!Number.isFinite(matchupIndex)) {
      return res.status(400).json({ error: "Matchup missing index" });
    }

    if (matchup.winner != null && matchup.winner !== "") {
      const { data: wProd } = await supabase
        .from("products")
        .select("id, name")
        .eq("id", matchup.winner)
        .maybeSingle();

      return res.status(200).json({
        resolved: false,
        reason: "already_resolved",
        idempotent: true,
        winner: wProd ? { id: wProd.id, name: wProd.name } : { id: matchup.winner, name: null },
        vote_pct: matchup.vote_pct ?? null,
        decided_by: matchup.decided_by ?? null,
        season_complete: allMatchupsHaveWinners(structure),
      });
    }

    const productA = matchup.product_a;
    const productB = matchup.product_b;
    if (productA == null || productB == null) {
      return res.status(400).json({
        error: "Today's matchup is missing product_a or product_b",
        season_day: dayNum,
      });
    }

    const { data: votes, error: votesErr } = await supabase
      .from("votes")
      .select("id, product_id, voted_at")
      .eq("season_id", season.id)
      .eq("matchup_index", matchupIndex);

    if (votesErr) throw votesErr;

    const { data: smashLog, error: smashErr } = await supabase
      .from("smashalope_log")
      .select("id, user_id, decision, decision_product_id")
      .eq("season_id", season.id)
      .eq("matchup_index", matchupIndex)
      .maybeSingle();

    if (smashErr) throw smashErr;

    const list = votes ?? [];
    const fullTally = tallyAB(list, productA, productB);
    const votePct = buildVotePct(productA, productB, fullTally.a, fullTally.b);

    const popularResult = pickWinnerFromVotes(list, productA, productB);
    const popularWinnerId = popularResult.winnerId;
    const popularDecidedBy = popularResult.decidedBy;

    let finalWinnerId = popularWinnerId;
    let finalDecidedBy = popularDecidedBy;
    /** @type {string | null} */
    let smashalopeOutcome = null;
    let overrodePopular = false;

    const hasSmashalope =
      smashLog &&
      smashLog.user_id != null &&
      String(smashLog.user_id).trim() !== "";

    if (hasSmashalope) {
      const dec = smashLog.decision;

      if (dec === "product_a" || dec === "product_b") {
        let pickId = smashLog.decision_product_id;
        if (pickId == null || pickId === "") {
          pickId = dec === "product_a" ? productA : productB;
        }
        pickId = String(pickId);
        const validPick = pickId === String(productA) || pickId === String(productB);
        if (!validPick) {
          finalWinnerId = popularWinnerId;
          finalDecidedBy = popularDecidedBy;
          smashalopeOutcome = null;
          overrodePopular = false;
        } else {
          finalWinnerId = pickId;
          overrodePopular = pickId !== String(popularWinnerId);
          if (pickId === String(popularWinnerId)) {
            finalDecidedBy = "smashalope_upheld";
            smashalopeOutcome = "upheld";
          } else {
            finalDecidedBy = "smashalope_upset";
            smashalopeOutcome = "upset";
          }
        }
      } else if (dec === "chaos") {
        const filtered = (list ?? []).filter((v) => {
          const id = String(v.product_id);
          return id === String(productA) || id === String(productB);
        });
        if (filtered.length === 0) {
          finalWinnerId =
            String(popularWinnerId) === String(productA) ? String(productB) : String(productA);
        } else {
          finalWinnerId = pickLoserFromVotes(list, productA, productB);
        }
        finalDecidedBy = "chaos";
        smashalopeOutcome = "chaos";
        overrodePopular = String(finalWinnerId) !== String(popularWinnerId);
      } else {
        finalWinnerId = popularWinnerId;
        finalDecidedBy = popularDecidedBy;
        smashalopeOutcome = "abstain";
        overrodePopular = false;
      }
    }

    const updatedStructure = applyWinnerToStructure(
      structure,
      matchupIndex,
      finalWinnerId,
      finalDecidedBy,
      votePct,
      smashalopeOutcome
    );

    const seasonComplete = allMatchupsHaveWinners(updatedStructure);

    const updates = {
      bracket_structure: updatedStructure,
      ...(seasonComplete ? { status: "complete" } : {}),
    };

    const { error: upErr } = await supabase.from("seasons").update(updates).eq("id", season.id);

    if (upErr) throw upErr;

    if (smashLog?.id) {
      const { error: logUpErr } = await supabase
        .from("smashalope_log")
        .update({ vote_pct_at_call: votePct })
        .eq("id", smashLog.id);
      if (logUpErr) throw logUpErr;
    }

    const { data: winnerRow } = await supabase
      .from("products")
      .select("id, name")
      .eq("id", finalWinnerId)
      .maybeSingle();

    const { data: popularWinnerRow } = await supabase
      .from("products")
      .select("id, name")
      .eq("id", popularWinnerId)
      .maybeSingle();

    return res.status(200).json({
      resolved: true,
      winner: { id: finalWinnerId, name: winnerRow?.name ?? null },
      vote_pct: votePct,
      decided_by: finalDecidedBy,
      smashalope_outcome: smashalopeOutcome,
      smashalope_overrode_popular_vote: overrodePopular,
      popular_vote_winner: {
        id: popularWinnerId,
        name: popularWinnerRow?.name ?? null,
      },
      season_complete: seasonComplete,
      season_day: dayNum,
      matchup_index: matchupIndex,
    });
  } catch (e) {
    console.error("resolve-daily:", e);
    return res.status(500).json({
      error: e?.message ?? "Internal server error",
    });
  }
}
