// Pure: the text the /tsr-router command and the pane show. No `$`.
import { EFFORTS, MODELS, TIER_HINTS, TIERS } from './config.mjs'

// TSR 워드마크(mod/logo/tsr-wordmark.txt와 동일 — 3D 렌더는 mod/logo/, 터미널 배너·패널에는
// 이 평문 figlet만 쓴다). 2026-11-15 전체 리브랜딩 때 누락됐던 구 "LazyHoodieRouter" 로고를
// 여기서 교체.
export const LOGO = [
  ' _______    _             _____ _ _     _        _____             _            ',
  '|__   __|  | |           / ____| (_)   | |      |  __ \\           | |           ',
  '   | |_   _| |__   ___  | (___ | |_  __| | ___  | |__) |___  _   _| |_ ___ _ __ ',
  "   | | | | | '_ \\ / _ \\  \\___ \\| | |/ _` |/ _ \\ |  _  // _ \\| | | | __/ _ \\ '__|",
  '   | | |_| | |_) |  __/  ____) | | | (_| |  __/ | | \\ \\ (_) | |_| | ||  __/ |   ',
  '   |_|\\__,_|_.__/ \\___| |_____/|_|_|\\__,_|\\___| |_|  \\_\\___/ \\__,_|\\__\\___|_|',
].join('\n')

export const TAGLINE = '작업 난이도에 맞춰 모델·effort를 자동으로 바꿉니다'

export const routeLine = (routes) => TIERS.map((t) => `${t}=${routes[t].model}(${routes[t].effort})`).join('  ')

export const tierHint = (tier) => TIER_HINTS[tier]

// Terminal status line text (실사용 통합 지침서) — one short line, never the full /tsr-router
// status report (statusText below). `mode` is config.mode ('auto'/'manual'); pin/off/hungry
// (whichever is active) take priority over it since they're the stronger, explicit override —
// pin beats off beats hungry beats the route table, the same "explicit user intent wins" rule
// as everywhere else in this router (see decideRoute's gate ordering in lib/policy.mjs).
export const statusLineModeLabel = (settings, mode) =>
  settings?.pin ? 'PINNED' : settings?.off ? 'OFF' : settings?.hungry ? 'HUNGRY' : String(mode).toUpperCase()

// `tier` shows the classified difficulty (극소/하/중/상/최상) whenever a routing decision made
// one — this is what tells a user "classified as 하, but modelFloor pushed Routed up to
// sonnet", the exact confusion that prompted this field. It shows "이전→승급" only on an actual
// escalation this step (`escalatedFrom` differs from `tier`); otherwise just the plain tier. No
// `tier` at all (pin/off — no classification happened) omits the segment entirely, same as
// before. "Routed" (not "Selected" — 2026-11-15 rename, user feedback: "Selected" read as if the
// person chose it, when it is TSR's own routing decision) is what TSR asked for; `actualModel` is
// the served model once `next()` resolves, confirmed from `result.usage.model` — but
// `result.usage` (claude-code's `TurnUsage`/`ModelUsage` types) carries no effort field at all,
// re-verified 2026-11-15, so the serving effort is still never independently observable (see
// HANDOFF.md's effortVerification notes). "Actual" therefore always pairs the confirmed model
// with the originally *requested* effort, marked `(요청값)` ("requested value") so it is never
// mistaken for a confirmed one — never a bare, unlabeled guess.
// `status` (2026-11-16, TSR 메인 대화 model·effort 미적용 문제 수정 지침, §6/§7): an explicit
// word for what this call site already distinguished structurally (actualModel present or
// not) — 대기(next()를 아직 안 불렀거나 응답을 못 받음, 이 statusLineText 호출로는 절대 안
// 생김: 호출하는 쪽이 응답 전엔 actualModel을 안 넘김) / 확인됨(actualModel 있음) /
// 확인불가(모델은 왔지만 effort는 응답에 없어 영원히 확인 불가 — TurnUsage에 effort 필드
// 자체가 없음, requestCostUsd 쪽 재확인 2026-11-16) — effort는 그래서 항상 확인불가 쪽이고,
// model만 confirmed/대기로 갈린다. 실패(라우팅 자체가 실패 경로로 간 턴)는 이 함수가 아니라
// classifierFailureFallback 쪽 reasonLabel로 이미 표시되므로 여기서 새로 만들지 않는다.
export const statusLineText = ({ config, settings, model, effort, actualModel = null, escalatedFrom = null, tier = null }) => {
  const mode = statusLineModeLabel(settings, config.mode)
  const tierValue = tier ? (escalatedFrom && escalatedFrom !== tier ? `${escalatedFrom}→${tier}` : tier) : null
  const tierPart = tierValue ? `Tier: ${tierValue} | ` : ''
  // model 확인 상태만 말한다 — effort는 응답에 없어서(TurnUsage에 필드 자체가 없음) 항상
  // "확인불가"이므로 상태 단어를 둘 다에 걸쳐 말하면 거짓으로 "확인됨"을 암시하게 된다.
  const actual = actualModel ? ` | 적용: ${actualModel}` : ''
  return `TSR ${mode} · 활성 | ${tierPart}Routed: ${model}/${effort}${actual}`
}

