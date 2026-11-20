// Pure: the decisions taken at a turn's first step, after the classifier answered.
// Order: hungry mode, calibration, keep-warm for 극소, budget cap, risk floor (outranks the
// budget cap — see decideRoute). Each returns why it acted, so the log and the turn record
// can say which rule chose the route.
import { effortAbove, EFFORTS, lowerOf, MODELS, RANK, tierAbove, TIERS } from './config.mjs'

// The stronger of two efforts (never lowers). Used by the uncertainty safety floors below, which
// must land on at least `high` regardless of the 중 route's configured effort (medium since emed1).
const maxEffort = (a, b) => (EFFORTS.indexOf(a) >= EFFORTS.indexOf(b) ? a : b)

// ④ Outcome-based calibration: a tier whose turns escalated often enough starts one tier higher.
// `stats` is { [tier]: { turns, escalated } } summed over this machine's sessions and the team file.
export const calibratedTier = (tier, stats, calibration) => {
  if (!calibration.enabled) return { tier, reason: null }
  const s = stats?.[tier]
  if (!s || s.turns < calibration.minTurns) return { tier, reason: null }
  const rate = s.escalated / s.turns
  if (rate < calibration.escalationRate || tier === '최상') return { tier, reason: null }
  return { tier: tierAbove(tier), reason: `calibrated: ${tier} turns escalated ${s.escalated}/${s.turns}` }
}

// ⑧ (new axis — see config.mjs's downgrade comment for why not ⑤) The mirror of calibratedTier,
// in the other direction: never changes routing (see config.mjs
// downgrade for why), only reports which of 중/상 has gone this long without an escalation —
// a team can decide for itself whether to lower that tier's default route.
export const downgradeAdvisories = (stats, downgrade) => {
  if (!downgrade?.enabled) return []
  return ['중', '상', '최상']
    .map((tier) => ({ tier, s: stats?.[tier] }))
    .filter(({ s }) => s && s.turns >= downgrade.minTurns && s.escalated / s.turns <= downgrade.maxEscalationRate)
    .map(({ tier, s }) => ({ tier, turns: s.turns, escalated: s.escalated }))
}

// H. step 5: assist mode's band calibration, the mirror of downgradeAdvisories above but
// comparing a tier's two bands against each other instead of against a fixed rate. `bandStats`
// is { [tier]: { ambiguous: {turns,escalated}, certain: {turns,escalated} } } (store.mjs's
// sumBandCals). Flags a tier only once both bands have enough turns, and only when 'ambiguous'
// is not escalating any more than 'certain' — i.e. the bump isn't catching anything real there.
export const bandAdvisories = (bandStats, bandCalibration) => {
  if (!bandCalibration?.enabled) return []
  return TIERS.map((tier) => ({ tier, amb: bandStats?.[tier]?.ambiguous, cert: bandStats?.[tier]?.certain }))
    .filter(({ amb, cert }) => amb && cert && amb.turns >= bandCalibration.minTurns && cert.turns >= bandCalibration.minTurns)
    .map(({ tier, amb, cert }) => ({ tier, ambTurns: amb.turns, ambRate: amb.escalated / amb.turns, certRate: cert.escalated / cert.turns }))
    .filter(({ ambRate, certRate }) => ambRate <= certRate)
}

// ⑥ Budget guard: past warnPct of the day's budget the ceiling is 중, past savePct it is 하.
export const budgetCeiling = (spentUsd, budget) => {
  if (!budget.enabled || !(budget.dailyUsd > 0)) return null
  const pct = (100 * spentUsd) / budget.dailyUsd
  if (pct >= budget.savePct) return { ceiling: '하', pct }
  if (pct >= budget.warnPct) return { ceiling: '중', pct }
  return null
}

const sameRoute = (a, b) => a && b && a.model === b.model && a.effort === b.effort

