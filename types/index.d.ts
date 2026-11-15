// Self-contained: a plugin's state contract may not import anything.
export type StateFamily<T> = { readonly byId: T }

export type Tier = '극소' | '하' | '중' | '상' | '최상'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type TurnRoute = {
  tier: Tier
  model: string
  effort: Effort
  // The classifier's own answer, before calibration, keep-warm or the budget changed it.
  classified?: Tier
  // Provider identity only. Raw requests and classifier payloads are never stored.
  classifier?: 'builtin' | 'jev'
  // Set once a running turn moved up; the tier it started on.
  escalatedFrom?: Tier
  // The failed-check streak the last move happened at, so one streak moves the turn once.
  escalatedAtStreak?: number
  // assist mode only (classifierMode 'assist', outside hungry mode): whether Jev's answer was
  // ambiguous this turn (see jev.mjs's `ambiguous`). Null everywhere else.
  band?: 'ambiguous' | 'certain' | null
  // N. (HANDOFF.md section N) decideRoute's signals bundled into one shape — see
  // lib/policy.mjs's RoutingDecision typedef. Additive: nothing required it before this turn's
  // route was stored, and `band`/`tier` above still carry their own values independently.
  decision?: {
    tier: Tier
    risk: { tier: Tier; labels: string[] } | null
    band: 'ambiguous' | 'certain' | null
    confidence: number | null
    reasons: string[]
  }
}

export type TurnTally = {
  files: string[]
  bash: number
  tests: number
  testPasses: number
  testFails: number
  failStreak: number
  editedSinceFail: boolean
  lines: number
  reads: number
  tools: number
}

export type PaneDraft = {
  mode: 'auto' | 'manual'
  routes: Record<Tier, { model: string; effort: Effort }>
  budget: { enabled: boolean; dailyUsd: number; warnPct: number; savePct: number }
}

// --- R2 Scoring types ---

export type TaskProfile = {
  complexity: number
  reasoning: number
  risk: number
  impactScope: number
}

export type ScoringResult = {
  profile: TaskProfile
  score: number
  tier: Tier
  confidence: number
  rationale: string[]
  llmEvaluated: boolean
  llmNeeded: boolean
  source: 'heuristic' | 'llm-enhanced'
  classifyLabel: Tier | null
}

export type ScoringWeights = {
  complexity: number
  reasoning: number
  risk: number
  impactScope: number
}

export type TierThreshold = {
  tier: Tier
  min: number
  max: number
}

export type LlmTriggerConfig = {
  enabled: boolean
  confidenceThreshold: number
  highScoreThreshold: number
  highRiskThreshold: number
}

export type RoutingPolicy = 'r1' | 'r2' | 'shadow'

export type RoutingDecisionR2 = {
  tier: Tier
  risk: { tier: Tier; labels: string[] } | null
  band: null
  confidence: number | null
  reasons: string[]
}

export type DispatchResult = {
  route: TurnRoute
  reasons: string[]
  policy: RoutingPolicy | 'r1'
  scoring?: ScoringResult
  shadow?: { route: TurnRoute; reasons: string[]; scoring: ScoringResult } | null
}

export type TelemetryRecord = {
  taskId: string | null
  runId: string | null
  turnId: string | null
  stepIndex: number | null
  policyVersion: number
  routingPolicy: RoutingPolicy
  difficultyScore: number | null
  tier: Tier | null
  profile: TaskProfile | null
  confidence: number | null
  rationale: string[]
  source: 'heuristic' | 'llm-enhanced'
  classifyLabel: Tier | null
  llmEvaluated: boolean
  selectedModel: string | null
  selectedEffort: Effort | null
  actualModel: string | null
  actualEffort: Effort | null
  escalatedFrom: Tier | null
  escalatedAtStreak: number | null
  shadow: { route: { tier: Tier; model: string; effort: Effort }; scoring: { score: number } } | null
  // P0-A (TSR-OPT-001): Fast Preflight fields
  preflightDecision: 'fast_path' | 'adaptive' | null
  decisionSource: 'preflight_rule' | 'classifier' | 'escalation' | 'fallback' | null
  preflightElapsedMs: number | null
  classificationCallSkipped: boolean
  fallbackReason: string | null
  // P0-B (TSR-OPT-001): Selective Context Collection fields
  contextStrategy: 'skipped' | 'collected' | 'cached' | null
  contextFiles: number | null
  contextBytesOrTokens: number | null
  cacheValidity: 'hit' | 'miss' | 'stale' | null
  contextCollectionElapsedMs: number | null
  ts: string
}

export type QualityResult = {
  requirements: boolean | null
  build: boolean | null
  test: boolean | null
  regression: boolean | null
  security: boolean | null
  overallPass: boolean
  checkedDimensions: number
}

// Session-scoped: routing decisions per turn, the tool tally per turn, the last main route
// (for keep-warm), the session's own switches, and the pane's view.
declare module 'claude-code' {
  interface PluginState {
    'tube-slide-router': {
      turnRoutes: StateFamily<TurnRoute>
      turnTools: StateFamily<TurnTally>
      currentTurnId: string
      lastRoute: { tier: Tier; model: string; effort: Effort }
      settings: { off?: boolean; hungry?: boolean; pin?: { model: string; effort: Effort } }
      classifierHealth: { failures: number; pausedUntil: number }
      jevHealth: { failures: number; pausedUntil: number }
      pane: { view: string; draft: PaneDraft }
      // P3 (HANDOFF.md section Y): the last context-collector cache entry — a real cache, not
      // just a fingerprint kept for a log line. `note` is the already-masked, already-bounded
      // context note a matching turn reuses as-is (never raw file text); `truncated` is whether
      // any bound applied when it was built. `signature` is the sorted path set collected;
      // `hash` is collector.mjs's fingerprint of the raw content read; `limitsSignature` is
      // collector.mjs's signature of the maxFiles/maxBytes/maxTokens/timeoutMs in effect when it
      // was built, so a later /tsr-router reload that tightens or loosens any of those bounds is
      // also treated as stale, not just a changed path set or edited content. Single slot (not
      // per-turn) — only ever compared against the current turn's own signature/hash/limits, so
      // an older entry for a different path set, changed content, or changed limits is simply
      // treated as stale.
      contextCollectorCache: { signature: string; hash: string; limitsSignature: string; note: string | null; truncated: boolean; at: number }
      turnText: StateFamily<string>
    }
  }
}
