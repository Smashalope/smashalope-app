import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collectBracketProductIds,
  fetchActiveSeason,
  getSeasonDayNumber,
} from "../lib/bracket.js";
import { supabase } from "../lib/supabase.js";

function decidedByLabel(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().replace(/_/g, " ");
  const map = {
    "popular vote": "Popular vote",
    popular: "Popular vote",
    "smashalope upset": "Smashalope upset",
    smashalope: "Smashalope upset",
    chaos: "Chaos",
    "desk guy": "Desk guy",
  };
  if (map[s]) return map[s];
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " ");
}

/** Normalize vote_pct to { left: number|null, right: number|null } for product_a / product_b order */
function parseVotePct(votePct, productAId, productBId) {
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

/**
 * Build "Winner of Day X" strings from feeds_from.
 * Numeric entries are matchup indices (look up `day` on that matchup). Supports explicit
 * { day: N }, { index: N }, and { days: [...] }.
 */
function describeFeedsFrom(feedsFrom, matchupsByIndex) {
  if (feedsFrom == null) return ["TBD", "TBD"];

  const resolveOne = (entry) => {
    if (entry == null) return "TBD";
    if (typeof entry === "number") {
      const m = matchupsByIndex.get(entry);
      if (m?.day != null) return `Winner of Day ${m.day}`;
      return `Winner of matchup ${entry}`;
    }
    if (typeof entry === "object") {
      if (entry.day != null) return `Winner of Day ${entry.day}`;
      if (entry.index != null) {
        const m = matchupsByIndex.get(Number(entry.index));
        if (m?.day != null) return `Winner of Day ${m.day}`;
        return `Winner of matchup ${entry.index}`;
      }
    }
    return "TBD";
  };

  if (Array.isArray(feedsFrom)) {
    const a = resolveOne(feedsFrom[0]);
    const b = feedsFrom.length > 1 ? resolveOne(feedsFrom[1]) : "TBD";
    return [a, b];
  }
  if (typeof feedsFrom === "object" && Array.isArray(feedsFrom.days)) {
    return [
      resolveOne(feedsFrom.days[0]),
      resolveOne(feedsFrom.days[1] ?? feedsFrom.days[0]),
    ];
  }

  return ["TBD", "TBD"];
}

function MatchupCard({
  matchup,
  productsById,
  currentDay,
  matchupsByIndex,
}) {
  const pa = matchup.product_a != null ? String(matchup.product_a) : null;
  const pb = matchup.product_b != null ? String(matchup.product_b) : null;
  const prodA = pa ? productsById.get(pa) : null;
  const prodB = pb ? productsById.get(pb) : null;
  const dayNum = Number(matchup.day);
  const winnerId = matchup.winner != null && matchup.winner !== "" ? String(matchup.winner) : null;

  const hasWinner = Boolean(winnerId);
  const isLive = !hasWinner && Number.isFinite(dayNum) && dayNum === currentDay;
  const hasBothProducts = Boolean(pa && pb);
  const isUpcomingKnown =
    !hasWinner && hasBothProducts && Number.isFinite(dayNum) && dayNum > currentDay;
  const isTbd = !hasWinner && !hasBothProducts;

  const [leftFeed, rightFeed] = describeFeedsFrom(matchup.feeds_from, matchupsByIndex);

  if (hasWinner && hasBothProducts) {
    const pct = parseVotePct(matchup.vote_pct, pa, pb);
    const aWins = winnerId === pa;
    const decided = decidedByLabel(matchup.decided_by);

    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Day {matchup.day}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4">
          <div
            className={`flex-1 rounded-xl border-2 px-3 py-3 ${
              aWins ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-gray-50 opacity-75"
            }`}
          >
            <p className="text-xs font-bold uppercase text-gray-500">{prodA?.brand}</p>
            <p className={`font-bold ${aWins ? "text-emerald-900" : "text-gray-600"}`}>{prodA?.name ?? "—"}</p>
            {pct.left != null && <p className="mt-1 text-lg font-black text-gray-800">{pct.left}%</p>}
          </div>
          <div className="hidden shrink-0 items-center justify-center text-gray-400 sm:flex">vs</div>
          <div
            className={`flex-1 rounded-xl border-2 px-3 py-3 ${
              !aWins ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-gray-50 opacity-75"
            }`}
          >
            <p className="text-xs font-bold uppercase text-gray-500">{prodB?.brand}</p>
            <p className={`font-bold ${!aWins ? "text-emerald-900" : "text-gray-600"}`}>{prodB?.name ?? "—"}</p>
            {pct.right != null && <p className="mt-1 text-lg font-black text-gray-800">{pct.right}%</p>}
          </div>
        </div>
        {decided && (
          <p className="mt-3 text-center text-sm text-gray-600">
            Decided by: <span className="font-semibold text-gray-800">{decided}</span>
          </p>
        )}
      </div>
    );
  }

  if (isLive && hasBothProducts) {
    return (
      <Link
        to="/"
        className="block rounded-2xl border-2 border-emerald-400 bg-white p-4 shadow-lg ring-2 ring-emerald-400/50 ring-offset-2 ring-offset-violet-50 transition hover:ring-emerald-500 animate-pulse"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
            Live now
          </span>
          <span className="text-xs font-medium text-gray-500">Day {matchup.day}</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-violet-600">{prodA?.brand}</p>
            <p className="font-bold text-violet-950">{prodA?.name}</p>
          </div>
          <span className="text-center text-sm font-bold text-gray-400">vs</span>
          <div className="text-right sm:text-left">
            <p className="text-xs font-bold uppercase text-violet-600">{prodB?.brand}</p>
            <p className="font-bold text-violet-950">{prodB?.name}</p>
          </div>
        </div>
        <p className="mt-3 text-center text-sm font-semibold text-emerald-700">Tap to vote →</p>
      </Link>
    );
  }

  if (isUpcomingKnown) {
    return (
      <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50/50 p-4">
        <p className="mb-3 text-xs font-semibold text-violet-700">Day {matchup.day}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-gray-500">{prodA?.brand}</p>
            <p className="font-bold text-gray-900">{prodA?.name}</p>
          </div>
          <span className="text-center text-sm text-gray-400">vs</span>
          <div className="text-right sm:text-left">
            <p className="text-xs font-bold uppercase text-gray-500">{prodB?.brand}</p>
            <p className="font-bold text-gray-900">{prodB?.name}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isTbd) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-100/80 p-4">
        <p className="mb-3 text-xs font-medium text-gray-500">Day {matchup.day ?? "—"}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-200/60 px-3 py-6 text-center">
            <span className="text-3xl font-black text-gray-400">?</span>
            <p className="mt-1 text-sm font-semibold text-gray-600">{leftFeed}</p>
          </div>
          <span className="text-center text-xs font-bold text-gray-400">vs</span>
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-200/60 px-3 py-6 text-center">
            <span className="text-3xl font-black text-gray-400">?</span>
            <p className="mt-1 text-sm font-semibold text-gray-600">{rightFeed}</p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback: has products but not completed — e.g. past day without winner data
  if (hasBothProducts) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
        <p className="mb-2 text-xs font-semibold text-amber-800">Day {matchup.day}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <p className="font-bold text-gray-900">{prodA?.name}</p>
          <span className="text-gray-400">vs</span>
          <p className="font-bold text-gray-900">{prodB?.name}</p>
        </div>
      </div>
    );
  }

  return null;
}