// N. (HANDOFF.md section N) The signals behind a turn's route, collected into one shape instead
// of scattered across local variables and `reasons` strings. Additive only: nothing reads this
// yet except the debug log line (hooks/register.ts) and future analysis tooling (M/O). Each
// field mirrors a value already on `route` or already computed inline — never a second
// calculation of the same thing.
//
// @typedef {{tier: string, labels: string[]}|null} RiskMatch
// @typedef {{tier: string, risk: RiskMatch, band: 'ambiguous'|'certain'|null, confidence: number|null, reasons: string[]}} RoutingDecision

// Decides the turn's route. `previous` is the route the last main turn ran on, or null.
// `paths` are the path-like strings found in the request text (see pathsIn), for the risk floor.
// `ambiguitySource`: assist mode only (classifierMode === 'assist') — null when the turn wasn't
// ambiguous (or no signal was available), otherwise 'jev' or 'self-consistency' naming which
// check flagged it (jev.mjs's `ambiguous`, or classifier.mjs's `selfConsistencyAmbiguous` as a
// fallback when Jev gave no usable answer — see HANDOFF.md section I). The caller must compute
// this before calling decideRoute, since both checks need calls this otherwise-pure function
// never makes. `confidence`: Jev's confidence number, only meaningful when ambiguitySource is
// 'jev' (self-consistency's signal is unanimous-or-not, not a scalar — see HANDOFF.md section N).
// `classifierFailed`: the builtin classifier itself (not Jev, not the context collector) threw
// or was paused this turn — the caller passes `classified: '중'` (a placeholder, there is no
// real label) alongside this flag (see HANDOFF.md section AA/V's P4 residual risk, closed in the
// section documenting this parameter's addition). Same shape and same slot as `collectorFailed`.
// Forces RoutingDecision.band to null even in assist mode (see below): with no real
// classification this turn, there is nothing for 'certain'/'ambiguous' to describe.
export const decideRoute = ({ classified, config, previous, stats, spentUsd, hungry, paths = [], ambiguitySource = null, confidence = null, collectorFailed = false, classifierFailed = false }) => {
  const reasons = []
  let tier = classified
  if (hungry) {
    tier = '최상'
    reasons.push('hungry mode')
  } else {
    const cal = calibratedTier(tier, stats, config.calibration)
    if (cal.reason) reasons.push(cal.reason)
    tier = cal.tier
  }
  let route = { tier, ...config.routes[tier] }

  // Keep warm: a 극소 turn after a stronger route stays on it instead of switching away and back.
  if (!hungry && config.keepWarmForMicro && tier === '극소' && previous && RANK[previous.tier] > RANK[tier] && !sameRoute(previous, route)) {
    route = { tier: previous.tier, model: previous.model, effort: previous.effort }
    reasons.push(`kept warm route ${previous.tier} for a 극소 turn`)
  }

  // Score-based nudge (H.): same tier, one step more effort — never a model switch. Placed
  // before the budget cap and risk floor below so either can still fully override it (each
  // replaces `route` wholesale), matching this function's existing "later gate wins" order.
  if (!hungry && config.classifierMode === 'assist' && ambiguitySource) {
    route = { ...route, effort: effortAbove(route.effort) }
    reasons.push(`assist (${ambiguitySource}): ambiguous — effort raised to ${route.effort}`)
  }

  // Kept for RoutingDecision.risk (below) regardless of whether it ends up overriding route:
  // a match that didn't need to raise anything is still a fact worth keeping, not just a
  // reason string that only appears when it changed something.
  let riskMatch = null
  if (!hungry) {
    const cap = budgetCeiling(spentUsd, config.budget)
    if (cap && RANK[route.tier] > RANK[cap.ceiling]) {
      const capped = lowerOf(route.tier, cap.ceiling)
      route = { tier: capped, ...config.routes[capped] }
      reasons.push(`budget ${cap.pct.toFixed(0)}% used: capped at ${capped}`)
    }
    // Risk floor outranks the budget cap: under-routing a known-risky area to save money is
    // not a trade this router makes on its own. It still never raises past 최상, so it cannot
    // itself bypass hungry mode's effect (hungry already routes at 최상).
    const floor = riskFloorTier(matchRiskAreas(paths, config.riskAreas))
    riskMatch = floor
    if (floor && RANK[floor.tier] > RANK[route.tier]) {
      route = { tier: floor.tier, ...config.routes[floor.tier] }
      reasons.push(`risk floor (${floor.labels.join(', ')}): raised to ${floor.tier}`)
    }
    // Fable ceiling (opt-in; off by default): a catastrophic-blast-radius file (the floor carries a
    // model override) climbs one model step past opus to fable — regardless of whether the floor
    // raised the tier above, since the trigger is the file class itself, not the tier delta. See
    // fableCeilingModel (shared with r2 and the mid-turn escalation path).
    const ceil = fableCeilingModel(route.model, floor?.model, config.fable?.enabled)
    if (ceil) {
      route = { ...route, model: ceil }
      reasons.push(`fable ceiling (${floor.labels.join(', ')}): model raised to ${ceil}`)
    }
    // P3 (HANDOFF.md section Y): the context collector could not say what the request
    // actually touches (timed out or errored) — treated the same as an unresolved risk area,
    // never as a confirmed-safe empty context. Floors to 중 (Sonnet+high); never below
    // whatever the risk floor above already set, and never past 최상 on its own.
    // Explicitly Sonnet/high, NOT config.routes['중'] (which is sonnet/medium since emed1): under
    // uncertainty we want MORE thinking, not the cost-tuned normal-중 effort. `>=` so a turn already
    // sitting at 중 still gets the high bump; 상/최상 from the risk floor/hungry above are stronger
    // and left alone. The medium measurement (emed1) only licensed confidently-classified 중, never
    // this "we don't actually know the difficulty" path.
    if (collectorFailed && RANK['중'] >= RANK[route.tier]) {
      route = { tier: '중', model: 'sonnet', effort: maxEffort(route.effort, 'high') }
      reasons.push('context collector failed: floored to 중 (safety fallback)')
    }
    // V/AA (HANDOFF.md section AA's residual risk, closed here): the builtin classifier itself
    // threw or is paused (its own circuit breaker, see engine.mjs/classifier.mjs) — auto mode
    // only (hooks/register.ts gates this), never manual, where a team's own configured routes
    // are the only ones that apply. Same floor, same place in the order as collectorFailed right
    // above: never below 중 (Sonnet+high), never undoes the risk floor or hungry mode (both
    // already applied above), and the budget cap earlier in this block cannot have the last word
    // over "we don't actually know this turn's difficulty" any more than it can over a collector
    // failure or a known risk path.
    if (classifierFailed && RANK['중'] >= RANK[route.tier]) {
      route = { tier: '중', model: 'sonnet', effort: maxEffort(route.effort, 'high') }
      reasons.push('classifier failed: floored to 중 (safety fallback)')
    }
  }
  // Recorded for later band-threshold calibration (store.mjs), not consumed by anything yet.
  // Null outside assist mode, under hungry mode, and on a classifier failure — all three already
  // route every turn the same way, and a failure additionally never performed a real
  // classification, so it must never read as either 'certain' or 'ambiguous' (P4: a failed turn
  // was being recorded as 'certain', silently pulling the calibration stats toward a tier's
  // normal-case band even though nothing was actually classified).
  const band = !hungry && !classifierFailed && config.classifierMode === 'assist' ? (ambiguitySource ? 'ambiguous' : 'certain') : null
  /** @type {RoutingDecision} */
  const decision = { tier: route.tier, risk: riskMatch, band, confidence: ambiguitySource === 'jev' ? confidence : null, reasons }
  return { route: { ...route, classified, band, decision }, reasons }
}

