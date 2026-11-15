// Quality verification for benchmark runs.
// Extends the binary checkPassed with structured pass/fail for each dimension.
// Pure: takes check results as input, no side effects.

export const QUALITY_DIMENSIONS = ['requirements', 'build', 'test', 'regression', 'security']

export const buildQualityResult = ({
  requirements = null,
  build = null,
  test = null,
  regression = null,
  security = null,
} = {}) => ({
  requirements,
  build,
  test,
  regression,
  security,
  overallPass: [requirements, build, test, regression, security].filter((v) => v !== null).every((v) => v === true),
  checkedDimensions: [requirements, build, test, regression, security].filter((v) => v !== null).length,
})

// Parse structured check results from a task's check command output.
// The check command can output JSON with dimension results.
export const parseCheckOutput = (output) => {
  if (!output || typeof output !== 'string') return buildQualityResult()
  try {
    const parsed = JSON.parse(output.trim())
    return buildQualityResult({
      requirements: parsed.requirements ?? null,
      build: parsed.build ?? null,
      test: parsed.test ?? null,
      regression: parsed.regression ?? null,
      security: parsed.security ?? null,
    })
  } catch {
    // Legacy: binary pass/fail from exit code
    return buildQualityResult()
  }
}

// Summarize quality results for a set of runs
export const qualitySummary = (results) => {
  if (!results.length) return { total: 0, overallPassRate: 0, byDimension: {} }

  const byDim = {}
  for (const dim of QUALITY_DIMENSIONS) {
    const checked = results.filter((r) => r[dim] !== null)
    const passed = checked.filter((r) => r[dim] === true)
    byDim[dim] = { checked: checked.length, passed: passed.length, rate: checked.length ? passed.length / checked.length : null }
  }

  const overallChecked = results.filter((r) => r.checkedDimensions > 0)
  const overallPassed = overallChecked.filter((r) => r.overallPass)

  return {
    total: results.length,
    overallPassRate: overallChecked.length ? overallPassed.length / overallChecked.length : 0,
    byDimension: byDim,
  }
}
