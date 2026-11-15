// Classifier boundary.  Routing policy consumes this small result shape and does
// not know whether the answer came from Claude Code or a future shadow provider.
// Keeping raw requests out of the result also makes it safe to retain route data.
import { criteriaText, TIERS } from './config.mjs'

// A bad/unavailable classifier must never block a turn. After repeated failures
// we pause attempts briefly rather than charging/adding latency on every turn.
export const FAILURES_TO_PAUSE = 3
export const PAUSE_MS = 60_000

export const classificationPrompt = ({ text, note = '' }) =>
  `${criteriaText()}${note ? `\n${note}` : ''}\n\n요청:\n${text}`

export const builtInResult = (label) => {
  if (!label || !TIERS.includes(label)) return null
  return { label, provider: 'builtin' }
}

export const classifierHealthy = (health, now = Date.now()) =>
  !(Number.isFinite(health?.pausedUntil) && health.pausedUntil > now)

export const classifierSucceeded = () => ({ failures: 0, pausedUntil: 0 })

export const classifierFailed = (health, now = Date.now()) => {
  const failures = Math.min((Number.isInteger(health?.failures) ? health.failures : 0) + 1, FAILURES_TO_PAUSE)
  return { failures, pausedUntil: failures >= FAILURES_TO_PAUSE ? now + PAUSE_MS : 0 }
}

// I. (HANDOFF.md section I) assist mode's fallback ambiguity signal when Jev gave no usable
// answer: a plain agree/disagree over whatever valid labels came back, no majority vote (a
// 2-vs-1 split and an all-different split are both "not unanimous" under this rule, so a
// majority count would answer the same question at a higher cost — see the design doc). A
// single vote (every retry failed, or `calls` was 2 and nothing else came back) is trivially
// unanimous: nothing to disagree with, so not ambiguous.
export const selfConsistencyAmbiguous = (votes) => !votes.every((v) => v === votes[0])
