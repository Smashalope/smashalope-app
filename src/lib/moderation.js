/**
 * Lowercase entries; matching is case-insensitive.
 * Covers common profanity, hate slurs, and obvious variants (no leetspeak explosion).
 */
export const BANNED_USERNAMES = [
  "anal",
  "anus",
  "arse",
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "blowjob",
  "bollocks",
  "boner",
  "boob",
  "boobs",
  "bullshit",
  "buttplug",
  "clitoris",
  "cock",
  "cocksucker",
  "coon",
  "crap",
  "cum",
  "cunt",
  "dick",
  "dildo",
  "dyke",
  "fag",
  "faggot",
  "fuck",
  "fucker",
  "fucking",
  "goddamn",
  "handjob",
  "hitler",
  "hooker",
  "horny",
  "jerkoff",
  "jizz",
  "kike",
  "kys",
  "lesbo",
  "masturbate",
  "molest",
  "motherfucker",
  "nazi",
  "negro",
  "nigga",
  "nigger",
  "niglet",
  "nipple",
  "orgasm",
  "paedo",
  "pedo",
  "pedophile",
  "penis",
  "piss",
  "porn",
  "porno",
  "pussy",
  "queer",
  "rape",
  "rapist",
  "retard",
  "scrotum",
  "shit",
  "shithead",
  "slut",
  "spic",
  "spick",
  "suckmy",
  "testicle",
  "tits",
  "titties",
  "titty",
  "tranny",
  "twat",
  "vagina",
  "wank",
  "wetback",
  "whore",
  "wop",
];

/**
 * @param {string} username
 * @returns {true} if the username does not match or contain any banned term (case-insensitive)
 * @returns {false} if it is an exact match for a banned term or contains one as a substring
 */
export function isUsernameClean(username) {
  const normalized = (username ?? "").trim().toLowerCase();
  if (!normalized) return true;

  for (const banned of BANNED_USERNAMES) {
    const term = banned.trim().toLowerCase();
    if (!term) continue;
    if (normalized === term || normalized.includes(term)) {
      return false;
    }
  }

  return true;
}
