// Pure: turn a ledger of REAL external check results into an escalation signal.
//
// Why this exists. The in-turn fail streak (observed.mjs) only ever sees checks the AGENT
// itself ran as a Bash tool call. A real project also has checks that run OUTSIDE the agent's
// tool calls — a CI job, a pre-commit hook, an acceptance/test runner a human or a harness
// drives between turns. When those keep failing, that is the same real-world signal the router
// should act on ("the tests still fail → try a stronger model"), but the mod never observed it
// as a tool call, so it could never learn from it.
//
// This module reads an append-only ledger (one JSON object per line) of those external results
// and reports how many consecutive real failures end it. That count is fed into escalationFor
// as additional fail-streak — it NEVER sets a tier directly, and escalationFor still requires
// `failsInRow` real failures before moving up a single tier. A record only counts as a failure
// when it carries `passed: false` (a genuine red result); anything else is ignored, and a single
// pass anywhere resets the run. So the signal is true-by-construction: it can only reflect checks
// that actually, repeatedly failed. Off unless `observedChecks.enabled` (config.mjs) opts in, so
// today's interactive/single-shot routing is byte-for-byte unchanged.

export const observedChecksPath = (root) => `${root}/.claude/tsr-observed-checks.jsonl`

// Parse the ledger text into records. Tolerant: skips blank and unparseable lines, and keeps only
// records that state a boolean `passed`, so a malformed or partial write can never fabricate a
// failure. Order is preserved (the file is append-only, oldest first).
export const parseChecks = (text) => {
  if (typeof text !== 'string') return []
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const r = JSON.parse(t)
      if (r && typeof r === 'object' && typeof r.passed === 'boolean') out.push(r)
    } catch {
      // a half-written or non-JSON line is not evidence about the code — ignore it
    }
  }
  return out
}

// Count the trailing run of consecutive real failures (`passed === false`). A pass — or any
// record missing `passed` that parseChecks already dropped — ends the run. This is the number of
// consecutive failed external attempts, which maps one-to-one onto "N failed checks in a row".
export const trailingFailStreak = (records) => {
  let n = 0
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.passed === false) n += 1
    else break
  }
  return n
}