const usd = (n) => (n === null || n === undefined ? '-' : `$${n.toFixed(n < 1 ? 3 : 2)}`)

// `turns` are this session's turn records, newest last. `jevSummary` (from
// lib/jev.mjs summarizeJevComparisons) is shown in both 'shadow' and 'assist' classifierMode.
// `downgradeNotes`/`bandNotes` (lib/policy.mjs downgradeAdvisories/bandAdvisories) are only
// ever advisory — see config.mjs downgrade/bandCalibration. `usage` (lib/usage.mjs's
// `latestUsage`, HANDOFF.md section M) is this session's most recent `session.measure` snapshot,
// or null before the first one arrives (or ever, off a subscription account — `rateLimits` is
// then always empty, which is itself the finding, not a bug).
export const statusText = ({ config, settings, spentTodayUsd, turns, errors, configSource, classifierHealth, jevSummary, downgradeNotes = [], bandNotes = [], usage = null }) => {
  const lines = []
  const state = settings.pin
    ? `${settings.pin.model}/${settings.pin.effort}로 고정 (off/hungry보다 우선, /tsr-router unpin으로 해제)`
    : settings.off ? '꺼짐' : settings.hungry ? '켜짐 (hungry 모드: 모든 턴 최상)' : '켜짐'
  lines.push(`라우팅: ${state}`)
  lines.push(`모드: ${config.mode === 'auto' ? '자동 (AUTO, 기본 등급표)' : '수동 (설정 파일의 등급표)'}${settings.pin ? ' · FIXED(고정) 활성' : ''}  ·  설정: ${configSource}`)
  // 2026-11-16, TSR 메인 대화 model·effort 미적용 문제 수정 지침 §6: Claude Code 하단 기본
  // 표시줄(`/model`, `/effort`로 바꾸는 값)은 세션의 기본값만 보여주고, 이 플러그인이
  // turn.step에서 매 요청마다 바꾸는 값은 반영해 다시 그리지 않는다 — 실제 플러그인 저장소
  // 기록(requested/served 943건 전수 대조, 2026-11-16)으로는 두 값이 다른데도 하단 표시줄은
  // 안 바뀌는 게 정상 동작임을 확인했다. 매번 묻지 않도록 패널에 한 줄로 안내.
  // "참고:"는 이미 downgrade/bandCalibration 조언 줄이 쓰고 있어서(바로 아래 로직) 겹치지
  // 않게 "안내:"로 구분.
  lines.push('안내: 화면 하단 기본 모델/effort 표시는 세션 기본값이며, 실제 요청별 적용값과 다를 수 있음 — 아래 "등급표"/Actual이 실제 적용 근거.')
  lines.push(`등급표: ${routeLine(config.routes)}`)
  const pause = classifierHealth?.pausedUntil
  lines.push(pause && pause > Date.now() ? '판정기: 내장 판별기 일시 중단(반복 실패 후 안전 통과)' : '판정기: 내장 판별기 정상')
  if (config.classifierMode === 'shadow' || config.classifierMode === 'assist') {
    const mode = config.classifierMode
    const s = jevSummary ?? { compared: 0, answered: 0, agreed: 0, errors: 0 }
    const note = mode === 'shadow' ? '라우팅에는 쓰이지 않음' : '일치하지 않거나 Jev가 불확실하면 같은 등급 안에서 effort만 한 단계 올림'
    lines.push(
      s.compared === 0
        ? `Jev ${mode}: 아직 비교된 턴이 없습니다 (${note})`
        : `Jev ${mode}: ${s.compared}턴 비교 · 응답 ${s.answered} · 일치 ${s.agreed} · 오류 ${s.errors} (${note})`,
    )
  }
  const b = config.budget
  lines.push(
    b.enabled
      ? `예산 가드: 하루 ${usd(b.dailyUsd)}, 오늘 사용 ${usd(spentTodayUsd)} (${Math.round((100 * (spentTodayUsd ?? 0)) / b.dailyUsd)}%) · ${b.warnPct}%부터 상 이상 제한, ${b.savePct}%부터 하 이하`
      : `예산 가드: 꺼짐 · 오늘 사용 ${usd(spentTodayUsd)} (이 기기 기록 기준)`,
  )
  if (usage) {
    const rl = usage.rateLimits.length ? usage.rateLimits.map((r) => `${r.kind} ${r.percentUsed}%`).join(', ') : '없음(API 계정이거나 구독 좌석이 아님)'
    const engineCost = usage.costUsd !== null ? ` · 엔진 자체 비용 원장(이 세션) ${usd(usage.costUsd)}` : ''
    lines.push(`구독 사용량(M절, 엔진 기준): ${rl}${engineCost}`)
  }
  const routed = turns.filter((t) => t.predicted)
  if (routed.length) {
    const count = (f) => routed.filter(f).length
    lines.push(
      `이 세션: ${routed.length}턴 · ` +
        TIERS.map((t) => `${t} ${count((r) => r.predicted === t)}`).join(' / ') +
        ` · 중간 승급 ${count((r) => r.escalated)}`,
    )
  } else lines.push('이 세션: 아직 라우팅한 턴이 없습니다')
  for (const n of downgradeNotes) {
    lines.push(`참고: ${n.tier} 등급이 ${n.turns}턴 동안 ${n.escalated}번만 승급됐습니다 — 기본 등급표보다 낮춰도 될 수 있습니다(자동 적용 아님, 직접 검토 필요)`)
  }
  for (const n of bandNotes) {
    lines.push(`참고: ${n.tier} 등급에서 Jev가 애매하다고 본 턴(${n.ambTurns}개)이 그렇지 않은 턴보다 더 자주 승급되지 않았습니다 — effort를 올려도 효과가 없을 수 있습니다(자동 적용 아님, 직접 검토 필요)`)
  }
  if (errors.length) lines.push(`설정 파일 문제: ${errors.join('; ')}`)
  return lines.join('\n')
}

