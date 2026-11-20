// R2 Adaptive Router: score-based model and effort selection.
// Model is chosen by overall difficulty score. Effort is chosen by an
// "effort score" that weights reasoning and risk higher than raw complexity.
// Both selections are independent — a low-complexity, high-reasoning task
// can get haiku + xhigh, which R1's fixed tier→{model,effort} cannot express.
//
// Pure: no $ calls, no side effects. The hook (register.ts) calls
// computeScore first, then passes the ScoringResult here.

import { RANK, TIERS, EFFORTS, tierAbove, lowerOf } from './config.mjs'
import { budgetCeiling, fableCeilingModel, matchRiskAreas, riskFloorTier } from './policy.mjs'

// --- Configurable thresholds (overridable via project config) ---

export const MODEL_THRESHOLDS = [
  { min: 0, model: 'haiku' },
  { min: 40, model: 'sonnet' },
  { min: 75, model: 'opus' },
]

export const EFFORT_THRESHOLDS = [
  { min: 0, effort: 'low' },
  { min: 15, effort: 'medium' },
  { min: 35, effort: 'high' },
  { min: 60, effort: 'xhigh' },
  { min: 80, effort: 'max' },
]

export const EFFORT_SCORE_WEIGHTS = { reasoning: 0.55, risk: 0.25, complexity: 0.15, impactScope: 0.05 }

// --- Selection functions ---

export const selectModel = (difficultyScore, thresholds = MODEL_THRESHOLDS) => {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (difficultyScore >= thresholds[i].min) return thresholds[i].model
  }
  return 'haiku'
}

export const effortScore = (profile, weights = EFFORT_SCORE_WEIGHTS) => {
  const raw =
    profile.reasoning * weights.reasoning +
    profile.risk * weights.risk +
    profile.complexity * weights.complexity +
    profile.impactScope * weights.impactScope
  return Math.round(Math.min(100, Math.max(0, raw)))
}

export const selectEffort = (eScore, thresholds = EFFORT_THRESHOLDS) => {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (eScore >= thresholds[i].min) return thresholds[i].effort
  }
  return 'low'
}

const effortIdx = (e) => EFFORTS.indexOf(e)
const maxEffort = (a, b) => (effortIdx(a) >= effortIdx(b) ? a : b)
const sameRoute = (a, b) => a && b && a.model === b.model && a.effort === b.effort

// --- R2 route decision ---

export const decideRouteR2 = ({
  scoringResult,
  config,
  previous,
  stats,
  spentUsd,
  hungry,
  paths = [],
  collectorFailed = false,
  classifierFailed = false,
  modelThresholds = MODEL_THRESHOLDS,
  effortThresholds = EFFORT_THRESHOLDS,
  effortWeights = EFFORT_SCORE_WEIGHTS,
}) => {
  const reasons = []
  const { profile, score, tier, confidence } = scoringResult

  let model, effort, routeTier

  if (hungry) {
    model = 'opus'
    effort = 'high'
    routeTier = '최상'
    reasons.push('hungry mode')
  } else {
    model = selectModel(score, modelThresholds)
    const eScore = effortScore(profile, effortWeights)
    effort = selectEffort(eScore, effortThresholds)
    routeTier = tier
    reasons.push(`r2: score=${score} → model=${model}, effortScore=${eScore} → effort=${effort}`)

    // Calibration: if this tier escalates often, bump the score-derived tier
    if (config.calibration?.enabled) {
      const s = stats?.[routeTier]
      if (s && s.turns >= config.calibration.minTurns && routeTier !== '최상') {
        const rate = s.escalated / s.turns
        if (rate >= config.calibration.escalationRate) {
          const prev = routeTier
          routeTier = tierAbove(routeTier)
          model = selectModel(Math.min(score + 15, 100), modelThresholds)
          reasons.push(`calibrated: ${prev} escalated ${s.escalated}/${s.turns}`)
        }
      }
    }
  }

  let route = { tier: routeTier, model, effort }

  // Keep warm: a 극소 turn after a stronger route stays on it
  if (!hungry && config.keepWarmForMicro && routeTier === '극소' && previous && RANK[previous.tier] > RANK[routeTier] && !sameRoute(previous, route)) {
    route = { tier: previous.tier, model: previous.model, effort: previous.effort }
    reasons.push(`kept warm route ${previous.tier} for a 극소 turn`)
  }

  let riskMatch = null
  if (!hungry) {
    // Budget cap
    const cap = budgetCeiling(spentUsd, config.budget)
    if (cap && RANK[route.tier] > RANK[cap.ceiling]) {
      const capped = lowerOf(route.tier, cap.ceiling)
      const cappedModel = RANK[capped] <= 1 ? 'haiku' : 'sonnet'
      const cappedEffort = effortIdx(route.effort) > effortIdx('medium') && RANK[capped] <= 1 ? 'medium' : route.effort
      route = { tier: capped, model: cappedModel, effort: cappedEffort }
      reasons.push(`budget ${cap.pct.toFixed(0)}% used: capped at ${capped}`)
    }

    // Risk floor outranks budget
    const floor = riskFloorTier(matchRiskAreas(paths, config.riskAreas))
    riskMatch = floor
    if (floor && RANK[floor.tier] > RANK[route.tier]) {
      const floorModel = selectModel(Math.max(score, 65), modelThresholds)
      route = { tier: floor.tier, model: floorModel, effort: maxEffort(route.effort, 'high') }
      reasons.push(`risk floor (${floor.labels.join(', ')}): raised to ${floor.tier}`)
    }
    // Fable ceiling (opt-in; off by default) — same shared rule as r1/escalation so r2 isn't silently
    // capped at opus when a team enabled the ceiling. Upgrade-only; no-op unless fable.enabled.
    const ceil = fableCeilingModel(route.model, floor?.model, config.fable?.enabled)
    if (ceil) {
      route = { ...route, model: ceil }
      reasons.push(`fable ceiling (${floor.labels.join(', ')}): model raised to ${ceil}`)
    }

    // Collector failure safety fallback
    if (collectorFailed && RANK['중'] > RANK[route.tier]) {
      route = { tier: '중', model: 'sonnet', effort: maxEffort(route.effort, 'high') }
      reasons.push('context collector failed: floored to 중 (safety fallback)')
    }

    // Classifier failure safety fallback
    if (classifierFailed && RANK['중'] > RANK[route.tier]) {
      route = { tier: '중', model: 'sonnet', effort: maxEffort(route.effort, 'high') }
      reasons.push('classifier failed: floored to 중 (safety fallback)')
    }
  }

  const decision = {
    tier: route.tier,
    risk: riskMatch,
    band: null,
    confidence,
    reasons,
  }

  return {
    route: { ...route, classified: tier, band: null, decision },
    reasons,
    scoring: scoringResult,
  }
}
