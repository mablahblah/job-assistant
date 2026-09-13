export interface DeadEndResult {
  isDeadEnd: boolean;
  reason?: "login_wall" | "paywall" | "signup_wall";
}

// Scans page HTML for signals that the posting is gated behind a login,
// signup, or paywall. Only flags strong signals to avoid false positives —
// a page wrongly called a dead end throws away a real job posting.
export function detectDeadEndSignals(html: string): DeadEndResult {
  // A password input definitively signals a login wall.
  if (/<input[^>]*type\s*=\s*["']password["']/i.test(html)) {
    return { isDeadEnd: true, reason: "login_wall" };
  }

  // Text explicitly requiring an account to view or access the job posting
  // signals a signup wall. The required verbs (view, apply, access) prevent
  // false positives from generic signup prompts like newsletter signups.
  if (/create\s+(an?\s+)?account\s+to\s+(view|apply|continue|access|see)/i.test(html)) {
    return { isDeadEnd: true, reason: "signup_wall" };
  }
  if (/sign\s+up\s+to\s+(view|apply|continue|access|see)/i.test(html)) {
    return { isDeadEnd: true, reason: "signup_wall" };
  }

  // Text requiring subscription, free trials, or upgrades to access the
  // posting signals a paywall.
  if (/subscribe\s+to\s+(view|access|see|unlock)/i.test(html)) {
    return { isDeadEnd: true, reason: "paywall" };
  }
  if (/start\s+your\s+free\s+trial/i.test(html)) {
    return { isDeadEnd: true, reason: "paywall" };
  }
  if (/upgrade\s+(to\s+)?(view|access|see|unlock)/i.test(html)) {
    return { isDeadEnd: true, reason: "paywall" };
  }

  return { isDeadEnd: false };
}