// ② Deterministic floor, independent of any classifier's answer (see DEFAULT_RISK_AREAS in
// config.mjs for why). `paths` is whatever file-like strings are known for the turn so far:
// at classify time, the ones named in the prompt; mid-turn, the files actually touched.
const PATH_LIKE = /[\w.-]+(?:\/[\w.-]+)+|[\w-]+\.(?:js|ts|tsx|jsx|mjs|py|go|rb|java|kt|sql|json|ya?ml)\b/g

export const pathsIn = (text) => String(text).match(PATH_LIKE) ?? []

export const matchRiskAreas = (paths, riskAreas) => {
  const hits = []
  for (const area of riskAreas ?? []) {
    let re
    try {
      re = new RegExp(area.pattern, 'i')
    } catch {
      continue // an invalid pattern here is a config bug elsewhere; never let it crash routing
    }
    if (paths.some((p) => re.test(p))) hits.push(area)
  }
  return hits
}

// The strongest minTier among the matches, or null when nothing matched. `model` is the strongest
// model override carried by any matched area (used by the fable ceiling; null when none set it, and
// honoured only when fable.enabled — see decideRoute / register.ts). Picked independently of tier so
// a catastrophic (model-bearing) match still contributes its model even when another area ties its tier.
export const riskFloorTier = (matches) => {
  if (!matches.length) return null
  const strongest = matches.reduce((a, b) => (RANK[b.minTier] > RANK[a.minTier] ? b : a))
  const model = matches
    .map((m) => m.model)
    .filter((m) => MODELS.includes(m))
    .reduce((a, m) => (MODELS.indexOf(m) > MODELS.indexOf(a) ? m : a), null)
  return { tier: strongest.minTier, labels: [...new Set(matches.map((m) => m.label))], model }
}

