// Pure: defaults, the user's file merged over them, and validation. No `$` here.
// Files: the profile's `tube-slide-router.json`, then the project's `.claude/tube-slide-router.json`.

export const TIERS = ['극소', '하', '중', '상', '최상']
// Ordered weakest → strongest; clampModelFloor and the fable ceiling rely on this order.
// `fable` sits above opus but is UNMEASURED (unlike opus, covered by the E2E benchmark) and is
// never a default route — it is only ever reached when a team opts into the `fable` ceiling
// (see DEFAULTS.fable) or pins it manually.
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const MODES = ['auto', 'manual']
// 'builtin' (default): $.model.classify only. 'shadow': builtin still decides the route;
// Jev is also asked and the two answers are compared and recorded, never routed on.
// 'assist' (see HANDOFF.md section H): builtin still decides the tier; when Jev disagrees or
// is unsure, effort may be nudged one step within that same tier. Schema-only for now — no
// code branches on 'assist' yet, so setting it currently behaves like 'builtin' (no Jev call).
// A 'jev' main mode is a later step, once shadow data shows its accuracy (see HANDOFF.md).
export const CLASSIFIER_MODES = ['builtin', 'shadow', 'assist']
export const ROUTING_POLICIES = ['r1', 'r2', 'shadow']
export const ROUTE_PROFILES = {
  default: {
    극소: { model: 'haiku', effort: 'medium' },
    하: { model: 'haiku', effort: 'medium' },
    // 중 = sonnet/medium (changed from high 2026-11-20, batch emed1). The effort ladder is now
    // 중(sonnet/medium) < 상(sonnet/high) < 최상(opus) — "cheap where we can, strong where we must".
    // Evidence: 6 contract-v2/authored medium-difficulty cases × 2 reps, sonnet medium vs high, both
    // 12/12 SUCCESS (acceptance+regression), medium using ~61% less thinking / ~14% less $ (see
    // E2E-AUG1-REPORT §8). Honest limit: all 6 passed on BOTH efforts, so this shows "no measured
    // loss + real savings", not proven equivalence on every 중 task; a rare under-think is caught by
    // the escalation cascade. Consistent with R-021 (xhigh→high lost nothing even on HARD tasks).
    중: { model: 'sonnet', effort: 'medium' },
    상: { model: 'sonnet', effort: 'high' },
    최상: { model: 'opus', effort: 'high' },
  },
  // 'abl-eb' was promoted to be the default (R-021), so it is kept IDENTICAL to `default` above —
  // a test pins this invariant. The 중→medium change (emed1) applies to both in lock-step.
  'abl-eb': {
    극소: { model: 'haiku', effort: 'medium' },
    하: { model: 'haiku', effort: 'medium' },
    중: { model: 'sonnet', effort: 'medium' },
    상: { model: 'sonnet', effort: 'high' },
    최상: { model: 'opus', effort: 'high' },
  },
}
export const ROUTE_PROFILE_NAMES = Object.keys(ROUTE_PROFILES)
// Assist's 2-band ambiguity signal (see jev.mjs's `ambiguous`), named for per-tier×band
// aggregation in store.mjs. Only ever set on a turn's route when classifierMode is 'assist'.
export const BANDS = ['ambiguous', 'certain']

export const RANK = { 극소: 0, 하: 1, 중: 2, 상: 3, 최상: 4 }
export const tierAbove = (tier) => TIERS[Math.min(RANK[tier] + 1, TIERS.length - 1)]
export const lowerOf = (a, b) => (RANK[a] <= RANK[b] ? a : b)
// Used by assist mode (HANDOFF.md section H) to nudge effort one step without crossing a
// model switch — a model switch costs much more than an effort change (see prices.mjs/RESULTS.md).
export const effortAbove = (effort) => EFFORTS[Math.min(EFFORTS.indexOf(effort) + 1, EFFORTS.length - 1)]

// Model floor guard: never downgrade below the configured minimum model.
// Default 'haiku' (2026-11-15, see DEFAULTS.modelFloor's comment) allows the router's full
// range, including Opus→Sonnet (the router's primary cost-saving mechanism). A team can set
// modelFloor to 'sonnet' (blocks Haiku downgrade, the pre-2026-11-15 default) or 'opus'
// (never downgrade from Opus).
// Previous design used the session model as the floor, which blocked Opus→Sonnet
// whenever the CLI defaulted to Opus — defeating the router's core value.
export const clampModelFloor = (routerModel, floorModel) => {
  if (!floorModel) return routerModel
  const norm = typeof floorModel === 'string' ? floorModel.toLowerCase() : ''
  const floor = MODELS.find(m => norm === m || norm.includes(m))
  if (!floor) return routerModel
  const ri = MODELS.indexOf(routerModel)
  const fi = MODELS.indexOf(floor)
  return ri >= fi ? routerModel : floor
}

