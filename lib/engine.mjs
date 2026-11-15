// ClassificationEngine interface (mod/HANDOFF.md section V, P1): one declared contract that
// every second-opinion/classification provider conforms to, instead of each provider's health
// bookkeeping and shape being reinvented ad hoc per provider. This module does not duplicate
// classifier.mjs/jev.mjs's logic — it only wraps their existing exports into a common shape, so
// `lib/classifier.mjs` and `lib/jev.mjs` keep their own public API untouched (existing tests and
// callers of those two modules are unaffected).
//
// A ClassificationEngine here is:
//   { name, healthy(health, now?), succeeded(), failed(health, now?) }
// plus whatever provider-specific build/parse functions it needs — those differ by provider
// (builtin asks via `$.model.classify`, Jev via `$.http.fetch`) and are not forced into one
// shape, because the actual network/model call must stay in hooks/register.ts (Mod validation
// does not allow passing the `$` capability object across an import boundary — see that file's
// comment at the call site). This module only unifies what can be unified without `$`.
import { builtInResult, classificationPrompt, classifierFailed, classifierHealthy, classifierSucceeded } from './classifier.mjs'
import { buildJevRequest, jevFailed, jevHealthy, jevSucceeded, parseJevResponse } from './jev.mjs'

// 'strands-decider' is a reserved name only (HANDOFF.md section V, P2 gate): no PoC has been
// run (CPU/RAM/cold-start, 10-20 task sample) and no code may select it. It is listed here so a
// future engine has a name to register under, and so the safety test in engine.test.mjs has
// something to assert against ("this name exists, and selecting it is impossible today").
export const ENGINE_NAMES = ['builtin', 'jev', 'strands-decider']

export const builtinEngine = {
  name: 'builtin',
  buildPrompt: classificationPrompt,
  parseResult: builtInResult,
  healthy: classifierHealthy,
  succeeded: classifierSucceeded,
  failed: classifierFailed,
}

export const jevEngine = {
  name: 'jev',
  buildRequest: buildJevRequest,
  parseResponse: parseJevResponse,
  healthy: jevHealthy,
  succeeded: jevSucceeded,
  failed: jevFailed,
}

// Deliberately not an engine object (no buildPrompt/buildRequest, no health functions): there is
// nothing to call yet, and nothing should call it. `classifierMode` in lib/config.mjs already
// only accepts 'builtin'/'shadow'/'assist' — this constant does not add 'strands' as a usable
// mode, it only documents that the name is reserved and unimplemented.
export const strandsDeciderEngine = { name: 'strands-decider', implemented: false }

export const isKnownEngineName = (name) => ENGINE_NAMES.includes(name)
