// Pure: whether a running turn should move up a tier, and why.
// Two independent sources, the stronger one wins:
//  - checks failing in a row with a fix attempt between them (see addToolCall) — one tier at a
//    time, since this is a soft "it seems stuck" signal.
//  - a file the turn actually touched matches a configured risk area (see config.mjs) — jumps
//    straight to that area's minTier, since this is a hard "we know this is risky" fact, not a
//    guess. This is what makes the escalation safe even when the first classify missed it.
// File count and changed lines alone are not signals: they fire after the editing is done, when
// the remaining steps are cheap. Upward only.
import { matchRiskAreas, riskFloorTier } from './policy.mjs'
import { RANK, TIERS } from './config.mjs'

// `usedStreak` is the fail streak the turn already escalated on, so the same streak never moves it twice.
export const escalationFor = (tally, current, usedStreak = 0, failsInRow = 2, riskAreas = []) => {
  const rank = RANK[current]
  if (rank === undefined || rank >= RANK['최상']) return null

  let best = null // { tier, reason }
  if (tally.failStreak >= usedStreak + failsInRow) {
    best = { tier: TIERS[rank + 1], reason: `${tally.failStreak} failed checks in a row` }
  }
  const floor = riskFloorTier(matchRiskAreas(tally.files, riskAreas))
  if (floor && RANK[floor.tier] > RANK[current] && (!best || RANK[floor.tier] > RANK[best.tier])) {
    best = { tier: floor.tier, reason: `touched a risk area (${floor.labels.join(', ')})` }
  }
  return best
}