// The classifier's criteria. The tier descriptions here are what the onboarding screen shows too.
export const TIER_HINTS = {
  극소: '인사, 감사, 단어나 사실 하나를 묻는 질문, 한 줄짜리 오타 수정',
  하: '작은 코드 조각 작성이나 변환, 명령어 하나 묻기, 한 파일 안의 작은 변경, 문서나 주석만 고치는 작업, 이름 바꾸기 같은 기계적인 치환을 여러 파일에 그대로 반복 적용하는 작업(건드리는 파일 수와 무관하게 하), 이미 있는 함수를 줄 단위로 반복 호출하거나 줄바꿈·공백 같은 입력을 나누기만 하는 전처리, 복잡한 설계 없이 뻔한 구조로 끝나는 기능 하나짜리 프로그램·페이지·스크립트를 처음부터 새로 만드는 것(예: 입력 하나 받아 그대로 응답하는 엔드포인트, 버튼 하나짜리 페이지)',
  중: '여러 단계의 설계나 비교, 원인 찾기(디버깅), 이미 있는 모듈 한두 개를 가져다 연결하거나 작은 기능을 구현하는 작업, 여러 경우의 수(이스케이프 문자, 중첩, 순서)를 추적하며 분기해야 하는 파싱·자료구조 갱신 로직(캐시 교체 순서, 따옴표 중첩 처리 등), 흔한 기능 여러 개(입력 검증, 목록 추가·삭제, 폼 제출 같은)를 조합한 프로그램·페이지를 처음부터 만드는 것 — 새로 판단해야 할 로직이 있지만 큰 설계 결정은 없는 경우',
  상: '여러 모듈에 걸친 기능 구현·리팩터링, 새로운 설계 판단이 필요한 변경, 까다로운 디버깅, 결제·인증·데이터 정합성이 걸린 일반적인 변경 — 어렵지만 한 사람이 한 덩어리로 설계·구현할 수 있는 수준',
  최상: '최고 난이도. 다음 중 하나에 해당하는 작업 — (1) 시스템 아키텍처를 새로 설계하거나 여러 서비스·레이어에 걸쳐 구조를 근본적으로 재구성, (2) 복잡한 상호작용 로직: 까다로운 동시성·분산 상태·정교한 알고리즘, 또는 여러 불변식이 동시에 얽혀 한 수를 잘못 두면 전체가 틀어지는 로직, (3) 광범위한 영향의 대규모 리팩터링, (4) 보안·결제·인증 핵심 프로토콜을 처음부터 새로 설계하거나 잘못되면 서비스 전체 중단·대규모 데이터 유출로 이어지는 작업. 요지: "어려운 기능" 수준을 넘어 설계·추론 자체가 어렵거나 피해 범위가 재앙적인 작업',
}

const CRITERIA_RULE = '건드리는 파일이나 모듈의 개수만으로 등급을 올리지 마세요. 같은 종류의 변경을 여러 곳에 기계적으로 반복하거나 이미 있는 부품을 연결하는 작업은 파일 수가 많아도 하/중이고, 새로운 설계 판단이 필요한지가 상/하를 가릅니다.'
const CREATION_RULE = '기존 코드를 고치는 것이든 아무것도 없는 상태에서 새로 만드는 것이든 같은 기준으로 판단하세요. "새로 만든다"는 사실 자체는 등급을 올리는 신호가 아닙니다 — 그 결과물이 뻔한 구조인지, 새로운 설계 판단이 필요한지로 보세요.'

export const criteriaText = () =>
  ['아래 요청이 얼마나 어려운 작업인지 등급을 고르세요.', ...TIERS.map((t) => `- ${t}: ${TIER_HINTS[t]}`), CRITERIA_RULE, CREATION_RULE].join('\n')

