function easternHour12hFalse(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/** True when America/New_York wall time is 8:00 PM or later. */
export function isPast8PMEastern(now = new Date()) {
  return easternHour12hFalse(now) >= 20;
}

/** True when America/New_York wall time is 11:00 PM or later (QA / dev lock window). */
export function isPast11PMEastern(now = new Date()) {
  return easternHour12hFalse(now) >= 23;
}

/** True when Eastern time is 6:00 AM or later (lazy seed window). */
export function isAfter6AMEastern(now = new Date()) {
  return easternHour12hFalse(now) >= 6;
}
