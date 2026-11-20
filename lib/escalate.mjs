// Pure: whether a running turn should move up a tier, and why.
// Two independent sources, the stronger one wins:
//  - checks failing in a row with a fix attempt between them (see addToolCall). This is a
//    self-computable, in-the-loop quality signal — the repo's OWN test/build runs, not a hidden
//    grader. As a cascade (FrugalGPT-style): one tier per `failsInRow` genuine consecutive
//    failures the turn has not already escalated on, so a run that keeps failing the real tests
//    climbs FURTHER — up to 최상 — instead of capping one tier above the classified tier. With
//    `cascade` off it reverts to the old one-tier-at-a-time move.
//  - a file the turn actually touched matches a configured risk area (see config.mjs) — jumps
//    straight to that area's minTier, since this is a hard "we know this is risky" fact, not a
//    guess. This is what makes the escalation safe even when the first classify missed it.
// File count and changed lines alone are not signals: they fire after the editing is done, when
// the remaining steps are cheap. Upward only.
import { matchRiskAreas, riskFloorTier } from './policy.mjs'
import { RANK, TIERS } from './config.mjs'

// `usedStreak` is the fail streak the turn already escalated on, so the same streak never moves it
// twice. `cascade` (default on) lets a longer real-failure streak climb more than one tier at once.
export const escalationFor = (tally, current, usedStreak = 0, failsInRow = 2, riskAreas = [], cascade = true) => {
  const rank = RANK[current]
  if (rank === undefined || rank >= RANK['최상']) return null

  let best = null // { tier, reason }
  const unconsumed = tally.failStreak - usedStreak
  if (unconsumed >= failsInRow) {
    const climb = cascade ? Math.floor(unconsumed / failsInRow) : 1
    const targetRank = Math.min(rank + climb, RANK['최상'])
    if (targetRank > rank) {
      const tiers = targetRank - rank
      best = {
        tier: TIERS[targetRank],
        reason: `${tally.failStreak} failed checks in a row${tiers > 1 ? ` (climbed ${tiers} tiers)` : ''}`,
      }
    }
  }
  const floor = riskFloorTier(matchRiskAreas(tally.files, riskAreas))
  if (floor && RANK[floor.tier] > RANK[current] && (!best || RANK[floor.tier] > RANK[best.tier])) {
    // `model` is the floor's optional override (fable ceiling); the caller applies it only when
    // fable.enabled (see register.ts). null on the fail-streak cascade branch above — repeated
    // failures top out at opus, never fable.
    best = { tier: floor.tier, reason: `touched a risk area (${floor.labels.join(', ')})`, model: floor.model ?? null }
  }
  return best
}