// ② A deterministic floor, independent of what any classifier (builtin or Jev) answers: a
// request or an edited file matching `pattern` can never route below `minTier`. Day one, with
// no usage history yet, this is the one thing that makes a wrong classification safe rather
// than silently under-routing a risky change. A team extends this list in its config file;
// these defaults are not removed, only added to (see mergeConfig).
// Caveat (2026-11-11, HANDOFF.md section S): this floor guarantees a *tier*, not a model. The
// 4 defaults below all use minTier: '상', whose route is now sonnet/high (changed from
// sonnet/xhigh on 2026-11-15: R-021 confirmed ABL-EB — xhigh→high cuts thinking 83% on
// hard tasks with no acceptance loss, 90 runs 3-rep PASS).
// A team that adds `/tsr-router risk add <label> 중` now gets sonnet/high; with `상` it gets
// sonnet/high; with `최상` it gets opus/high.
//
// Catastrophic floor → opus (2026-11-20). The E2E benchmark found opus has NO measured accuracy
// edge over sonnet on normal/hard work (opus 82% < sonnet 87%, 2.5x cost — see E2E-AUG1-REPORT §7),
// so this floor is NOT a performance claim. It is a deliberate TAIL-RISK INSURANCE posture: for the
// narrow, path-detectable file classes where a mistake is catastrophic in blast radius — secret/key
// material (a leak = mass breach) and DB migrations (a bad one = data loss) — spend on the strongest
// model to minimise the worst case, independent of average accuracy. It is kept narrow on purpose:
// `결제`/`인증` stay at 상 because a path cannot tell a core-protocol rewrite from a label tweak,
// and routing every auth/payment touch to opus would waste money for no measured gain. Architecture-
// scale / new-core-protocol work reaches opus via the 최상 *classification* or a manual pin instead.
//
// `model: 'fable'` on the two catastrophic entries (2026-11-20) is the opt-in ceiling: it is IGNORED
// unless a team sets `fable.enabled` (DEFAULTS.fable). With the ceiling off (the default) these two
// behave exactly as before — floor to 최상 → opus. With it on, only these narrowest, highest-stakes
// paths climb one model step past opus to fable; normal 최상 work still gets opus. See DEFAULTS.fable.
export const DEFAULT_RISK_AREAS = [
  { label: '인증', pattern: '(^|/)(auth|login|session|oauth|sso)[^/\\s]*', minTier: '상' },
  { label: '결제', pattern: '(^|/)(pay|payment|billing|checkout|refund|settle)[^/\\s]*', minTier: '상' },
  { label: '데이터베이스 스키마', pattern: '(^|/)(migrations?|schema|db)[/._]', minTier: '상' },
  { label: '보안', pattern: '(^|/)(secur|crypto|secret|key)[^/\\s]*', minTier: '상' },
  // --- Catastrophic blast radius → opus (risk insurance, not a performance claim). Narrow & precise. ---
  // `model: 'fable'` only takes effect when fable.enabled; otherwise these floor to 최상 → opus.
  { label: '비밀정보·키', pattern: '(^|/)(secrets?|credentials?|private[-_.]?keys?|keystore|keypair)[^/\\s]*', minTier: '최상', model: 'fable' },
  { label: 'DB 마이그레이션', pattern: '(^|/)migrations?[/._]', minTier: '최상', model: 'fable' },
]

