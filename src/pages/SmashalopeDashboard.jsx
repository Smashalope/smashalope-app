import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchActiveSeason, getProductIdsFromMatchup, getTodayMatchup } from "../lib/bracket.js";
import { useAuth } from "../context/AuthContext.jsx";
import { supabase } from "../lib/supabase.js";

// TODO(revert before launch): Restore the 8 PM ET decision lock.
// 1) import { isPast8PMEastern } from "../lib/easternTime.js";  // or isPast11PMEastern for a later QA cutoff
// 2) Re-add useNowTick (30s) so `now` updates and the UI crosses into locked at 8 PM without refresh.
// 3) Replace the line below with: const locked = isPast8PMEastern(now);
const locked = false;

const CHAOS_HELP =
  "At 8 PM, this automatically sides with whoever is losing — no matter how the votes shift between now and then. It’s a live bet against the majority at the moment of the call.";

function choiceLabel(decision, productA, productB) {
  if (decision === "product_a" && productA) return productA.name;
  if (decision === "product_b" && productB) return productB.name;
  if (decision === "chaos") return "Chaos";
  if (decision === "abstain") return "Go to the beach";
  return "";
}

export default function SmashalopeDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [seasonId, setSeasonId] = useState(null);
  const [matchupIndex, setMatchupIndex] = useState(null);
  const [productA, setProductA] = useState(null);
  const [productB, setProductB] = useState(null);
  const [logRow, setLogRow] = useState(null);
  const [countA, setCountA] = useState(0);
  const [countB, setCountB] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const productAId = productA?.id;
  const productBId = productB?.id;

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadVoteCounts = useCallback(async () => {
    if (!seasonId || matchupIndex == null || !productAId || !productBId) return;
    const { data, error: vErr } = await supabase
      .from("votes")
      .select("product_id")
      .eq("season_id", seasonId)
      .eq("matchup_index", matchupIndex);

    if (vErr) {
      console.error(vErr);
      return;
    }
    let a = 0;
    let b = 0;
    for (const row of data ?? []) {
      const id = String(row.product_id);
      if (id === String(productAId)) a += 1;
      else if (id === String(productBId)) b += 1;
    }
    setCountA(a);
    setCountB(b);
  }, [seasonId, matchupIndex, productAId, productBId]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setStatus("loading");
    setError("");

    try {
      const season = await fetchActiveSeason();
      if (!season) {
        navigate("/", { replace: true });
        return;
      }

      const today = getTodayMatchup(season.bracket_structure, season.start_date);
      if (!today) {
        navigate("/", { replace: true });
        return;
      }

      const ids = getProductIdsFromMatchup(today.matchup);
      if (ids.length < 2) {
        navigate("/", { replace: true });
        return;
      }

      const { data: log, error: logErr } = await supabase
        .from("smashalope_log")
        .select(
          "id, user_id, season_id, matchup_index, decision, decision_product_id, times_changed, final_lock_time, target_time"
        )
        .eq("season_id", season.id)
        .eq("matchup_index", today.matchupIndex)
        .maybeSingle();

      if (logErr) throw logErr;
      if (!log || String(log.user_id) !== String(user.id)) {
        navigate("/", { replace: true });
        return;
      }

      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, name, brand, image_url")
        .in("id", ids);

      if (pErr) throw pErr;
      const byId = new Map((products ?? []).map((p) => [String(p.id), p]));
      const pa = byId.get(String(ids[0]));
      const pb = byId.get(String(ids[1]));
      if (!pa || !pb) {
        setError("Could not load products for this matchup.");
        setStatus("error");
        return;
      }

      setSeasonId(season.id);
      setMatchupIndex(today.matchupIndex);
      setProductA(pa);
      setProductB(pb);
      setLogRow(log);
      setStatus("ready");

      const { data: votesRows, error: vErr } = await supabase
        .from("votes")
        .select("product_id")
        .eq("season_id", season.id)
        .eq("matchup_index", today.matchupIndex);

      if (vErr) throw vErr;
      let a = 0;
      let b = 0;
      for (const row of votesRows ?? []) {
        const id = String(row.product_id);
        if (id === String(pa.id)) a += 1;
        else if (id === String(pb.id)) b += 1;
      }
      setCountA(a);
      setCountB(b);
    } catch (e) {
      setError(e?.message ?? "Could not load dashboard.");
      setStatus("error");
    }
  }, [user?.id, navigate]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    load();
  }, [authLoading, user, load, navigate]);

  useEffect(() => {
    if (status !== "ready" || !seasonId || matchupIndex == null) return undefined;
    loadVoteCounts();
    const id = setInterval(loadVoteCounts, 60_000);
    return () => clearInterval(id);
  }, [status, seasonId, matchupIndex, loadVoteCounts]);

  const total = countA + countB;
  const pctA = total > 0 ? Math.round((countA / total) * 100) : 50;
  const pctB = total > 0 ? 100 - pctA : 50;

  function pushToast(nextDecision, previousDecision) {
    if (nextDecision === "abstain") {
      setToast("The Smashalope is headed to the beach.");
      return;
    }
    const name = choiceLabel(nextDecision, productA, productB);
    if (!previousDecision) {
      setToast(`Locked in: ${name}`);
    } else {
      setToast(`Changed to: ${name}`);
    }
  }

  async function applyDecision(payload) {
    if (!logRow?.id || locked || saving) return;
    const cur = logRow.decision ?? null;
    if (
      (payload.decision === "product_a" && cur === "product_a") ||
      (payload.decision === "product_b" && cur === "product_b") ||
      (payload.decision === "chaos" && cur === "chaos") ||
      (payload.decision === "abstain" && cur === "abstain")
    ) {
      return;
    }
    const previousDecision = cur;
    setSaving(true);
    setError("");
    try {
      const nextTimes = (Number(logRow.times_changed) || 0) + 1;
      const { data, error: uErr } = await supabase
        .from("smashalope_log")
        .update({
          decision: payload.decision,
          decision_product_id: payload.decision_product_id ?? null,
          times_changed: nextTimes,
          final_lock_time: new Date().toISOString(),
        })
        .eq("id", logRow.id)
        .select()
        .single();

      if (uErr) throw uErr;
      setLogRow(data);
      pushToast(data.decision, previousDecision);
      await loadVoteCounts();
    } catch (e) {
      setError(e?.message ?? "Could not save decision.");
    } finally {
      setSaving(false);
    }
  }

  function decisionSummary() {
    const d = logRow?.decision;
    if (!d) return null;
    if (d === "product_a" && productA) return { label: productA.name, sub: "Your pick for the people" };
    if (d === "product_b" && productB) return { label: productB.name, sub: "Your pick for the people" };
    if (d === "chaos") {
      return { label: "Chaos", sub: CHAOS_HELP };
    }
    if (d === "abstain") {
      return { label: "The beach", sub: "The Smashalope went to the beach." };
    }
    return { label: String(d), sub: "" };
  }

  const summary = decisionSummary();

  if (authLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-stone-950 via-amber-950/30 to-stone-950">
        <p className="text-lg font-medium text-amber-200/80">Summoning the altar…</p>
      </div>
    );
  }

  if (status === "error" && !productA) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-b from-stone-950 to-stone-900 px-6">
        <p className="text-center text-red-300">{error || "Something went wrong."}</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-full border border-amber-600/50 px-6 py-2 text-amber-200 hover:bg-amber-950/50"
        >
          Back home
        </button>
      </div>
    );
  }

  const d = logRow?.decision;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-stone-950 via-amber-950/25 to-stone-950 text-amber-50">
      <header className="border-b border-amber-500/20 bg-black/30 px-4 py-5 backdrop-blur-sm sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400/90">Golden mantle</p>
          <h1 className="mt-2 bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl">
            You are today&apos;s Golden Smashalope
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-amber-100/85 sm:text-lg">
            You hold the power to change today&apos;s outcome. Pick the winner — or choose chaos. Whatever you decide
            at 8 PM is final.
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
        <div className="mb-2 flex justify-center">
          <Link
            to="/"
            className="text-sm font-medium text-amber-400/90 transition hover:text-amber-200 hover:underline"
          >
            ← Back to battle
          </Link>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-center text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-500/80">Today&apos;s matchup</p>
          <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-8">
            <p className="text-2xl font-black text-amber-100 sm:text-3xl">{productA?.name}</p>
            <span className="text-xl font-black text-amber-600/90">vs</span>
            <p className="text-2xl font-black text-amber-100 sm:text-3xl">{productB?.name}</p>
          </div>
        </section>

        <section className="mb-10">
          <p className="mb-2 text-center text-sm font-medium text-amber-200/70">Live vote pulse</p>
          <p className="mb-3 text-center text-lg font-bold text-amber-100">
            {productA?.name} {pctA}% — {pctB}% {productB?.name}
          </p>
          <div className="flex h-4 w-full overflow-hidden rounded-full border border-amber-500/30 bg-stone-900 shadow-inner shadow-black/40">
            <div
              className="h-full bg-gradient-to-b from-amber-400 to-amber-600 transition-[width] duration-500"
              style={{ width: `${pctA}%` }}
            />
            <div
              className="h-full bg-gradient-to-b from-violet-500 to-violet-700 transition-[width] duration-500"
              style={{ width: `${pctB}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-amber-200/50">Updates every 60 seconds</p>
        </section>

        {locked ? (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-950/40 px-6 py-8 text-center shadow-lg shadow-amber-900/20">
            <p className="text-xl font-bold text-amber-100">Your decision is locked. The call comes at 8 PM.</p>
            {!logRow?.decision && (
              <p className="mt-4 text-base text-amber-200/80">
                You didn&apos;t choose — the Smashalope went to the beach.
              </p>
            )}
            {summary && logRow?.decision && (
              <div className="mt-6 border-t border-amber-500/20 pt-6">
                <p className="text-sm font-semibold uppercase tracking-wide text-amber-400/90">What you locked in</p>
                <p className="mt-2 text-2xl font-black text-amber-50">{summary.label}</p>
                {summary.sub && <p className="mt-2 text-left text-sm leading-relaxed text-amber-200/75">{summary.sub}</p>}
              </div>
            )}
          </section>
        ) : (
          <>
            <p className="mb-4 text-center text-xs text-amber-200/55">Tap an option to select — you can change until 8 PM ET.</p>

            <section className="flex flex-col gap-3">
              {/* Product A */}
              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "product_a", decision_product_id: productAId })}
                className={`relative flex w-full items-start gap-3 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
                  d === "product_a"
                    ? "border-amber-300 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-stone-950 shadow-lg shadow-amber-500/35 ring-2 ring-amber-200/40"
                    : "border-amber-700/40 bg-stone-900/60 text-amber-100/65 hover:border-amber-600/55 hover:bg-stone-900/80"
                }`}
              >
                <span className="min-w-0 flex-1 text-xl font-black">{productA?.name}</span>
                {d === "product_a" && (
                  <span className="shrink-0 text-2xl leading-none text-stone-950 drop-shadow" aria-hidden>
                    ✓
                  </span>
                )}
              </button>

              {/* Product B */}
              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "product_b", decision_product_id: productBId })}
                className={`relative flex w-full items-start gap-3 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
                  d === "product_b"
                    ? "border-amber-300 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 text-stone-950 shadow-lg shadow-amber-500/35 ring-2 ring-amber-200/40"
                    : "border-amber-700/40 bg-stone-900/60 text-amber-100/65 hover:border-amber-600/55 hover:bg-stone-900/80"
                }`}
              >
                <span className="min-w-0 flex-1 text-xl font-black">{productB?.name}</span>
                {d === "product_b" && (
                  <span className="shrink-0 text-2xl leading-none text-stone-950 drop-shadow" aria-hidden>
                    ✓
                  </span>
                )}
              </button>

              {/* Chaos */}
              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "chaos", decision_product_id: null })}
                className={`relative flex w-full flex-col gap-1 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
                  d === "chaos"
                    ? "border-red-400 bg-gradient-to-br from-red-900 via-red-950 to-stone-950 text-red-50 shadow-lg shadow-red-900/50 ring-2 ring-red-400/30"
                    : "border-red-900/50 bg-red-950/30 text-red-200/75 hover:border-red-700/70 hover:bg-red-950/45"
                }`}
              >
                <div className="flex w-full items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="block text-lg font-black">Chaos</span>
                    <span className="mt-1 block text-xs font-normal leading-snug text-red-200/85">
                      {CHAOS_HELP}
                    </span>
                  </div>
                  {d === "chaos" && (
                    <span className="shrink-0 text-2xl leading-none text-red-100 drop-shadow" aria-hidden>
                      ✓
                    </span>
                  )}
                </div>
              </button>

              {/* Beach */}
              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "abstain", decision_product_id: null })}
                className={`relative flex w-full items-start gap-3 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200 ${
                  d === "abstain"
                    ? "border-amber-600/80 bg-gradient-to-br from-amber-800/90 via-yellow-900/80 to-stone-900 text-amber-50 shadow-lg shadow-amber-900/40 ring-2 ring-amber-500/35"
                    : "border-amber-800/35 bg-gradient-to-br from-stone-800/80 to-amber-950/40 text-amber-200/70 hover:border-amber-700/50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xl leading-none" aria-hidden>
                      🌴
                    </span>
                    <span className="text-lg font-black">Go to the beach</span>
                  </div>
                  <span className="mt-1 block text-xs font-normal text-amber-200/70">
                    Step away — no pick, no sway.
                  </span>
                </div>
                {d === "abstain" && (
                  <span className="shrink-0 text-2xl leading-none text-amber-100 drop-shadow" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            </section>

            {toast && (
              <p
                className="mt-6 text-center text-sm font-semibold text-amber-200 transition-opacity duration-300"
                role="status"
              >
                {toast}
              </p>
            )}
          </>
        )}

      </main>
    </div>
  );
}
