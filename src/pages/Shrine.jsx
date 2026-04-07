import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { parseVotePct } from "../lib/votePct.js";

function findMatchupByIndex(bracketStructure, matchupIndex) {
  const rounds = bracketStructure?.rounds;
  if (!Array.isArray(rounds)) return null;
  for (const r of rounds) {
    for (const m of r?.matchups ?? []) {
      if (Number(m?.index) === Number(matchupIndex)) return m;
    }
  }
  return null;
}

/** Higher vote share at 8 PM; tie → product_a as tie-break for narrative. */
function popularWinnerIdFromPct(votePct, productAId, productBId) {
  const { left, right } = parseVotePct(votePct, productAId, productBId);
  if (left == null || right == null) return null;
  if (left > right) return String(productAId);
  if (right > left) return String(productBId);
  return String(productAId);
}

function displayName(profile) {
  if (!profile) return "Unknown Smashalope";
  if (profile.revealed === false) return "Anonymous Smashalope";
  return profile.username?.trim() || "Unknown Smashalope";
}

function buildShrineNarrative(log, profile, nameA, nameB, pa, pb, matchupWinnerId) {
  const label = displayName(profile);
  const pickName = (id) => (String(id) === String(pa) ? nameA : nameB);

  const dec = log.decision;
  const popularId = popularWinnerIdFromPct(log.vote_pct_at_call, pa, pb);
  const popularName = popularId ? pickName(popularId) : "the favorite";

  if (dec === "abstain") {
    return `${label} went to the beach. The people decided this one.`;
  }

  if (dec === "chaos") {
    const advancerId = matchupWinnerId != null && matchupWinnerId !== "" ? String(matchupWinnerId) : null;
    const advancerName = advancerId ? pickName(advancerId) : "the underdog";
    return `${label} chose chaos. The people wanted ${popularName}, but ${advancerName} advances.`;
  }

  if (dec === "product_a" || dec === "product_b") {
    let pickedId = log.decision_product_id;
    if (pickedId == null || pickedId === "") {
      pickedId = dec === "product_a" ? pa : pb;
    }
    pickedId = String(pickedId);
    const pickedName = pickName(pickedId);
    const matched = popularId && pickedId === String(popularId);
    if (matched) {
      return `${label} picked ${pickedName}. So did everyone else.`;
    }
    return `${label} picked ${pickedName}. The people disagreed. ${pickedName} advances anyway.`;
  }

  return `${label} left a mark on the altar.`;
}

