// Pure: M. (HANDOFF.md section M) — shaping the `session.measure` signal for storage.
//
// This exists because the original M design assumed no Mod API could read a subscription
// seat's rate-limit usage, which turned out to be wrong: `.claude-plugin/types/claude-code/
// index.d.ts`'s `$.session.usage()` / the `session.measure` hook answer `rateLimits`
// (SessionRateLimit[]: `kind` 'five_hour'/'seven_day'/a gateway's 'spend_limit', `percentUsed`
// 0-100, `resetsAt`) — empty off a subscription, which is itself useful information (an API-key
// account never sees these, so their absence is the signal that this question doesn't apply).
// `cost.usd` is a second, independent find: the host's own real-time cost ledger for *this*
// session, a ground truth lib/prices.mjs's token-price estimate can be checked against without
// needing account-invoice access (the other still-open item in "검증 상태").
export const USAGE_CAP = 500

// `e` is the session.measure hook's input (SessionMeasureInput) — only the numbers are kept,
// nothing from session content (there is none to keep: this signal carries none).
export const usageSnapshot = ({ at, rateLimits, cost }) => ({
  at,
  rateLimits: (rateLimits ?? []).map((r) => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  costUsd: typeof cost?.usd === 'number' ? cost.usd : null,
})

export const appendUsage = (rows, snapshot) => [...rows, snapshot].slice(-USAGE_CAP)

// The most recent snapshot, or null — what `/tsr-router status` shows. Not an average or a
// delta: HANDOFF.md's M still leaves "how much did the window move over a comparison period"
// to a later analysis step, once real snapshots have accumulated to analyze.
export const latestUsage = (rows) => (rows.length ? rows.at(-1) : null)