export default function Bracket() {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [season, setSeason] = useState(null);
  const [productsById, setProductsById] = useState(() => new Map());
  const [currentDay, setCurrentDay] = useState(1);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStatus("loading");
      setError("");
      try {
        const s = await fetchActiveSeason();
        if (cancelled) return;
        if (!s) {
          setSeason(null);
          setStatus("empty");
          return;
        }

        const day = getSeasonDayNumber(s.start_date);
        setCurrentDay(day);

        const ids = collectBracketProductIds(s.bracket_structure);
        let map = new Map();
        if (ids.length > 0) {
          const { data: products, error: pErr } = await supabase
            .from("products")
            .select("id, name, brand")
            .in("id", ids);
          if (pErr) throw pErr;
          map = new Map((products ?? []).map((p) => [p.id, p]));
        }

        if (cancelled) return;
        setSeason(s);
        setProductsById(map);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to load bracket.");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const matchupsByIndex = useMemo(() => {
    const byIdx = new Map();
    const rounds = season?.bracket_structure?.rounds;
    if (!Array.isArray(rounds)) return byIdx;
    for (const r of rounds) {
      for (const m of r?.matchups ?? []) {
        if (m?.index != null) byIdx.set(Number(m.index), m);
      }
    }
    return byIdx;
  }, [season]);

  const seasonTitle =
    season?.name ??
    season?.title ??
    (season?.season_number != null ? `Season ${season.season_number}` : "Current season");

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-violet-50">
      <header className="sticky top-0 z-10 border-b border-violet-200/80 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <Link to="/" className="text-sm font-semibold text-violet-700 hover:underline">
            ← Battle
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 pb-16 sm:px-6">
        {status === "loading" && (
          <p className="text-center text-gray-600">Loading bracket…</p>
        )}

        {status === "error" && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-red-800" role="alert">
            {error}
          </div>
        )}

        {status === "empty" && (
          <p className="text-center text-gray-600">No active season right now.</p>
        )}

        {status === "ready" && season && (
          <>
            <h1 className="mb-8 text-2xl font-black leading-tight text-violet-950 sm:text-3xl">
              {seasonTitle}
            </h1>

            <div className="space-y-10">
              {(season.bracket_structure?.rounds ?? []).map((round, ri) => (
                <section key={`${round.round ?? "r"}-${round.name ?? ri}-${ri}`}>
                  <h2 className="mb-4 border-b border-violet-200 pb-2 text-lg font-bold text-violet-900">
                    {round.name ?? `Round ${round.round}`}
                  </h2>
                  <ul className="space-y-4">
                    {(round.matchups ?? []).map((m, idx) => (
                      <li key={`${ri}-${m.index ?? idx}-${idx}`}>
                        <MatchupCard
                          matchup={m}
                          productsById={productsById}
                          currentDay={currentDay}
                          matchupsByIndex={matchupsByIndex}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
