// Pure: Task scoring engine for R2 Adaptive Router.
// Computes 0-100 difficulty score from 4 sub-dimensions using local heuristics.
// Optional LLM evaluation is triggered by the caller (hooks/register.ts) when
// needsLlmEvaluation returns true. No `$` here.

import { RANK, TIERS } from './config.mjs'

// --- Default configuration (all overridable via project config) ---

export const SCORING_WEIGHTS = { complexity: 0.35, reasoning: 0.30, risk: 0.20, impactScope: 0.15 }
// A single very-high dimension still guarantees a minimum score (prevents dilution).
export const PEAK_FLOOR_FACTOR = 0.55

export const TIER_THRESHOLDS = [
  { tier: '극소', min: 0, max: 19 },
  { tier: '하', min: 20, max: 39 },
  { tier: '중', min: 40, max: 64 },
  { tier: '상', min: 65, max: 84 },
  { tier: '최상', min: 85, max: 100 },
]

export const LLM_TRIGGER_DEFAULTS = {
  enabled: false,
  confidenceThreshold: 0.4,
  highScoreThreshold: 65,
  highRiskThreshold: 60,
}

// --- Signal detection patterns ---
// Each pattern group maps to one sub-dimension. Matches are counted, not interpreted.

// Korean chars are outside \w so \b never fires around them. Split each
// pattern: English terms keep \b, Korean terms match as substrings (they are
// naturally delimited by spaces and grammatical particles).

const COMPLEXITY_PATTERNS = {
  architecture: /(?:아키텍처|리팩토링|마이그레이션|재설계|\barchitecture\b|\brefactor(?:ing)?\b|\bredesign\b|\bmigration\b)/gi,
  stateManagement: /(?:동시성?|트랜잭션|비동기|상태\s*머신|\bconcurrent\b|\bconcurrency\b|\basync\b|\btransaction\b|\bstate\s*machine\b|\block\b|\bmutex\b|\bsemaphore\b)/gi,
  multiSystem: /(?:통합|마이크로서비스|메시지\s*큐|이벤트\s*버스|\bintegration\b|\bmicroservice\b|\bcross[._-]?module\b|\bgRPC\b|\bmessage\s*queue\b)/gi,
  newDesign: /(?:새로운?\s*설계|처음부터|아키텍처\s*설계|\bnew\s*design\b|\bfrom\s*scratch\b|\bsystem\s*design\b)/gi,
}

const REASONING_PATTERNS = {
  debugging: /(?:디버그|조사|원인\s*분석|원인\s*찾|버그|\bdebug(?:ging)?\b|\binvestigate\b|\broot\s*cause\b|\bbug\b)/gi,
  optimization: /(?:최적화|성능|효율|병목|\boptimiz(?:e|ation)\b|\bperformance\b|\befficient\b|\bbottleneck\b)/gi,
  design: /(?:설계|패턴|전략|접근\s*방식|\bdesign\s*(?:decision|pattern)\b|\bpattern\b|\bstrategy\b|\bapproach\b|\btrade[._-]?off\b)/gi,
  analysis: /(?:분석|평가|비교|검토|\banalyz(?:e|ing)\b|\bevaluat(?:e|ion)\b|\bcompar(?:e|ison)\b|\breview\b)/gi,
  multiStep: /(?:조건부|엣지\s*케이스|분기|예외\s*처리|경우의\s*수|\bconditional\b|\bedge\s*case\b|\bbranch(?:ing)?\b|\bexception\b)/gi,
}

const RISK_PATTERNS = {
  dataModification: /(?:삭제|파괴|스키마\s*변경|\bdelete\b|\bdrop\s+(?:table|database|index)\b|\bmigrate\b|\bALTER\s+TABLE\b|\btruncate\b|\bdestroy\b)/gi,
  permission: /(?:권한|접근\s*제어|관리자|인가|\bpermission\b|\brole\b|\baccess\s*control\b|\badmin\b|\bauthoriz)/gi,
  production: /(?:프로덕션|배포|릴리스|롤백|운영\s*환경|\bproduction\b|\bdeploy\b|\brelease\b|\brollback\b)/gi,
  irreversible: /(?:되돌릴\s*수\s*없|복구\s*불가|영구|\birreversible\b|\bpermanent\b|\bcannot\s*undo\b)/gi,
  sensitive: /(?:개인\s*정보|암호화|인증서|비밀\s*키|\bPII\b|\bGDPR\b|\bencrypt\b|\bcertificate\b|\bprivate\s*key\b)/gi,
}

