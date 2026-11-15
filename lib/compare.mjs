// Pure: /tsr-router compare's invocation building, response parsing and report text. No `$`,
// no node builtins — register.ts does the actual $.process.run/git worktree calls and passes
// their results in here. See benchmark/compare-mode-DESIGN.md for the design this implements
// (Phase 1: command-argument prompt, sequential execution, 2 arms, text report only).

// Default baseline arm: Sonnet fixed + effort forced high — the same A3 definition this project's
// benchmarks already use (mod/HANDOFF.md J절 §2, experiments/quality/catalog/v1.json's "A3"), so
// a compare-mode run reads consistently against the rest of this project's measurements.
export const DEFAULT_COMPARE_BASELINE = { model: 'claude-sonnet-5-5', effort: 'high' }

const COMMON_CLAUDE_FLAGS = Object.freeze(['--output-format', 'json', '--permission-mode', 'acceptEdits'])

// The two arms' exact argv. `pluginRoot` is $.plugin.root (this plugin's own directory, absolute)
// — the router arm loads this exact plugin so it is really TSR deciding, not a guess. Neither arm
// passes --session-id: each runs in its own throwaway git worktree, so a collision is impossible.
export const buildCompareArgs = ({ prompt, pluginRoot, baselineModel = DEFAULT_COMPARE_BASELINE.model, baselineEffort = DEFAULT_COMPARE_BASELINE.effort }) => ({
  baseline: { bin: 'claude', args: ['-p', prompt, '--model', baselineModel, '--effort', baselineEffort, ...COMMON_CLAUDE_FLAGS] },
  router: { bin: 'claude', args: ['-p', prompt, '--plugin-dir', pluginRoot, ...COMMON_CLAUDE_FLAGS] },
})

// Reads `claude -p --output-format json`'s parsed stdout — same fields/fallbacks as
// experiments/quality/catalog/canary/run-canary.mjs's extractResponseFields, reimplemented here
// (not imported) since mod/ is meant to stand alone, independent of the benchmark harness.
export const extractCompareFields = (parsed) => {
  const modelUsageKeys = parsed?.modelUsage && typeof parsed.modelUsage === 'object' ? Object.keys(parsed.modelUsage) : []
  const modelFromUsage = modelUsageKeys.length === 1 ? modelUsageKeys[0] : null
  return {
    servedModel: parsed?.model ?? parsed?.message?.model ?? modelFromUsage ?? null,
    servedEffort: parsed?.effort ?? parsed?.message?.effort ?? null,
    costUsd: parsed?.total_cost_usd ?? null,
    durationMs: parsed?.duration_ms ?? null,
  }
}

// One arm's outcome as the caller (register.ts) assembles it: either a parsed result or an error
// string — never both, and never silently dropped (an arm that crashed is reported, not hidden).
export const armOutcome = ({ fields = null, error = null, dir }) => ({ fields, error, dir })

const usd = (n) => (n === null || n === undefined ? '측정 안 됨' : `$${n.toFixed(4)}`)
const secs = (ms) => (ms === null || ms === undefined ? '측정 안 됨' : `${(ms / 1000).toFixed(1)}초`)

const armLine = (label, outcome) => {
  if (outcome.error) return `- ${label}: 실행 실패 — ${outcome.error} (작업공간: ${outcome.dir})`
  const { servedModel, servedEffort, costUsd, durationMs } = outcome.fields
  return `- ${label}: ${servedModel ?? '알 수 없음'}${servedEffort ? `/${servedEffort}` : ''}, 비용 ${usd(costUsd)}, 소요시간 ${secs(durationMs)} (작업공간: ${outcome.dir})`
}

// The whole text report `/tsr-router compare`'s command answers with. Never reports a pass/fail
// quality verdict — there is no check oracle for an arbitrary real prompt (AGENTS.md: never
// present an invented number as if it were measured), so quality is left to the user's own
// inspection of each arm's worktree, named explicitly so they know where to look.
export const compareReportText = ({ prompt, baseline, router }) => {
  const lines = [
    `비교 완료: "${prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt}"`,
    '',
    armLine('고정 모델(기준선)', baseline),
    armLine('TSR 라우팅', router),
    '',
    '결과물이 실제로 맞게 동작하는지는 자동으로 판정하지 않습니다 — 위 두 작업공간을 직접 열어',
    '비교해보세요. 두 워크트리 모두 지우지 않았으니 수동으로 정리해야 합니다',
    '(`git worktree remove <경로>` 또는 `git worktree remove --force <경로>`).',
  ]
  if (!baseline.error && !router.error && baseline.fields.costUsd != null && router.fields.costUsd != null) {
    const ratio = baseline.fields.costUsd > 0 ? router.fields.costUsd / baseline.fields.costUsd : null
    if (ratio !== null) lines.push('', `비용비(TSR/고정): ${ratio.toFixed(3)}`)
  }
  return lines.join('\n')
}
