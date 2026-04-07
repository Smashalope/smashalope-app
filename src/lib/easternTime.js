/** True when America/New_York wall time is 8:00 PM or later. */
export function isPast8PMEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return hour >= 20;
}

/** True when Eastern time is 6:00 AM or later (lazy seed window). */
export function isAfter6AMEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return hour >= 6;
}
