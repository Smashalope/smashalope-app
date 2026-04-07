import { createClient } from "@supabase/supabase-js";
import { toDate } from "date-fns-tz";

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

function civilDiffDays(a, b) {
  const t0 = Date.UTC(a.y, a.mo - 1, a.d);
  const t1 = Date.UTC(b.y, b.mo - 1, b.d);
  return Math.round((t1 - t0) / 86400000);
}

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Random instant between 6:00 and 18:00 Eastern on the given civil calendar day. */
function randomTargetTimeEasternToday(y, mo, d) {
  const ymd = `${y}-${pad2(mo)}-${pad2(d)}`;
  const start = toDate(`${ymd} 06:00:00`, { timeZone: TZ });
  const end = toDate(`${ymd} 18:00:00`, { timeZone: TZ });
  const t0 = start.getTime();
  const t1 = end.getTime();
  return new Date(t0 + Math.random() * (t1 - t0));
}

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
        ok: true,
        seeded: false,
        reason: "no_matchup_today",
        season_day: dayNum,
      });
    }

    const matchupIndex = Number(matchup.index);
    if (!Number.isFinite(matchupIndex)) {
      return res.status(400).json({ error: "Matchup missing index" });
    }

    const { data: existing, error: exErr } = await supabase
      .from("smashalope_log")
      .select("id")
      .eq("season_id", season.id)
      .eq("matchup_index", matchupIndex)
      .maybeSingle();

    if (exErr) throw exErr;
    if (existing) {
      return res.status(200).json({
        ok: true,
        seeded: false,
        idempotent: true,
        message: "row_already_exists",
      });
    }

    const eastern = getEasternYmd(new Date());
    const targetTime = randomTargetTimeEasternToday(eastern.y, eastern.mo, eastern.d);

    const { error: insErr } = await supabase.from("smashalope_log").insert({
      season_id: season.id,
      matchup_index: matchupIndex,
      user_id: null,
      target_time: targetTime.toISOString(),
      decision: null,
    });

    if (insErr) {
      if (insErr.code === "23505") {
        return res.status(200).json({
          ok: true,
          seeded: false,
          idempotent: true,
          message: "insert_race",
        });
      }
      throw insErr;
    }

    console.log(
      JSON.stringify({
        event: "seed_smashalope",
        target_time: targetTime.toISOString(),
        season_id: season.id,
        matchup_index: matchupIndex,
      })
    );

    return res.status(200).json({ ok: true, seeded: true });
  } catch (e) {
    console.error("seed-smashalope:", e);
    return res.status(500).json({
      error: e?.message ?? "Internal server error",
    });
  }
}
