// Telemetry: records routing decisions to a JSONL file at decision time.
// This bridges $.store (opaque) and the benchmark runner (reads files).
// Each line is one routing decision with all fields the architecture spec requires.
//
// Uses $.fs (Mod API) for file writes. The caller (hooks/register.ts) passes
// the $ context; this module never imports or stores it.

export const telemetryPath = (root) => `${root}/.claude/tsr-telemetry.jsonl`

export const buildTelemetryRecord = ({
  taskId,
  runId,
  turnId,
  stepIndex,
  policyVersion,
  routingPolicy,
  difficultyScore,
  tier,
  profile,
  confidence,
  rationale,
  source,
  classifyLabel,
  llmEvaluated,
  selectedModel,
  selectedEffort,
  actualModel,
  actualEffort,
  escalatedFrom,
  escalatedAtStreak,
  shadow,
  timestamp,
  // P0-A (TSR-OPT-001): Fast Preflight fields
  preflightDecision,
  decisionSource,
  preflightElapsedMs,
  classificationCallSkipped,
  fallbackReason,
  // P0-B (TSR-OPT-001): Selective Context Collection fields
  contextStrategy,
  contextFiles,
  contextBytesOrTokens,
  cacheValidity,
  contextCollectionElapsedMs,
}) => ({
  taskId: taskId || null,
  runId: runId || null,
  turnId: turnId || null,
  stepIndex: stepIndex ?? null,
  policyVersion: policyVersion || 1,
  routingPolicy: routingPolicy || 'r1',
  difficultyScore: difficultyScore ?? null,
  tier: tier || null,
  profile: profile || null,
  confidence: confidence ?? null,
  rationale: rationale || [],
  source: source || 'heuristic',
  classifyLabel: classifyLabel || null,
  llmEvaluated: llmEvaluated ?? false,
  selectedModel: selectedModel || null,
  selectedEffort: selectedEffort || null,
  actualModel: actualModel || null,
  actualEffort: actualEffort || null,
  escalatedFrom: escalatedFrom || null,
  escalatedAtStreak: escalatedAtStreak ?? null,
  shadow: shadow || null,
  preflightDecision: preflightDecision || null,
  decisionSource: decisionSource || null,
  preflightElapsedMs: preflightElapsedMs ?? null,
  classificationCallSkipped: classificationCallSkipped ?? false,
  fallbackReason: fallbackReason || null,
  contextStrategy: contextStrategy || null,
  contextFiles: contextFiles ?? null,
  contextBytesOrTokens: contextBytesOrTokens ?? null,
  cacheValidity: cacheValidity || null,
  contextCollectionElapsedMs: contextCollectionElapsedMs ?? null,
  ts: timestamp || new Date().toISOString(),
})

export const formatTelemetryLine = (record) => JSON.stringify(record)

// Append one decision record. Caller provides the $ context's fs for writing.
export const appendTelemetry = async (fs, root, record) => {
  const path = telemetryPath(root)
  let prev = ''
  try { prev = await fs.read(path) } catch {}
  const line = formatTelemetryLine(record) + '\n'
  await fs.write(path, prev + line)
}

// Read all telemetry records (for analysis or export).
export const readTelemetry = async (fs, root) => {
  const path = telemetryPath(root)
  try {
    const text = await fs.read(path)
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