export const DEFAULTS = {
  version: 1,
  mode: 'auto',
  routes: {
    극소: { model: 'haiku', effort: 'medium' },
    하: { model: 'haiku', effort: 'medium' },
    // 중 = sonnet/medium (batch emed1, 2026-11-20 — see ROUTE_PROFILES.default for the evidence).
    중: { model: 'sonnet', effort: 'medium' },
    상: { model: 'sonnet', effort: 'high' },
    최상: { model: 'opus', effort: 'high' },
  },
  riskAreas: DEFAULT_RISK_AREAS,
  // `failsInRow` genuine consecutive failures move the turn up one tier. `cascade` (default on)
  // makes it a ladder: every additional `failsInRow` failures climbs another tier, up to 최상, so a
  // run that keeps failing the repo's own tests reaches opus instead of capping one tier up. Set
  // cascade:false for the old one-tier-at-a-time behavior.
  escalation: { failsInRow: 2, cascade: true },
  // Experimental top-model ceiling — OFF by default. When `enabled`, the catastrophic risk floor
  // (비밀정보·키 / DB 마이그레이션 — the narrowest, highest-blast-radius file classes) routes to
  // `fable` instead of opus. Everything else — normal 최상 classification AND the repeated-failure
  // escalation cascade — still tops out at opus. Rationale: fable sits above opus in MODELS, but we
  // have NO measurement of it (opus is covered by the E2E benchmark; fable is not), so it is never a
  // default route. A team opts in explicitly, and even then only the rarest, highest-stakes path
  // reaches it ("확실히 필요할 때만 가장 강한 모델"). Two honest caveats: (1) prices.mjs has no fable
  // rate (its real price is unknown and NOT fabricated), so fable turns record cost as unknown
  // (null), never zero; (2) Claude Code must actually support routing to fable for this to do
  // anything — verify in a real session, this lib cannot. Off → behaviour is byte-identical to before.
  fable: { enabled: false },
  // External check results (CI, a pre-commit hook, an acceptance/test runner driven between turns)
  // read from an append-only ledger (lib/checks.mjs). Repeated REAL failures there count the same as
  // the agent's own repeated failing test runs — they feed escalationFor's fail streak, never a tier
  // directly, and still need `escalation.failsInRow` failures to move up one tier. Off by default:
  // interactive/single-shot routing is unchanged until a team (or the benchmark harness) opts in.
  observedChecks: { enabled: false },
  // A 극소 turn right after a stronger route keeps that route: switching away and back
  // rewrites the stronger model's cache, which costs more than one small turn on it.
  keepWarmForMicro: true,
  budget: { enabled: false, dailyUsd: 20, warnPct: 70, savePct: 90 },
  // Historical escalations are observational until a team has enough representative data.
  // Opt in explicitly instead of letting early environment/tool failures raise future routes.
  calibration: { enabled: false, minTurns: 8, escalationRate: 0.3 },
  // ⑧ (new axis, beyond the original 7 — see docs/tech-deep-dive.md; ⑤ there, team-level
  // learning via a committed team file, was removed 2026-11-11 — see HANDOFF.md section T)
  // The mirror of calibration, the other direction: a tier that almost never escalates
  // over many turns may be routed higher than it needs. Unlike calibration this never
  // changes routing by itself (an under-route costs correctness, not just money, so it
  // needs a person to confirm it) — it only ever surfaces as a status line. Much more
  // conservative than calibration's defaults on purpose: a much larger sample, a much
  // lower tolerance, and only 중/상 (where the model/effort jump actually costs money).
  // Reviewed 2026-11-11 when 중's default model changed (opus/medium -> sonnet/high, see
  // HANDOFF.md section S): minTurns/maxEscalationRate are pure escalation-rate statistics,
  // not coupled to which model sits at the tier, so left unchanged. What did change is the
  // real-world payoff of acting on a 중 downgrade advisory — 하->중 is now a smaller cost
  // jump (haiku->sonnet) than it was (haiku->opus), so a team that further lowers 중 after
  // seeing this advisory saves less than before. The mechanism itself is unaffected.
  downgrade: { enabled: false, minTurns: 40, maxEscalationRate: 0.02 },
  classifierMode: 'builtin',
  // H. step 5: assist mode's band calibration — observational only, like downgrade above, and
  // meaningless outside classifierMode 'assist' (nothing else ever records a band; see
  // policy.mjs's decideRoute and store.mjs's addToBandCal). Flags a tier whose 'ambiguous' band
  // is not escalating any more often than its 'certain' band once both have enough turns — a
  // sign the effort bump there may not be earning its cost. Never changes routing by itself.
  bandCalibration: { enabled: false, minTurns: 30 },
  // I. self-consistency fallback (HANDOFF.md section I) — only ever consulted in assist mode,
  // and only on a turn where Jev gave no usable answer (no key, paused, error, timeout; see
  // askJev in hooks/register.ts). `calls` is the total $.model.classify calls for that turn's
  // ambiguity check, including the one already made for routing (so 2 = one extra call).
  selfConsistency: { enabled: false, calls: 2 },
  // P3 (HANDOFF.md section Y): bounded, secret-masked file context for the classifier, built
  // from the same paths the risk floor already extracts (policy.mjs's pathsIn). Off by
  // default like every other axis here — preserves today's routing/classification behavior
  // byte-for-byte until a team opts in. See lib/collector.mjs for the bounds themselves.
  contextCollector: { enabled: false, maxFiles: 6, maxBytes: 12_000, maxTokens: 3_000, timeoutMs: 800 },
  // P0-A (TSR-OPT-001): Fast Preflight — skip $.model.classify for low-risk Sonnet turns.
  // shadowMode=true: classify is still called, preflight decision recorded for comparison.
  // shadowMode=false: classify is actually skipped when preflight says fast_path.
  preflight: { enabled: true, shadowMode: true, maxPaths: 3, recentFailureWindow: 3 },
  routeProfile: 'default',
  routingPolicy: 'r1',
  // Model floor: the lowest model the router may select. Was 'sonnet' (R-008, blocked Haiku
  // downgrade on a conservative guess — that experiment itself saw 100% pass rate, no direct
  // evidence Haiku hurt quality). Changed to 'haiku' 2026-11-15, user decision, on R-023's
  // evidence (20 runs, 4 low-difficulty tasks: modelFloor=haiku passed 100%/100%/100%,
  // reversed R-022's cost REGRESSION 1.274→IMPROVED 0.064 and duration REGRESSION 1.534→OK
  // 1.070 — see benchmark/rounds/R-023/R-023-report.md). This is a single round, 20 samples,
  // not yet repeated for reproducibility (R-020's single-run -1.4% was overturned by R-021's
  // 3-rep re-measurement to +2.9% — the same risk applies here until re-verified). The user
  // was told this limitation and decided to apply it anyway. Set to 'sonnet' in a config file
  // to revert. Set to 'opus' to prevent any downgrade.
  modelFloor: 'haiku',
  debug: false,
  // Status line (실사용 통합 지침서): shows the current turn's selected/actual model+effort
  // via `$.ui.status`. On by default — a team that finds it noisy can turn it off without
  // affecting routing itself (the decision is made the same way either way, only the status
  // line call is skipped).
  statusLine: { enabled: true },
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export const isPlainObject = isObject

// `/tsr-router risk add <label> <minTier>` builds a riskAreas entry this way, so a team never
// has to hand-write a regex. The pattern mirrors DEFAULT_RISK_AREAS's own convention.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const riskAreaFromLabel = (label, minTier) => ({ label, pattern: `(^|/)(${escapeRegex(label)})[^/\\s]*`, minTier })

// Same label replaces (lets a command retune one without duplicating it); a new label adds.
export const upsertRiskArea = (riskAreas, area) => [...(riskAreas ?? []).filter((r) => r?.label !== area.label), area]
export const removeRiskArea = (riskAreas, label) => (riskAreas ?? []).filter((r) => r?.label !== label)

// Returns the merged config and the problems found; a bad field is dropped, never fatal.
export const mergeConfig = (base, file) => {
  const errors = []
  if (file === undefined || file === null) return { config: base, errors }
  if (!isObject(file)) return { config: base, errors: ['설정 파일이 객체가 아닙니다'] }
  const config = structuredClone(base)

  if (file.mode !== undefined) {
    if (MODES.includes(file.mode)) config.mode = file.mode
    else errors.push(`mode는 ${MODES.join('/')} 중 하나여야 합니다`)
  }
  if (file.routes !== undefined) {
    if (!isObject(file.routes)) errors.push('routes가 객체가 아닙니다')
    else
      for (const [tier, route] of Object.entries(file.routes)) {
        if (!TIERS.includes(tier)) { errors.push(`알 수 없는 등급: ${tier}`); continue }
        if (!isObject(route)) { errors.push(`routes.${tier}가 객체가 아닙니다`); continue }
        if (route.model !== undefined) {
          if (MODELS.includes(route.model)) config.routes[tier].model = route.model
          else errors.push(`routes.${tier}.model은 ${MODELS.join('/')} 중 하나여야 합니다`)
        }
        if (route.effort !== undefined) {
          if (EFFORTS.includes(route.effort)) config.routes[tier].effort = route.effort
          else errors.push(`routes.${tier}.effort는 ${EFFORTS.join('/')} 중 하나여야 합니다`)
        }
      }
  }
  if (file.riskAreas !== undefined) {
    if (!Array.isArray(file.riskAreas)) errors.push('riskAreas가 배열이 아닙니다')
    else {
      // Same label as a default replaces it (lets a team retune a built-in area);
      // a new label adds to the list. Nothing here can remove a default outright.
      const byLabel = new Map(config.riskAreas.map((r) => [r.label, r]))
      file.riskAreas.forEach((entry, i) => {
        if (!isObject(entry) || typeof entry.label !== 'string' || !entry.label) {
          errors.push(`riskAreas[${i}]에 문자열 label이 필요합니다`)
          return
        }
        if (typeof entry.pattern !== 'string' || !entry.pattern) {
          errors.push(`riskAreas.${entry.label}.pattern이 없습니다`)
          return
        }
        try {
          // eslint-disable-next-line no-new
          new RegExp(entry.pattern, 'i')
        } catch {
          errors.push(`riskAreas.${entry.label}.pattern이 올바른 정규식이 아닙니다`)
          return
        }
        if (!TIERS.includes(entry.minTier)) {
          errors.push(`riskAreas.${entry.label}.minTier는 ${TIERS.join('/')} 중 하나여야 합니다`)
          return
        }
        // Optional per-area model override (used by the fable ceiling; ignored unless fable.enabled).
        const area = { label: entry.label, pattern: entry.pattern, minTier: entry.minTier }
        if (entry.model !== undefined) {
          if (MODELS.includes(entry.model)) area.model = entry.model
          else { errors.push(`riskAreas.${entry.label}.model은 ${MODELS.join('/')} 중 하나여야 합니다`); return }
        }
        byLabel.set(entry.label, area)
      })
      config.riskAreas = [...byLabel.values()]
    }
  }
  if (file.escalation !== undefined) {
    if (!isObject(file.escalation)) errors.push('escalation이 객체가 아닙니다')
    else {
      if (file.escalation.failsInRow !== undefined) {
        const n = file.escalation.failsInRow
        if (Number.isInteger(n) && n >= 1 && n <= 10) config.escalation.failsInRow = n
        else errors.push('escalation.failsInRow는 1~10 정수여야 합니다')
      }
      if (file.escalation.cascade !== undefined) {
        if (typeof file.escalation.cascade === 'boolean') config.escalation.cascade = file.escalation.cascade
        else errors.push('escalation.cascade는 불리언이어야 합니다')
      }
    }
  }
  if (file.fable !== undefined) {
    if (!isObject(file.fable)) errors.push('fable이 객체가 아닙니다')
    else if (file.fable.enabled !== undefined) {
      if (typeof file.fable.enabled === 'boolean') config.fable.enabled = file.fable.enabled
      else errors.push('fable.enabled는 true/false여야 합니다')
    }
  }
  if (file.observedChecks !== undefined) {
    if (!isObject(file.observedChecks)) errors.push('observedChecks가 객체가 아닙니다')
    else if (file.observedChecks.enabled !== undefined) {
      if (typeof file.observedChecks.enabled === 'boolean') config.observedChecks.enabled = file.observedChecks.enabled
      else errors.push('observedChecks.enabled는 true/false여야 합니다')
    }
  }
  if (file.keepWarmForMicro !== undefined) {
    if (typeof file.keepWarmForMicro === 'boolean') config.keepWarmForMicro = file.keepWarmForMicro
    else errors.push('keepWarmForMicro는 true/false여야 합니다')
  }
  if (file.budget !== undefined) {
    const b = file.budget
    if (!isObject(b)) errors.push('budget이 객체가 아닙니다')
    else {
      if (b.enabled !== undefined) {
        if (typeof b.enabled === 'boolean') config.budget.enabled = b.enabled
        else errors.push('budget.enabled는 true/false여야 합니다')
      }
      if (b.dailyUsd !== undefined) {
        if (typeof b.dailyUsd === 'number' && b.dailyUsd > 0) config.budget.dailyUsd = b.dailyUsd
        else errors.push('budget.dailyUsd는 0보다 큰 숫자여야 합니다')
      }
      for (const key of ['warnPct', 'savePct']) {
        if (b[key] === undefined) continue
        if (typeof b[key] === 'number' && b[key] > 0 && b[key] <= 100) config.budget[key] = b[key]
        else errors.push(`budget.${key}는 1~100 사이 숫자여야 합니다`)
      }
      if (config.budget.warnPct > config.budget.savePct) {
        errors.push('budget.warnPct가 savePct보다 큽니다. 기본값으로 되돌립니다')
        config.budget.warnPct = base.budget.warnPct
        config.budget.savePct = base.budget.savePct
      }
    }
  }
  if (file.calibration !== undefined) {
    if (!isObject(file.calibration)) errors.push('calibration이 객체가 아닙니다')
    else {
      const cal = file.calibration
      if (cal.enabled !== undefined) {
        if (typeof cal.enabled === 'boolean') config.calibration.enabled = cal.enabled
        else errors.push('calibration.enabled는 true/false여야 합니다')
      }
      if (cal.minTurns !== undefined) {
        if (Number.isInteger(cal.minTurns) && cal.minTurns >= 8 && cal.minTurns <= 100_000) config.calibration.minTurns = cal.minTurns
        else errors.push('calibration.minTurns는 8~100000 정수여야 합니다')
      }
      if (cal.escalationRate !== undefined) {
        if (typeof cal.escalationRate === 'number' && cal.escalationRate > 0 && cal.escalationRate <= 1) config.calibration.escalationRate = cal.escalationRate
        else errors.push('calibration.escalationRate는 0보다 크고 1 이하여야 합니다')
      }
    }
  }
  if (file.downgrade !== undefined) {
    if (!isObject(file.downgrade)) errors.push('downgrade가 객체가 아닙니다')
    else {
      const d = file.downgrade
      if (d.enabled !== undefined) {
        if (typeof d.enabled === 'boolean') config.downgrade.enabled = d.enabled
        else errors.push('downgrade.enabled는 true/false여야 합니다')
      }
      if (d.minTurns !== undefined) {
        if (Number.isInteger(d.minTurns) && d.minTurns >= 20 && d.minTurns <= 100_000) config.downgrade.minTurns = d.minTurns
        else errors.push('downgrade.minTurns는 20~100000 정수여야 합니다')
      }
      if (d.maxEscalationRate !== undefined) {
        if (typeof d.maxEscalationRate === 'number' && d.maxEscalationRate >= 0 && d.maxEscalationRate <= 0.2) config.downgrade.maxEscalationRate = d.maxEscalationRate
        else errors.push('downgrade.maxEscalationRate는 0~0.2 사이 숫자여야 합니다')
      }
    }
  }
  if (file.classifierMode !== undefined) {
    if (CLASSIFIER_MODES.includes(file.classifierMode)) config.classifierMode = file.classifierMode
    else errors.push(`classifierMode는 ${CLASSIFIER_MODES.join('/')} 중 하나여야 합니다`)
  }
  if (file.bandCalibration !== undefined) {
    if (!isObject(file.bandCalibration)) errors.push('bandCalibration이 객체가 아닙니다')
    else {
      const bc = file.bandCalibration
      if (bc.enabled !== undefined) {
        if (typeof bc.enabled === 'boolean') config.bandCalibration.enabled = bc.enabled
        else errors.push('bandCalibration.enabled는 true/false여야 합니다')
      }
      if (bc.minTurns !== undefined) {
        if (Number.isInteger(bc.minTurns) && bc.minTurns >= 10 && bc.minTurns <= 100_000) config.bandCalibration.minTurns = bc.minTurns
        else errors.push('bandCalibration.minTurns는 10~100000 정수여야 합니다')
      }
    }
  }
  if (file.selfConsistency !== undefined) {
    if (!isObject(file.selfConsistency)) errors.push('selfConsistency가 객체가 아닙니다')
    else {
      const sc = file.selfConsistency
      if (sc.enabled !== undefined) {
        if (typeof sc.enabled === 'boolean') config.selfConsistency.enabled = sc.enabled
        else errors.push('selfConsistency.enabled는 true/false여야 합니다')
      }
      if (sc.calls !== undefined) {
        if (Number.isInteger(sc.calls) && sc.calls >= 2 && sc.calls <= 5) config.selfConsistency.calls = sc.calls
        else errors.push('selfConsistency.calls는 2~5 정수여야 합니다')
      }
    }
  }
  if (file.contextCollector !== undefined) {
    if (!isObject(file.contextCollector)) errors.push('contextCollector가 객체가 아닙니다')
    else {
      const cc = file.contextCollector
      if (cc.enabled !== undefined) {
        if (typeof cc.enabled === 'boolean') config.contextCollector.enabled = cc.enabled
        else errors.push('contextCollector.enabled는 true/false여야 합니다')
      }
      if (cc.maxFiles !== undefined) {
        if (Number.isInteger(cc.maxFiles) && cc.maxFiles >= 1 && cc.maxFiles <= 50) config.contextCollector.maxFiles = cc.maxFiles
        else errors.push('contextCollector.maxFiles는 1~50 정수여야 합니다')
      }
      if (cc.maxBytes !== undefined) {
        if (Number.isInteger(cc.maxBytes) && cc.maxBytes >= 500 && cc.maxBytes <= 200_000) config.contextCollector.maxBytes = cc.maxBytes
        else errors.push('contextCollector.maxBytes는 500~200000 정수여야 합니다')
      }
      if (cc.maxTokens !== undefined) {
        if (Number.isInteger(cc.maxTokens) && cc.maxTokens >= 100 && cc.maxTokens <= 50_000) config.contextCollector.maxTokens = cc.maxTokens
        else errors.push('contextCollector.maxTokens는 100~50000 정수여야 합니다')
      }
      if (cc.timeoutMs !== undefined) {
        if (Number.isInteger(cc.timeoutMs) && cc.timeoutMs >= 100 && cc.timeoutMs <= 10_000) config.contextCollector.timeoutMs = cc.timeoutMs
        else errors.push('contextCollector.timeoutMs는 100~10000 정수여야 합니다')
      }
    }
  }
  if (file.preflight !== undefined) {
    if (!isObject(file.preflight)) errors.push('preflight가 객체가 아닙니다')
    else {
      const pf = file.preflight
      if (pf.enabled !== undefined) {
        if (typeof pf.enabled === 'boolean') config.preflight.enabled = pf.enabled
        else errors.push('preflight.enabled는 true/false여야 합니다')
      }
      if (pf.shadowMode !== undefined) {
        if (typeof pf.shadowMode === 'boolean') config.preflight.shadowMode = pf.shadowMode
        else errors.push('preflight.shadowMode는 true/false여야 합니다')
      }
      if (pf.maxPaths !== undefined) {
        if (Number.isInteger(pf.maxPaths) && pf.maxPaths >= 1 && pf.maxPaths <= 20) config.preflight.maxPaths = pf.maxPaths
        else errors.push('preflight.maxPaths는 1~20 정수여야 합니다')
      }
      if (pf.recentFailureWindow !== undefined) {
        if (Number.isInteger(pf.recentFailureWindow) && pf.recentFailureWindow >= 1 && pf.recentFailureWindow <= 20) config.preflight.recentFailureWindow = pf.recentFailureWindow
        else errors.push('preflight.recentFailureWindow는 1~20 정수여야 합니다')
      }
    }
  }
  if (file.statusLine !== undefined) {
    if (!isObject(file.statusLine)) errors.push('statusLine이 객체가 아닙니다')
    else {
      const sl = file.statusLine
      if (sl.enabled !== undefined) {
        if (typeof sl.enabled === 'boolean') config.statusLine.enabled = sl.enabled
        else errors.push('statusLine.enabled는 true/false여야 합니다')
      }
    }
  }
  if (file.routeProfile !== undefined) {
    if (ROUTE_PROFILE_NAMES.includes(file.routeProfile)) config.routeProfile = file.routeProfile
    else errors.push(`routeProfile은 ${ROUTE_PROFILE_NAMES.join('/')} 중 하나여야 합니다`)
  }
  if (file.routingPolicy !== undefined) {
    if (ROUTING_POLICIES.includes(file.routingPolicy)) config.routingPolicy = file.routingPolicy
    else errors.push(`routingPolicy는 ${ROUTING_POLICIES.join('/')} 중 하나여야 합니다`)
  }
  if (file.modelFloor !== undefined) {
    if (MODELS.includes(file.modelFloor)) config.modelFloor = file.modelFloor
    else errors.push(`modelFloor는 ${MODELS.join('/')} 중 하나여야 합니다`)
  }
  if (file.debug !== undefined) {
    if (typeof file.debug === 'boolean') config.debug = file.debug
    else errors.push('debug은 true/false여야 합니다')
  }
  return { config, errors }
}

// In auto mode the routes come from the selected profile, not from user overrides.
// 'manual' mode lets the user override individual tier routes in their config file.
export const resolveProfileRoutes = (profileName) => structuredClone(ROUTE_PROFILES[profileName] ?? ROUTE_PROFILES.default)

// Translates the plugin's native `userConfig` options (flat scalars only — PluginOptions is
// `Record<string, string | number | boolean | readonly string[]>`, no nested objects) into the
// nested shape mergeConfig expects. Only the 5 fields plugin.json's userConfig declares; routes
// and riskAreas stay file-only (nested structures userConfig can't express) — see
// mod/HANDOFF.md's userConfig section for why those two specifically were left out.
export const configFromUserOptions = (options) => {
  const file = {}
  if (!options) return file
  if (options.mode !== undefined) file.mode = options.mode
  if (options.statusLineEnabled !== undefined) file.statusLine = { enabled: options.statusLineEnabled }
  if (options.calibrationEnabled !== undefined) file.calibration = { enabled: options.calibrationEnabled }
  if (options.budgetEnabled !== undefined || options.budgetDailyUsd !== undefined) {
    file.budget = {}
    if (options.budgetEnabled !== undefined) file.budget.enabled = options.budgetEnabled
    if (options.budgetDailyUsd !== undefined) file.budget.dailyUsd = options.budgetDailyUsd
  }
  return file
}

// Priority (lowest to highest): DEFAULTS < userConfig (/config, casual users) < profile file
// (~/.claude/tube-slide-router.json) < project file (<project>/.claude/tube-slide-router.json).
// A team's committed project file always wins over an individual's /config picks, and an
// individual's own profile file wins over the plugin's shipped defaults — the same "more
// specific wins" rule the rest of this config system already follows (routes/riskAreas).
export const effectiveConfig = (profileFile, projectFile, userOptions) => {
  const userConfig = mergeConfig(DEFAULTS, configFromUserOptions(userOptions))
  const profile = mergeConfig(userConfig.config, profileFile)
  const project = mergeConfig(profile.config, projectFile)
  const config = project.config
  if (config.mode === 'auto') config.routes = resolveProfileRoutes(config.routeProfile)
  // fable opt-in 게이트: modelFloor:'fable'은 fable.enabled일 때만 유효하다. MODELS에 'fable'이
  // 들어가면서 clampModelFloor가 floor='fable'을 매 턴 강제 clamp하므로, 게이트가 꺼져 있어도
  // (기본값) 모든 턴이 fable로 올라가 "기본 OFF = 거동 변화 0"가 깨진다. 게이트가 꺼져 있으면
  // 측정된 최강 모델인 opus로 낮춰 사용자의 '높은 바닥' 의도는 존중하되 미측정 fable 강제는 막는다.
  const floorGated = config.modelFloor === 'fable' && !config.fable?.enabled
  if (floorGated) config.modelFloor = 'opus'
  return {
    config,
    errors: [
      ...userConfig.errors.map((e) => `/config: ${e}`),
      ...profile.errors.map((e) => `프로필: ${e}`),
      ...project.errors.map((e) => `프로젝트: ${e}`),
      ...(floorGated ? ['modelFloor:"fable"는 fable.enabled가 켜져 있어야 적용됩니다 — opus로 대체했습니다'] : []),
    ],
  }
}

export const configPaths = ({ configDir, root }) => ({
  profile: `${configDir}/tube-slide-router.json`,
  project: `${root}/.claude/tube-slide-router.json`,
})

export const parseJson = (text) => {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return { error: 'JSON 형식이 아닙니다' }
  }
}
