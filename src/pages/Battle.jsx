import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SmashScreen from "../components/SmashScreen.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  fetchActiveSeason,
  getProductIdsFromMatchup,
  getTodayMatchup,
} from "../lib/bracket.js";
import { getSessionId } from "../lib/session.js";
import { supabase } from "../lib/supabase.js";
import { isAfter6AMEastern, isPast8PMEastern } from "../lib/easternTime.js";

function matchupHasNoWinner(matchup) {
  if (!matchup) return true;
  const w = matchup.winner;
  return w == null || String(w).trim() === "";
}

export default function Battle() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [loadState, setLoadState] = useState({
    status: "loading",
    error: "",
    season: null,
    matchupIndex: null,
    matchup: null,
    products: [],
    existingVote: null,
    smashalopeLog: null,
  });

  const [selectedId, setSelectedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  /** After inserting a vote, power-up UI before showing the confirmation banner */
  const [smashSession, setSmashSession] = useState(null);
  /** Set at vote time if this user won the Golden Smashalope claim (reveal runs after SmashScreen). */
  const wonGoldenSmashalopeRef = useRef(false);
  /** Full-screen golden moment after power-ups complete */
  const [postSmashGoldenOverlay, setPostSmashGoldenOverlay] = useState(false);
  /** Re-render periodically so the Golden Smashalope pill hides after 8 PM ET without navigation. */
  const [goldenPillTick, setGoldenPillTick] = useState(0);

  const completeSmash = useCallback(() => {
    const pendingGolden = wonGoldenSmashalopeRef.current;
    setSmashSession(null);
    if (pendingGolden) {
      setPostSmashGoldenOverlay(true);
    }
  }, []);

  useEffect(() => {
    if (!postSmashGoldenOverlay) return undefined;
    const t = setTimeout(() => {
      wonGoldenSmashalopeRef.current = false;
      setPostSmashGoldenOverlay(false);
      navigate("/smashalope");
    }, 3000);
    return () => clearTimeout(t);
  }, [postSmashGoldenOverlay, navigate]);

  useEffect(() => {
    if (!user?.id || !loadState.smashalopeLog?.user_id) return undefined;
    if (String(loadState.smashalopeLog.user_id) !== String(user.id)) return undefined;
    const id = setInterval(() => setGoldenPillTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [user?.id, loadState.smashalopeLog?.user_id]);

  const loadBattle = useCallback(async (fromResolveChain = false, fromSeedFallback = false) => {
    setLoadState((s) => ({ ...s, status: "loading", error: "" }));

    try {
      const sessionId = getSessionId();
      const season = await fetchActiveSeason();
      if (!season) {
        setLoadState({
          status: "empty",
          error: "",
          season: null,
          matchupIndex: null,
          matchup: null,
          products: [],
          existingVote: null,
          smashalopeLog: null,
        });
        return;
      }

      const today = getTodayMatchup(season.bracket_structure, season.start_date);
      if (!today) {
        setLoadState({
          status: "no_matchup",
          error: "",
          season,
          matchupIndex: null,
          matchup: null,
          products: [],
          existingVote: null,
          smashalopeLog: null,
        });
        return;
      }

      if (
        matchupHasNoWinner(today.matchup) &&
        !fromResolveChain &&
        isPast8PMEastern()
      ) {
        try {
          const origin =
            typeof import.meta.env.VITE_API_ORIGIN === "string" && import.meta.env.VITE_API_ORIGIN
              ? import.meta.env.VITE_API_ORIGIN.replace(/\/$/, "")
              : "";
          const url = origin ? `${origin}/api/resolve-daily` : "/api/resolve-daily";
          const res = await fetch(url, { method: "GET" });
          if (res.ok) {
            await loadBattle(true);
            return;
          }
        } catch {
          /* continue with current bracket */
        }
      }

      const ids = getProductIdsFromMatchup(today.matchup);
      if (ids.length < 2) {
        setLoadState({
          status: "error",
          error: "This matchup is missing product data.",
          season,
          matchupIndex: today.matchupIndex,
          matchup: today.matchup,
          products: [],
          existingVote: null,
          smashalopeLog: null,
        });
        return;
      }

      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, brand, image_url, power_up_labels")
        .in("id", ids);

      if (productsError) throw productsError;

      const byId = new Map((products ?? []).map((p) => [p.id, p]));
      const ordered = [byId.get(ids[0]), byId.get(ids[1])].filter(Boolean);

      if (ordered.length < 2) {
        setLoadState({
          status: "error",
          error: "Could not load both products for this matchup.",
          season,
          matchupIndex: today.matchupIndex,
          matchup: today.matchup,
          products: [],
          existingVote: null,
          smashalopeLog: null,
        });
        return;
      }

      let voteQuery = supabase
        .from("votes")
        .select("id, product_id")
        .eq("season_id", season.id)
        .eq("matchup_index", today.matchupIndex);

      if (user?.id) {
        voteQuery = voteQuery.eq("user_id", user.id);
      } else {
        voteQuery = voteQuery.eq("session_id", sessionId).is("user_id", null);
      }

      const { data: voteRow, error: voteError } = await voteQuery.maybeSingle();

      if (voteError) throw voteError;

      const { data: smashLog, error: smashError } = await supabase
        .from("smashalope_log")
        .select("id, user_id, decision, target_time")
        .eq("season_id", season.id)
        .eq("matchup_index", today.matchupIndex)
        .maybeSingle();

      if (smashError) throw smashError;

      if (
        !smashLog &&
        !fromSeedFallback &&
        matchupHasNoWinner(today.matchup) &&
        isAfter6AMEastern()
      ) {
        try {
          const origin =
            typeof import.meta.env.VITE_API_ORIGIN === "string" && import.meta.env.VITE_API_ORIGIN
              ? import.meta.env.VITE_API_ORIGIN.replace(/\/$/, "")
              : "";
          const url = origin ? `${origin}/api/seed-smashalope` : "/api/seed-smashalope";
          const res = await fetch(url, { method: "GET" });
          if (res.ok) {
            await loadBattle(fromResolveChain, true);
            return;
          }
        } catch {
          /* continue without log row */
        }
      }

      setLoadState({
        status: "ready",
        error: "",
        season,
        matchupIndex: today.matchupIndex,
        matchup: today.matchup,
        products: ordered,
        existingVote: voteRow ?? null,
        smashalopeLog: smashLog ?? null,
      });
      setSelectedId(null);
    } catch (e) {
      setLoadState({
        status: "error",
        error: e?.message ?? "Something went wrong.",
        season: null,
        matchupIndex: null,
        matchup: null,
        products: [],
        existingVote: null,
        smashalopeLog: null,
      });
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    loadBattle();
  }, [authLoading, user?.id, loadBattle]);

  async function handleConfirm() {
    if (!selectedId || !loadState.season || loadState.matchupIndex == null) return;

    setSubmitting(true);
    try {
      const row = {
        season_id: loadState.season.id,
        matchup_index: loadState.matchupIndex,
        product_id: selectedId,
        session_id: getSessionId(),
        user_id: user?.id ?? null,
      };

      const { data: inserted, error } = await supabase.from("votes").insert(row).select("id").single();

      if (error) throw error;

      const product = loadState.products.find((p) => p.id === selectedId);
      const sessionPayload = {
        voteId: inserted.id,
        product: product ?? { id: selectedId, power_up_labels: null },
      };

      setLoadState((s) => ({
        ...s,
        error: "",
        existingVote: { id: inserted.id, product_id: selectedId },
      }));
      setSelectedId(null);

      wonGoldenSmashalopeRef.current = false;
      if (user?.id) {
        const { data: log } = await supabase
          .from("smashalope_log")
          .select("id, user_id, target_time")
          .eq("season_id", loadState.season.id)
          .eq("matchup_index", loadState.matchupIndex)
          .maybeSingle();

        const pastTarget =
          log?.target_time &&
          log.user_id == null &&
          Date.now() > new Date(log.target_time).getTime();

        if (pastTarget) {
          const { data: claimed } = await supabase
            .from("smashalope_log")
            .update({ user_id: user.id })
            .eq("season_id", loadState.season.id)
            .eq("matchup_index", loadState.matchupIndex)
            .is("user_id", null)
            .select("id");

          if (claimed?.length) {
            wonGoldenSmashalopeRef.current = true;
            setLoadState((s) => ({
              ...s,
              smashalopeLog: s.smashalopeLog
                ? { ...s.smashalopeLog, user_id: user.id }
                : { id: log.id, user_id: user.id, decision: null, target_time: log.target_time },
            }));
          }
        }
      }

      setSmashSession(sessionPayload);
    } catch (e) {
      setLoadState((s) => ({
        ...s,
        error: e?.message ?? "Could not save your vote.",
      }));
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-violet-100 to-fuchsia-50">
        <p className="text-base font-medium text-violet-900/70">Loading…</p>
      </div>
    );
  }

  const displayName = profile?.username ?? user?.email?.split("@")[0] ?? "there";

  const votedProduct =
    loadState.existingVote &&
    loadState.products.find((p) => p.id === loadState.existingVote.product_id);

  const showVotedBanner = Boolean(
    loadState.existingVote && votedProduct && !smashSession && !postSmashGoldenOverlay
  );

  /** Today's Golden Smashalope (before 8 PM): show in header and again under "You voted…" so it stays visible after voting. */
  const showGoldenDecisionPill =
    Boolean(user) &&
    loadState.status === "ready" &&
    loadState.smashalopeLog &&
    String(loadState.smashalopeLog.user_id) === String(user.id) &&
    goldenPillTick >= 0 &&
    !isPast8PMEastern() &&
    !smashSession &&
    !postSmashGoldenOverlay;

  const goldenDecisionPillClassName =
    "inline-flex items-center gap-1.5 rounded-full border-2 border-amber-400/90 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 px-4 py-2 text-sm font-extrabold tracking-tight text-amber-950 shadow-md shadow-amber-300/40 ring-1 ring-amber-400/50 transition hover:from-amber-50 hover:to-yellow-100 hover:shadow-amber-400/50";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-violet-100 via-fuchsia-50 to-orange-50">
      {postSmashGoldenOverlay && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-amber-400 via-yellow-300 to-amber-500 px-6 text-center shadow-[inset_0_0_120px_rgba(251,191,36,0.6)]"
          role="alert"
          aria-live="assertive"
        >
          <p className="max-w-lg text-3xl font-black uppercase tracking-tight text-amber-950 drop-shadow-sm sm:text-4xl">
            The Golden Smashalope has chosen you!
          </p>
          <p className="text-sm font-semibold text-amber-950/80">Hold tight…</p>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-violet-200/80 bg-white/85 px-4 py-3 shadow-sm backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
          {user ? (
            <>
              <h1 className="truncate text-lg font-bold text-violet-950 sm:text-xl">
                Welcome, {displayName}
              </h1>
              <button
                type="button"
                onClick={() => signOut()}
                className="shrink-0 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-violet-700 active:scale-[0.98]"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-violet-950 sm:text-xl">Smashalope</h1>
              <Link
                to="/login"
                className="shrink-0 text-xs font-medium text-violet-600/80 transition hover:text-violet-800 hover:underline sm:text-sm"
              >
                Log in
              </Link>
            </>
          )}
          </div>
          {showGoldenDecisionPill && (
            <div className="flex justify-center sm:justify-end">
              <Link to="/smashalope" className={goldenDecisionPillClassName}>
                Change your Smashalope decision <span aria-hidden>→</span>
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        {loadState.status === "loading" && (
          <div className="flex flex-1 items-center justify-center py-20">
            <p className="text-lg font-medium text-violet-900/70">Loading today&apos;s battle…</p>
          </div>
        )}

        {loadState.error &&
          loadState.status !== "loading" &&
          !smashSession &&
          !postSmashGoldenOverlay && (
          <div
            className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-red-800"
            role="alert"
          >
            {loadState.error}
          </div>
        )}

        {loadState.status === "empty" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-2xl font-bold text-violet-950">No active season</p>
            <p className="max-w-md text-violet-800/80">Check back when a new season starts.</p>
          </div>
        )}

        {loadState.status === "no_matchup" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-2xl font-bold text-violet-950">No battle today</p>
            <p className="max-w-md text-violet-800/80">
              There isn&apos;t a matchup scheduled for this calendar day.
            </p>
          </div>
        )}

        {loadState.status === "ready" && loadState.products.length >= 2 && (
          <>
            {loadState.matchupIndex != null &&
              !smashSession &&
              !postSmashGoldenOverlay && (
              <div className="mb-6 w-full space-y-3">
                <p className="text-center text-sm font-medium text-violet-800/90 sm:text-base">
                  {loadState.smashalopeLog?.user_id
                    ? "The Smashalope has descended."
                    : "The antlers await on the altar."}
                </p>
              </div>
            )}

            {smashSession && loadState.season && loadState.matchupIndex != null ? (
              <div className="flex min-h-[calc(100dvh-9rem)] w-full flex-1 flex-col items-center justify-center">
                <SmashScreen
                  product={smashSession.product}
                  seasonId={loadState.season.id}
                  matchupIndex={loadState.matchupIndex}
                  voteId={smashSession.voteId}
                  onComplete={completeSmash}
                />
              </div>
            ) : (
              <>
            <div className="mb-6 text-center">
              <h2 className="text-2xl font-extrabold tracking-tight text-violet-950 sm:text-3xl">
                Today&apos;s battle
              </h2>
              {!loadState.existingVote && !smashSession && (
                <p className="mt-1 text-sm text-violet-800/80">
                  Tap your favorite — big targets, no wrong answers.
                </p>
              )}
            </div>

            {showVotedBanner && (
              <div className="mb-8 space-y-4">
                <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/90 px-5 py-6 text-center shadow-lg shadow-emerald-200/50">
                  <p className="text-lg font-bold text-emerald-900 sm:text-xl">
                    You voted for {votedProduct.name}!
                  </p>
                  {votedProduct?.brand && (
                    <p className="mt-1 text-sm font-medium text-emerald-800/90">{votedProduct.brand}</p>
                  )}
                </div>

                {showGoldenDecisionPill && (
                  <div className="flex justify-center">
                    <Link to="/smashalope" className={goldenDecisionPillClassName}>
                      Change your Smashalope decision <span aria-hidden>→</span>
                    </Link>
                  </div>
                )}

                {!user && (
                  <p className="text-center text-base font-medium text-violet-900">
                    Grab a username for a shot at the Golden Smashalope{" "}
                    <Link
                      to="/signup"
                      className="font-bold text-indigo-600 underline decoration-2 underline-offset-2 hover:text-indigo-800"
                    >
                      Sign up
                    </Link>
                  </p>
                )}
              </div>
            )}

            {!loadState.existingVote && !smashSession && (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
                  {loadState.products.map((p) => {
                    const isSelected = selectedId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`group relative flex min-h-[200px] flex-col overflow-hidden rounded-3xl border-4 bg-white p-5 text-left shadow-xl transition-all duration-200 active:scale-[0.98] sm:min-h-[260px] ${
                          isSelected
                            ? "scale-[1.02] border-amber-400 shadow-amber-200/60 ring-4 ring-amber-300/80 ring-offset-2 ring-offset-fuchsia-50"
                            : "border-violet-200/80 hover:border-violet-400 hover:shadow-2xl"
                        } `}
                      >
                        {p.image_url ? (
                          <div className="mb-4 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-violet-100">
                            <img
                              src={p.image_url}
                              alt=""
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            />
                          </div>
                        ) : (
                          <div className="mb-4 flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-violet-200 to-fuchsia-200 text-4xl">
                            🥊
                          </div>
                        )}
                        <span className="text-xs font-bold uppercase tracking-wider text-violet-600">
                          {p.brand}
                        </span>
                        <span className="mt-1 text-xl font-extrabold leading-tight text-violet-950 sm:text-2xl">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedId && (
                  <div className="mt-8 flex justify-center">
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={submitting}
                      className="min-h-14 min-w-[200px] rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-10 text-lg font-extrabold text-white shadow-lg shadow-orange-300/50 transition hover:from-amber-500 hover:to-orange-600 disabled:opacity-60"
                    >
                      {submitting ? "Submitting…" : "Confirm vote"}
                    </button>
                  </div>
                )}
              </>
            )}

            {loadState.season && !smashSession && (
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/bracket"
                  className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-violet-400 bg-white px-6 py-2.5 text-sm font-bold text-violet-800 shadow-sm transition hover:bg-violet-50"
                >
                  View Bracket
                </Link>
                <Link
                  to="/shrine"
                  className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-amber-500/80 bg-gradient-to-r from-amber-50 to-yellow-50 px-6 py-2.5 text-sm font-bold text-amber-950 shadow-sm ring-1 ring-amber-400/40 transition hover:from-amber-100 hover:to-amber-50"
                >
                  View Shrine
                </Link>
              </div>
            )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