const SCOPE_PATTERNS = {
  moduleBoundary: /(?:크로스\s*모듈|공유\s*모듈|글로벌|전역|\bcross[._-]?module\b|\bshared\b|\bglobal\s*state\b)/gi,
  apiContract: /(?:엔드포인트|인터페이스\s*변경|\bAPI\s*(?:계약|contract|변경)\b|\bendpoint\b|\bschema\s*change\b|\bbreaking\s*change\b)/gi,
  userFacing: /(?:프론트엔드|사용자\s*경험|고객\s*영향|\bUI\b|\bfrontend\b|\buser\s*experience\b|\bUX\b)/gi,
  systemWide: /(?:시스템\s*전체|전체\s*서비스|전사|인프라|\bsystem[._-]?wide\b|\ball\s*services\b|\binfrastructure\b)/gi,
}

// --- Signal counting ---

const countMatches = (text, patterns) => {
  const counts = {}
  let total = 0
  for (const [name, re] of Object.entries(patterns)) {
    const matches = text.match(re) || []
    counts[name] = matches.length
    total += matches.length
  }
  return { counts, total }
}

// --- Sub-dimension scoring ---
// Each dimension: base 0, signals add points, capped at 100.
// Scoring is transparent: every point has a named source.

const dimensionFromSignals = (signalTotal, fileCount, multiplier, base = 0) =>
  Math.min(100, Math.max(0, base + signalTotal * multiplier + fileCount * 5))

export const detectSignals = (text, riskMatchCount = 0, filePathCount = 0) => {
  const complexity = countMatches(text, COMPLEXITY_PATTERNS)
  const reasoning = countMatches(text, REASONING_PATTERNS)
  const risk = countMatches(text, RISK_PATTERNS)
  const scope = countMatches(text, SCOPE_PATTERNS)

  return { complexity, reasoning, risk, scope, riskMatchCount, filePathCount }
}

export const dimensionScores = (signals) => {
  const { complexity, reasoning, risk, scope, riskMatchCount, filePathCount } = signals

  const complexityScore = dimensionFromSignals(complexity.total, filePathCount, 12, filePathCount > 3 ? 20 : 0)
  const reasoningScore = dimensionFromSignals(reasoning.total, 0, 15)
  const riskScore = Math.min(100, riskMatchCount * 30 + risk.total * 15)
  const impactScopeScore = dimensionFromSignals(scope.total, Math.min(filePathCount, 5), 12, filePathCount > 5 ? 15 : 0)

  return {
    complexity: complexityScore,
    reasoning: reasoningScore,
    risk: riskScore,
    impactScope: impactScopeScore,
  }
}

// --- Weighted aggregate ---

export const difficultyScore = (profile, weights = SCORING_WEIGHTS, peakFactor = PEAK_FLOOR_FACTOR) => {
  const raw =
    profile.complexity * weights.complexity +
    profile.reasoning * weights.reasoning +
    profile.risk * weights.risk +
    profile.impactScope * weights.impactScope
  const peak = Math.max(profile.complexity, profile.reasoning, profile.risk, profile.impactScope)
  const peakFloor = peak * peakFactor
  return Math.round(Math.min(100, Math.max(0, raw, peakFloor)))
}

// --- Score → Tier mapping ---

export const scoreToTier = (score, thresholds = TIER_THRESHOLDS) => {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (score >= thresholds[i].min) return thresholds[i].tier
  }
  return '극소'
}

// --- Confidence estimation ---
// Based on distance from nearest tier boundary and signal density.
// Not a probability — a heuristic measure of how decisive the scoring was.

export const scoringConfidence = (profile, score, thresholds = TIER_THRESHOLDS) => {
  const tier = scoreToTier(score, thresholds)
  const band = thresholds.find((t) => t.tier === tier)
  if (!band) return 0

  const range = band.max - band.min
  if (range <= 0) return 1

  const distFromLow = score - band.min
  const distFromHigh = band.max - score
  const minDist = Math.min(distFromLow, distFromHigh)
  const boundaryProximity = minDist / (range / 2)

  const signalCount = profile.complexity + profile.reasoning + profile.risk + profile.impactScope
  const signalDensity = Math.min(1, signalCount / 200)

  return Math.round(Math.min(1, (boundaryProximity * 0.7 + signalDensity * 0.3)) * 100) / 100
}

