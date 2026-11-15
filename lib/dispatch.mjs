// Routing dispatcher: selects R1 or R2 based on routingPolicy config.
// 'r1': classic label-based routing (decideRoute from policy.mjs)
// 'r2': score-based routing (decideRouteR2 from route-r2.mjs)
// 'shadow': R1 decides, R2 runs but only records (for comparison)
//
// Pure: no $ calls. Returns the route and, in shadow mode, the shadow result.

import { decideRoute } from './policy.mjs'
import { decideRouteR2 } from './route-r2.mjs'
import { computeScore } from './scoring.mjs'

export const dispatchRoute = ({
  text,
  classified,
  config,
  previous,
  stats,
  spentUsd,
  hungry,
  paths,
  ambiguitySource,
  confidence,
  collectorFailed,
  classifierFailed,
  riskMatchCount,
  filePathCount,
}) => {
  const policy = config.routingPolicy || 'r1'

  if (policy === 'r1') {
    const r1 = decideRoute({ classified, config, previous, stats, spentUsd, hungry, paths, ambiguitySource, confidence, collectorFailed, classifierFailed })
    return { route: r1.route, reasons: r1.reasons, policy: 'r1', shadow: null }
  }

  const scoringResult = computeScore({ text, riskMatchCount: riskMatchCount || 0, filePathCount: filePathCount || 0, classifyLabel: classified })

  if (policy === 'r2') {
    const r2 = decideRouteR2({ scoringResult, config, previous, stats, spentUsd, hungry, paths, collectorFailed, classifierFailed })
    return { route: r2.route, reasons: r2.reasons, policy: 'r2', scoring: r2.scoring, shadow: null }
  }

  if (policy === 'shadow') {
    const r1 = decideRoute({ classified, config, previous, stats, spentUsd, hungry, paths, ambiguitySource, confidence, collectorFailed, classifierFailed })
    let r2Shadow = null
    try {
      r2Shadow = decideRouteR2({ scoringResult, config, previous, stats, spentUsd, hungry, paths, collectorFailed, classifierFailed })
    } catch {
      // R2 failure in shadow mode is informational only — never blocks routing
    }
    return {
      route: r1.route,
      reasons: r1.reasons,
      policy: 'shadow',
      scoring: scoringResult,
      shadow: r2Shadow ? { route: r2Shadow.route, reasons: r2Shadow.reasons, scoring: r2Shadow.scoring } : null,
    }
  }

  // Unknown policy — fall back to R1
  const fallback = decideRoute({ classified, config, previous, stats, spentUsd, hungry, paths, ambiguitySource, confidence, collectorFailed, classifierFailed })
  return { route: fallback.route, reasons: [...fallback.reasons, `unknown policy '${policy}', fell back to r1`], policy: 'r1', shadow: null }
}
