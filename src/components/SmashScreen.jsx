import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";

const IDLE_MS = 8000;
const PULSE_MS = 150;

const FALLBACK_LABELS = ["Pow!", "Bam!", "Wham!", "Smash!"];

const BUTTON_PALETTE = [
  "bg-rose-500 hover:bg-rose-400 border-rose-700",
  "bg-amber-400 hover:bg-amber-300 border-amber-700",
  "bg-cyan-500 hover:bg-cyan-400 border-cyan-800",
  "bg-violet-500 hover:bg-violet-400 border-violet-800",
];

const BUTTON_SMASHED = [
  "bg-rose-800 border-rose-950 ring-2 ring-rose-300",
  "bg-amber-700 border-amber-900 ring-2 ring-amber-200",
  "bg-cyan-800 border-cyan-950 ring-2 ring-cyan-200",
  "bg-violet-800 border-violet-950 ring-2 ring-violet-200",
];

function normalizeLabels(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [...FALLBACK_LABELS];
  const out = raw.map((s) => (typeof s === "string" ? s : String(s)));
  while (out.length < 4) out.push(FALLBACK_LABELS[out.length % 4]);
  return out.slice(0, 4);
}

/**
 * @param {object} props
 * @param {object} props.product — voted product (includes power_up_labels JSONB)
 * @param {string} props.seasonId
 * @param {number} props.matchupIndex
 * @param {string} props.voteId — votes.id for the PATCH
 * @param {() => void} props.onComplete — after vote row updated
 */
export default function SmashScreen({ product, seasonId: _seasonId, matchupIndex: _matchupIndex, voteId, onComplete }) {
  const labels = normalizeLabels(product?.power_up_labels);

  const [taps, setTaps] = useState([]);
  const [shakeKey, setShakeKey] = useState(0);
  const [pulseIndex, setPulseIndex] = useState(null);
  const [hitIndices, setHitIndices] = useState(() => new Set());
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  const tapsRef = useRef(taps);
  tapsRef.current = taps;
  const doneRef = useRef(false);

  const finish = useCallback(
    async (powerUps) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setFinishing(true);
      setError("");
      try {
        const { error: upErr } = await supabase.from("votes").update({ power_ups: powerUps }).eq("id", voteId);
        if (upErr) throw upErr;
        onComplete();
      } catch (e) {
        doneRef.current = false;
        setError(e?.message ?? "Could not save power-ups.");
      } finally {
        setFinishing(false);
      }
    },
    [voteId, onComplete]
  );

  useEffect(() => {
    if (finishing || doneRef.current) return;

    const id = setTimeout(() => {
      finish(tapsRef.current);
    }, IDLE_MS);

    return () => clearTimeout(id);
  }, [taps, finish, finishing]);

  function handleLabelTap(index) {
    if (finishing || doneRef.current) return;
    const label = labels[index];
    setTaps((prev) => [...prev, label]);
    setHitIndices((prev) => new Set(prev).add(index));
    setShakeKey((k) => k + 1);
    setPulseIndex(index);
    window.setTimeout(() => setPulseIndex(null), PULSE_MS);
  }

  function handleDone() {
    finish(taps);
  }

  return (
    <div key={shakeKey} className="relative mx-auto w-full max-w-lg animate-smash-shake px-1">
      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-center text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-3xl border-2 border-dashed border-violet-400/60 bg-gradient-to-b from-fuchsia-100/90 to-orange-100/80 p-4 shadow-inner sm:p-6">
        <h2 className="mb-6 text-center text-2xl font-black uppercase tracking-tight text-violet-950 drop-shadow-sm sm:text-3xl">
          Power up your vote!
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {labels.map((label, index) => {
            const smashed = hitIndices.has(index);
            const pulsing = pulseIndex === index;
            return (
              <button
                key={index}
                type="button"
                disabled={finishing}
                onClick={() => handleLabelTap(index)}
                className={[
                  "flex min-h-[80px] items-center justify-center rounded-2xl border-b-4 px-2 py-3 text-center text-sm font-extrabold leading-tight text-white shadow-lg transition-[transform,background-color,border-color] duration-150 ease-out sm:min-h-[96px] sm:px-3 sm:text-base",
                  smashed ? BUTTON_SMASHED[index % 4] : BUTTON_PALETTE[index % 4],
                  pulsing ? "scale-[1.15] z-10" : "scale-100",
                  finishing ? "opacity-60" : "active:scale-95",
                ].join(" ")}
              >
                <span className="line-clamp-3">{label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={finishing}
          onClick={handleDone}
          className="mt-8 w-full rounded-full border-4 border-violet-800 bg-violet-600 py-4 text-lg font-black uppercase tracking-wide text-white shadow-xl transition hover:bg-violet-700 active:scale-[0.98] disabled:opacity-50"
        >
          {finishing ? "Saving…" : "Done smashing"}
        </button>
      </div>
    </div>
  );
}