export const riskAreasText = (riskAreas) => {
  if (!riskAreas.length) return '등록된 위험 영역이 없습니다.'
  return ['위험 영역(건드리면 최소 이 등급으로 고정됩니다):', ...riskAreas.map((a) => `  - ${a.label}: ${a.pattern}  →  최소 ${a.minTier}`)].join('\n')
}

export const HELP = [
  '/tsr-router            패널 열기 (설정과 상태)',
  '/tsr-router status     상태를 글로 보기',
  '/tsr-router reload     설정 파일을 다시 읽기',
  '/tsr-router off | on   이 세션의 라우팅 끄기 / 켜기',
  '/tsr-router hungry     이 세션은 예산과 상관없이 모든 턴을 최상으로 (가칭)',
  '/tsr-router normal     hungry 모드 해제',
  `/tsr-router pin <모델> <effort>   이 세션만 해당 모델/effort로 즉석 고정 (설정 파일은 안 건드림, 모델: ${MODELS.join('|')}, effort: ${EFFORTS.join('|')})`,
  '/tsr-router unpin      고정 해제, 원래(auto/manual) 라우팅으로 복귀',
  '/tsr-router setup      온보딩 설정 다시 하기 (세부 패널)',
  '/tsr-router quicksetup 짧은 질문 3개로 floor/등급표 프리셋만 빠르게 다시 고르기',
  '/tsr-router reset      이 기기에 쌓인 턴·사용량·보정·Jev 기록 전부 지우기 (확인 필요)',
  '/tsr-router risk       위험 영역 목록 보기',
  '/tsr-router risk add <폴더이름> <등급>     위험 영역을 프로젝트 설정 파일에 추가 (즉시 적용)',
  '/tsr-router risk remove <폴더이름>        프로젝트 설정 파일에서 위험 영역 제거',
  '/tsr-router compare <프롬프트>   같은 작업을 고정 모델/TSR 라우팅 둘 다로 실행해 비용·소요시간 비교 (1단계: git 저장소 전용, 실제 과금 발생, 설계: benchmark/compare-mode-DESIGN.md)',
].join('\n')
