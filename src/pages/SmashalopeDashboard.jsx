import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchActiveSeason, getProductIdsFromMatchup, getTodayMatchup } from "../lib/bracket.js";
import { useAuth } from "../context/AuthContext.jsx";
import { supabase } from "../lib/supabase.js";

// TODO(revert before launch): Restore the 8 PM ET decision lock.
// 1) import { isPast8PMEastern } from "../lib/easternTime.js";  // or isPast11PMEastern for a later QA cutoff
// 2) Re-add useNowTick (30s) so `now` updates and the UI crosses into locked at 8 PM without refresh.
// 3) Replace the line below with: const locked = isPast8PMEastern(now);
const locked = false;

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

  const productAId = productA?.id;
  const productBId = productB?.id;

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

  const leadingProduct = useMemo(() => {
    if (countA > countB) return productA;
    if (countB > countA) return productB;
    return null;
  }, [countA, countB, productA, productB]);

  async function applyDecision(payload) {
    if (!logRow?.id || locked || saving) return;
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
      const target = leadingProduct
        ? `Upset ${leadingProduct.name}`
        : "Break the deadlock";
      return { label: "Chaos", sub: target };
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

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-stone-950 via-amber-950/25 to-stone-950 text-amber-50">
      <header className="border-b border-amber-500/20 bg-black/30 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400/90">Golden mantle</p>
          <h1 className="mt-2 bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl">
            You are today&apos;s Golden Smashalope
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6">
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-center text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-10 text-center">
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
                {summary.sub && <p className="mt-1 text-sm text-amber-200/75">{summary.sub}</p>}
              </div>
            )}
          </section>
        ) : (
          <>
            {summary && (
              <div className="mb-6 rounded-2xl border border-amber-400/25 bg-amber-950/50 px-5 py-4 text-center">
                <p className="text-sm text-amber-200/90">
                  <span className="font-semibold text-amber-100">Current choice:</span> {summary.label}
                </p>
                {summary.sub && <p className="mt-1 text-xs text-amber-200/60">{summary.sub}</p>}
                <p className="mt-3 text-xs text-amber-300/80">Change your mind? Pick another option below — you can switch until 8 PM ET.</p>
              </div>
            )}

            <section className="flex flex-col gap-4">
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  applyDecision({ decision: "product_a", decision_product_id: productAId })
                }
                className={`rounded-2xl border-4 px-6 py-5 text-left text-xl font-black transition ${
                  logRow?.decision === "product_a"
                    ? "border-amber-300 bg-gradient-to-r from-amber-500 to-orange-500 text-stone-950 shadow-lg shadow-amber-500/30"
                    : "border-amber-600/50 bg-gradient-to-r from-amber-600/90 to-orange-600/90 text-stone-950 hover:from-amber-500 hover:to-orange-500"
                }`}
              >
                {productA?.name}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  applyDecision({ decision: "product_b", decision_product_id: productBId })
                }
                className={`rounded-2xl border-4 px-6 py-5 text-left text-xl font-black transition ${
                  logRow?.decision === "product_b"
                    ? "border-amber-300 bg-gradient-to-r from-amber-500 to-orange-500 text-stone-950 shadow-lg shadow-amber-500/30"
                    : "border-amber-600/50 bg-gradient-to-r from-amber-600/90 to-orange-600/90 text-stone-950 hover:from-amber-500 hover:to-orange-500"
                }`}
              >
                {productB?.name}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "chaos", decision_product_id: null })}
                className={`relative rounded-xl border-2 px-5 py-3 text-left text-base font-bold transition ${
                  logRow?.decision === "chaos"
                    ? "border-red-400 bg-red-950/80 text-red-100 shadow-md shadow-red-900/40"
                    : "border-red-900/80 bg-gradient-to-br from-red-950 to-stone-950 text-red-200/95 hover:border-red-600 hover:bg-red-950/90"
                } `}
              >
                <span className="block text-lg">Choose chaos</span>
                <span className="mt-1 block text-xs font-normal text-red-300/80">
                  {leadingProduct
                    ? `Strike against ${leadingProduct.name} — tip the scales the other way.`
                    : "The vote is tied — break the deadlock."}
                </span>
              </button>
            </section>

            <div className="mt-auto flex flex-col items-center pt-12 pb-8">
              <button
                type="button"
                disabled={saving}
                onClick={() => applyDecision({ decision: "abstain", decision_product_id: null })}
                className={`text-sm underline decoration-amber-600/50 underline-offset-4 transition hover:text-amber-200 ${
                  logRow?.decision === "abstain" ? "font-semibold text-amber-200" : "text-amber-400/70"
                }`}
              >
                Go to the beach
              </button>
              <p className="mt-3 max-w-sm text-center text-xs text-amber-200/45">
                The Smashalope went to the beach.
              </p>
            </div>
          </>
        )}

        <div className="mt-8 flex justify-center pb-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-sm font-medium text-amber-500/80 hover:text-amber-300 hover:underline"
          >
            ← Back to today&apos;s battle
          </button>
        </div>
      </main>
    </div>
  );
}
