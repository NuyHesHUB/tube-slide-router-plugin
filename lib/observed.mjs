// Pure: what a finished turn did, and the difficulty its tool use implies.
// No `$` here; the hooks module feeds it and stores the record it returns.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const TEST_LIKE = /\b(test|pytest|jest|vitest|mocha|tsc|lint|eslint|build)\b/i
// These failures say the host refused the tool, not that the code check failed.
// They must not teach the router to spend more on the next step.
const ENVIRONMENT_FAILURE = /requires? (?:an? )?(?:approval|permission)|(?:permission|approval|sandbox|policy|network access).{0,40}(?:denied|refused|required|not granted|blocked)|(?:denied|refused|required|not granted|blocked).{0,40}(?:permission|approval|sandbox|policy|network access)/i
const MAX_FILES = 50
// Reads at or above this, with no edit, mean the turn was an investigation (rule v2).
const INVESTIGATION_READS = 3

export const emptyTally = () => ({ files: [], lines: 0, bash: 0, tests: 0, testPasses: 0, testFails: 0, failStreak: 0, editedSinceFail: false, reads: 0, tools: 0 })

// Lines an edit or write changed: the larger of what it removed and what it put in.
export const changedLinesOf = (call) => {
  const count = (text) => (typeof text === 'string' ? text.split('\n').length : 0)
  if (EDIT_TOOLS.has(call.tool)) return Math.max(count(call.old_string), count(call.new_string), count(call.content))
  return 0
}

// Did a tool call fail as a code check? A failed Bash run comes back with isError set and its
// output as a string (the whole result, or "Error: Exit code 1 …" in result and text); a finished
// run may instead carry an object with stdout, stderr and interrupted. Output counts from either
// form. A call with no output at all is not evidence about the code. A host refusal (permission,
// approval, sandbox) names its reason and ran nothing, so it does not count either.
//
// Deliberately no exitCode/exit_code check: this build's Bash result type
// (.claude-plugin/types/claude-code-tools/index.d.ts) has no such field — only an
// unrelated tool (AppifactRepl) does — and a real failing run was observed to set
// isError: true with the failure text in `message`/`result`
// (session 569c9ce4-c88b-4715-b67d-531fc98bef89, 2026-11-09). If a future engine
// build adds an exit code to Bash's result, extend this function then, backed by
// a fresh real-run observation, not by assumption.
export const checkOutcome = (answer) => {
  const raw = answer?.result
  const fields = typeof raw === 'string' ? { text: raw } : raw ?? {}
  const texts = [raw, fields.stdout, fields.stderr, answer?.text, answer?.message, answer?.error]
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
  const interrupted = fields.interrupted === true
  if (!texts.length && !interrupted) return 'none'
  const ranWithOutput = typeof fields.stdout === 'string' && fields.stdout.trim() !== ''
  if (!ranWithOutput && !interrupted && ENVIRONMENT_FAILURE.test(texts.join('\n'))) return 'none'
  return interrupted || answer?.isError === true ? 'failed' : 'passed'
}

export const routableCheckFailure = (answer) => checkOutcome(answer) === 'failed'

// `outcome` is what the tool answered with: `{ failed }` for a shell command.
// A test-like command passes when it neither failed nor was cut short.
// A failure adds to the streak only when an edit came between it and the last failure:
// the model tried a fix and the check still failed. Re-running or rewording a command
// without an edit (a wrong command, a flaky check) keeps the streak where it was.
export const addToolCall = (tally, call, outcome = {}) => {
  const next = { ...tally, tools: tally.tools + 1, lines: tally.lines + (call.changedLines ?? 0) }
  if (EDIT_TOOLS.has(call.tool) && typeof call.file_path === 'string') {
    next.editedSinceFail = true
    if (!next.files.includes(call.file_path) && next.files.length < MAX_FILES) {
      next.files = [...next.files, call.file_path]
    }
  }
  if (READ_TOOLS.has(call.tool)) next.reads += 1
  if (call.tool === 'Bash' && typeof call.command === 'string') {
    next.bash += 1
    if (TEST_LIKE.test(call.command)) {
      next.tests += 1
      if (outcome.ran === false) {
        // Not run (refused by the host): neither a pass nor a fail.
      } else if (outcome.failed) {
        next.testFails += 1
        if (next.failStreak === 0 || next.editedSinceFail) next.failStreak += 1
        next.editedSinceFail = false
      } else {
        next.testPasses += 1
        next.failStreak = 0
        next.editedSinceFail = false
      }
    }
  }
  return next
}

// Rule v3: follows the classifier's criteria. Files touched set the tier; a test run
// alone does not raise it. Returns null when no tool ran, so a pure answer is not counted.
export const observedTier = (tally, { aborted }) => {
  if (aborted || tally.tools === 0) return null
  const files = tally.files.length
  if (files >= 3) return '상'
  if (files === 2) return '중'
  if (files === 1) return '하'
  return tally.reads >= INVESTIGATION_READS ? '중' : '하'
}

export const turnRecord = ({ turnId, route, tally, complete, startedAt }) => ({
  version: 1,
  turnId,
  at: startedAt,
  predicted: route?.escalatedFrom ?? route?.tier ?? null,
  final: route?.tier ?? null,
  escalated: route?.escalatedFrom !== undefined,
  model: route?.model ?? null,
  effort: route?.effort ?? null,
  classifier: route?.classifier ?? null,
  band: route?.band ?? null,
  servedModel: complete.usage?.model ?? null,
  inputTokens: complete.usage?.input_tokens ?? null,
  outputTokens: complete.usage?.output_tokens ?? null,
  cacheReadTokens: complete.usage?.cache_read_input_tokens ?? null,
  cacheWriteTokens: complete.usage?.cache_creation_input_tokens ?? null,
  durationMs: complete.durationMs,
  aborted: complete.isAborted,
  files: tally.files.length,
  bash: tally.bash,
  tests: tally.tests,
  testPasses: tally.testPasses,
  testFails: tally.testFails,
  reads: tally.reads,
  tools: tally.tools,
  lines: tally.lines,
  failStreak: tally.failStreak,
  observed: observedTier(tally, { aborted: complete.isAborted }),
})

// One model request inside a turn: the cache read and write of that request alone.
export const stepRecord = ({ turnId, index, requested, usage, at }) => ({
  version: 1,
  turnId,
  at,
  index,
  requested,
  served: usage?.model ?? null,
  inputTokens: usage?.input_tokens ?? null,
  outputTokens: usage?.output_tokens ?? null,
  cacheReadTokens: usage?.cache_read_input_tokens ?? null,
  cacheWriteTokens: usage?.cache_creation_input_tokens ?? null,
})

export const STEP_CAP = 1000

export const RECORD_CAP = 300
export const appendRecord = (records, record) => [...records, record].slice(-RECORD_CAP)