function formatShrineDate(iso) {
  if (iso == null || iso === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function Shrine() {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStatus("loading");
      setError("");
      try {
        const { data: logs, error: logErr } = await supabase
          .from("smashalope_log")
          .select(
            "id, user_id, season_id, matchup_index, decision, decision_product_id, vote_pct_at_call, created_at"
          )
          .not("user_id", "is", null)
          .order("created_at", { ascending: false });

        if (logErr) throw logErr;
        const list = logs ?? [];
        if (list.length === 0) {
          if (!cancelled) {
            setEntries([]);
            setStatus("ready");
          }
          return;
        }

        const userIds = [...new Set(list.map((l) => l.user_id).filter(Boolean))];
        const seasonIds = [...new Set(list.map((l) => l.season_id).filter(Boolean))];

        const [{ data: profiles, error: pErr }, { data: seasons, error: sErr }] = await Promise.all([
          userIds.length
            ? supabase.from("profiles").select("*").in("id", userIds)
            : Promise.resolve({ data: [], error: null }),
          seasonIds.length
            ? supabase.from("seasons").select("id, bracket_structure, name").in("id", seasonIds)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (pErr) throw pErr;
        if (sErr) throw sErr;

        const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]));
        const seasonById = new Map((seasons ?? []).map((s) => [String(s.id), s]));

        const productIds = new Set();
        for (const log of list) {
          const season = seasonById.get(String(log.season_id));
          const m = season ? findMatchupByIndex(season.bracket_structure, log.matchup_index) : null;
          if (m?.product_a) productIds.add(String(m.product_a));
          if (m?.product_b) productIds.add(String(m.product_b));
          if (log.decision_product_id) productIds.add(String(log.decision_product_id));
        }

        const idList = [...productIds];
        let productById = new Map();
        if (idList.length > 0) {
          const { data: products, error: prodErr } = await supabase
            .from("products")
            .select("id, name, brand")
            .in("id", idList);
          if (prodErr) throw prodErr;
          productById = new Map((products ?? []).map((p) => [String(p.id), p]));
        }

        const built = list.map((log) => {
          const season = seasonById.get(String(log.season_id));
          const matchup = season ? findMatchupByIndex(season?.bracket_structure, log.matchup_index) : null;
          const pa = matchup?.product_a != null ? String(matchup.product_a) : null;
          const pb = matchup?.product_b != null ? String(matchup.product_b) : null;
          const prodA = pa ? productById.get(pa) : null;
          const prodB = pb ? productById.get(pb) : null;
          const nameA = prodA?.name ?? "—";
          const nameB = prodB?.name ?? "—";
          const winnerId =
            matchup?.winner != null && matchup.winner !== "" ? String(matchup.winner) : null;
          const profile = profileById.get(String(log.user_id));

          const narrative =
            pa && pb
              ? buildShrineNarrative(log, profile, nameA, nameB, pa, pb, winnerId)
              : "The record is incomplete.";

          const pct = parseVotePct(log.vote_pct_at_call, pa, pb);
          const voteLine =
            pct.left != null && pct.right != null
              ? `${nameA} ${pct.left}% — ${pct.right}% ${nameB}`
              : "Vote tally at the call unavailable.";

          return {
            id: log.id,
            dateLabel: formatShrineDate(log.created_at),
            seasonTitle: season?.name ?? "Season",
            matchupLine: pa && pb ? `${nameA} vs ${nameB}` : "Unknown matchup",
            displayLabel: displayName(profile),
            narrative,
            voteLine,
          };
        });

        if (!cancelled) {
          setEntries(built);
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message ?? "Could not load the shrine.");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-amber-950/20 to-stone-950 text-amber-50">
      <header className="border-b border-amber-700/30 bg-black/40 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <Link
            to="/"
            className="text-sm font-medium text-amber-400/90 transition hover:text-amber-200 hover:underline"
          >
            ← Back to battle
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-600/90">Hall of fate</p>
            <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight text-amber-100 sm:text-4xl">
              The Smashalope Shrine
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-amber-200/75">
              Every Golden Smashalope leaves a trace. Read the old verdicts — amber on stone.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        {status === "loading" && (
          <p className="text-center text-amber-200/70">Opening the archives…</p>
        )}

        {status === "error" && error && (
          <div
            className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-center text-sm text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {status === "ready" && entries.length === 0 && (
          <div className="rounded-2xl border border-amber-800/40 bg-stone-900/60 px-6 py-12 text-center shadow-inner shadow-black/40">
            <p className="font-serif text-lg text-amber-100/90 sm:text-xl">
              The altar stands empty. No Smashalope has been chosen yet.
            </p>
          </div>
        )}

        {status === "ready" && entries.length > 0 && (
          <ul className="space-y-6">
            {entries.map((row) => (
              <li key={row.id}>
                <article className="rounded-2xl border border-amber-700/35 bg-gradient-to-br from-stone-900/90 via-stone-950 to-black/80 p-5 shadow-lg shadow-amber-950/20 ring-1 ring-amber-500/10">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-600/90">
                    {row.dateLabel}
                  </p>
                  <p className="mt-1 text-xs text-amber-200/50">{row.seasonTitle}</p>
                  <h2 className="mt-3 font-serif text-xl font-bold text-amber-100">{row.matchupLine}</h2>
                  <p className="mt-2 text-sm font-semibold text-amber-400/95">{row.displayLabel}</p>
                  <p className="mt-4 text-sm leading-relaxed text-amber-100/90">{row.narrative}</p>
                  <p className="mt-4 border-t border-amber-800/40 pt-3 text-center text-sm font-medium tabular-nums text-amber-200/85">
                    {row.voteLine}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