// --- LLM evaluation trigger ---

export const needsLlmEvaluation = (profile, score, confidence, config = LLM_TRIGGER_DEFAULTS) => {
  if (!config.enabled) return false
  if (confidence < config.confidenceThreshold) return true
  if (score >= config.highScoreThreshold) return true
  if (profile.risk >= config.highRiskThreshold) return true
  return false
}

// --- Rationale generation ---

const describeSignals = (signals) => {
  const parts = []
  for (const [dim, { counts, total }] of Object.entries({ complexity: signals.complexity, reasoning: signals.reasoning, risk: signals.risk, scope: signals.scope })) {
    if (total > 0) {
      const active = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}:${n}`)
      parts.push(`${dim}(${active.join(',')})`)
    }
  }
  if (signals.riskMatchCount > 0) parts.push(`riskAreas:${signals.riskMatchCount}`)
  if (signals.filePathCount > 0) parts.push(`files:${signals.filePathCount}`)
  return parts
}

// --- Full scoring (assembles everything) ---

export const computeScore = ({ text, riskMatchCount = 0, filePathCount = 0, classifyLabel = null, weights = SCORING_WEIGHTS, thresholds = TIER_THRESHOLDS, llmConfig = LLM_TRIGGER_DEFAULTS }) => {
  const signals = detectSignals(text, riskMatchCount, filePathCount)
  const profile = dimensionScores(signals)
  const score = difficultyScore(profile, weights)
  const tier = scoreToTier(score, thresholds)
  const confidence = scoringConfidence(profile, score, thresholds)
  const rationale = describeSignals(signals)

  const llmNeeded = needsLlmEvaluation(profile, score, confidence, llmConfig)

  if (classifyLabel && TIERS.includes(classifyLabel)) {
    rationale.push(`classify:${classifyLabel}`)
    if (classifyLabel !== tier) {
      rationale.push(`heuristic-tier:${tier},classify-tier:${classifyLabel}`)
    }
  }

  return {
    profile,
    score,
    tier,
    confidence,
    rationale,
    llmEvaluated: false,
    llmNeeded,
    source: 'heuristic',
    classifyLabel: classifyLabel || null,
  }
}

// --- LLM dimension prompts (for optional 2nd-pass evaluation) ---
// Each returns a criteria text suitable for $.model.classify with TIERS as labels.
// Called only when needsLlmEvaluation is true.

export const LLM_DIMENSION_CRITERIA = {
  complexity: '이 작업의 구조적 복잡도만 판단하세요. 파일 수, 모듈 수, 의존관계, 동시성/상태 관리가 복잡할수록 높은 등급입니다.',
  reasoning: '이 작업에 필요한 추론 깊이만 판단하세요. 디버깅, 최적화, 설계 결정, 다단계 분석이 필요할수록 높은 등급입니다.',
  risk: '이 작업의 위험도만 판단하세요. 인증, 결제, 데이터 정합성, 보안, 운영 환경 변경이 관련될수록 높은 등급입니다.',
}

export const tierToScore = (tier) => {
  const band = TIER_THRESHOLDS.find((t) => t.tier === tier)
  return band ? Math.round((band.min + band.max) / 2) : 50
}

export const applyLlmDimensions = (result, llmDimensions) => {
  const enhanced = { ...result }
  if (llmDimensions.complexity != null) enhanced.profile = { ...enhanced.profile, complexity: llmDimensions.complexity }
  if (llmDimensions.reasoning != null) enhanced.profile = { ...enhanced.profile, reasoning: llmDimensions.reasoning }
  if (llmDimensions.risk != null) enhanced.profile = { ...enhanced.profile, risk: llmDimensions.risk }

  const weights = SCORING_WEIGHTS
  enhanced.score = difficultyScore(enhanced.profile, weights)
  enhanced.tier = scoreToTier(enhanced.score)
  enhanced.confidence = scoringConfidence(enhanced.profile, enhanced.score)
  enhanced.llmEvaluated = true
  enhanced.source = 'llm-enhanced'

  for (const [dim, score] of Object.entries(llmDimensions)) {
    if (score != null) enhanced.rationale.push(`llm-${dim}:${score}`)
  }
  return enhanced
}
