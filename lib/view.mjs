// Pure: the text the /tsr-router command and the pane show. No `$`.
import { EFFORTS, MODELS, TIER_HINTS, TIERS } from './config.mjs'

export const LOGO = [
  '  _                    _   _                 _ _      ',
  ' | |    __ _ _____   _| | | | ___   ___   __| (_) ___ ',
  " | |   / _` |_  / | | | |_| |/ _ \\ / _ \\ / _` | |/ _ \\",
  ' | |__| (_| |/ /| |_| |  _  | (_) | (_) | (_| | |  __/',
  ' |_____\\__,_/___|\\__, |_| |_|\\___/ \\___/ \\__,_|_|\\___|',
  '                 |___/          R O U T E R           ',
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
// one — this is what tells a user "classified as 하, but modelFloor pushed Selected up to
// sonnet", the exact confusion that prompted this field. It shows "이전→승급" only on an actual
// escalation this step (`escalatedFrom` differs from `tier`); otherwise just the plain tier. No
// `tier` at all (pin/off — no classification happened) omits the segment entirely, same as
// before. `actualModel` is the served model once `next()` resolves — effort itself is never
// independently observable (see HANDOFF.md's effortVerification notes), so only the model is
// ever shown as "Actual", never a guessed effort.
export const statusLineText = ({ config, settings, model, effort, actualModel = null, escalatedFrom = null, tier = null }) => {
  const mode = statusLineModeLabel(settings, config.mode)
  const tierValue = tier ? (escalatedFrom && escalatedFrom !== tier ? `${escalatedFrom}→${tier}` : tier) : null
  const tierPart = tierValue ? `Tier: ${tierValue} | ` : ''
  const actual = actualModel ? ` | Actual: ${actualModel}` : ''
  return `TSR ${mode} | ${tierPart}Selected: ${model}/${effort}${actual}`
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
  lines.push(`모드: ${config.mode === 'auto' ? '자동 (기본 등급표)' : '수동 (설정 파일의 등급표)'}  ·  설정: ${configSource}`)
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
  '/tsr-router setup      온보딩 설정 다시 하기',
  '/tsr-router reset      이 기기에 쌓인 턴·사용량·보정·Jev 기록 전부 지우기 (확인 필요)',
  '/tsr-router risk       위험 영역 목록 보기',
  '/tsr-router risk add <폴더이름> <등급>     위험 영역을 프로젝트 설정 파일에 추가 (즉시 적용)',
  '/tsr-router risk remove <폴더이름>        프로젝트 설정 파일에서 위험 영역 제거',
].join('\n')