// Single source of truth for the fable ceiling (opt-in, off by default), shared by r1 decideRoute,
// r2 (route-r2.mjs), and the mid-turn escalation path (register.ts) so they can't drift apart.
// Returns the model to raise `currentModel` to when an override (`overrideModel`, carried by a
// catastrophic risk area) outranks it AND fable is enabled; else null. Upgrade-only (never lowers),
// and a no-op unless fableEnabled — so the default path is unchanged.
export const fableCeilingModel = (currentModel, overrideModel, fableEnabled) => {
  if (!fableEnabled || !overrideModel) return null
  return MODELS.indexOf(overrideModel) > MODELS.indexOf(currentModel) ? overrideModel : null
}

// What the classifier sees in addition to the request text: a plain-language heads-up when a
// path it names is in a configured risk area. Advisory only — the floor above is what actually
// guarantees the tier; this just helps the classifier itself answer well.
export const contextNote = (text, riskAreas) => {
  const floor = riskFloorTier(matchRiskAreas(pathsIn(text), riskAreas))
  if (!floor) return null
  return `참고: 요청이 위험 영역(${floor.labels.join(', ')})의 경로를 직접 가리킵니다.`
}

// P0-A (TSR-OPT-001) Fast Preflight gate. `sessionModel` is undefined/null in headless mode
// when --model wasn't passed on the CLI — Sonnet is still Claude Code's actual default there
// (finding #22), so unset counts as default Sonnet, not as "non-sonnet".
export const isDefaultSonnet = (sessionModel) =>
  sessionModel == null || (typeof sessionModel === 'string' && (sessionModel === 'sonnet' || sessionModel.includes('sonnet')))

export const preflightDecision = ({ sessionModel, hasRisk, tooManyPaths, recentlyEscalated, hungry }) => {
  const defaultSonnet = isDefaultSonnet(sessionModel)
  if (defaultSonnet && !hasRisk && !tooManyPaths && !recentlyEscalated && hungry !== true) {
    return { decision: 'fast_path', fallbackReason: null }
  }
  const fallbackReason = !defaultSonnet ? 'non_sonnet_model'
    : hasRisk ? 'risk_area_detected'
    : tooManyPaths ? 'large_scope'
    : recentlyEscalated ? 'recent_escalation'
    : hungry ? 'hungry_mode'
    : 'unknown'
  return { decision: 'adaptive', fallbackReason }
}
