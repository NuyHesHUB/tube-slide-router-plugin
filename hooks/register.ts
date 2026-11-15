import type { Register } from 'claude-code'
import {
  clampModelFloor, configPaths, DEFAULTS, effectiveConfig, EFFORTS, MODELS, mergeConfig, parseJson, isPlainObject,
  removeRiskArea, riskAreaFromLabel, TIERS, upsertRiskArea,
} from '../lib/config.mjs'
import { selfConsistencyAmbiguous } from '../lib/classifier.mjs'
import { buildNote, fingerprint, limitsSignature, pathsSignature, resolveCachedNote } from '../lib/collector.mjs'
import { docsReport, INSTRUCTION_FILES, referencedPaths } from '../lib/docs.mjs'
import { builtinEngine, jevEngine } from '../lib/engine.mjs'
import { escalationFor } from '../lib/escalate.mjs'
import {
  ambiguous, appendJevRecord, comparisonRecord, isPolicyRefusal, JEV_ENDPOINT, JEV_ENV_FILE, JEV_ENV_KEY,
  JevMalformedError, JEV_TIMEOUT_MS, parseEnvFile, summarizeJevComparisons,
} from '../lib/jev.mjs'
import { addToolCall, appendRecord, changedLinesOf, checkOutcome, emptyTally, STEP_CAP, stepRecord, turnRecord } from '../lib/observed.mjs'
import { bandAdvisories, contextNote, decideRoute, downgradeAdvisories, pathsIn, preflightDecision as computePreflightDecision } from '../lib/policy.mjs'
import { requestCostUsd } from '../lib/prices.mjs'
import { buildTelemetryRecord, formatTelemetryLine, telemetryPath } from '../lib/telemetry.mjs'
import {
  addToBandCal, addToCal, calKey, costKey, costKeysOf, emptyBandCal, emptyCal, jevKey, keysToPrune, localDay, ONBOARDED_KEY,
  resetSummary, resettableKeys, stepsKey, sumBandCals, sumCals, turnsKey, usageKey,
} from '../lib/store.mjs'
import { appendUsage, latestUsage, usageSnapshot } from '../lib/usage.mjs'
import { HELP, LOGO, riskAreasText, routeLine, statusLineText, statusText, TAGLINE, tierHint } from '../lib/view.mjs'
import type { PaneDraft, Tier, TurnRoute } from '../types'

const PANE = 'tsr-router'

// Loaded at session.start and on demand; module variables start over on a reload.
type Ctx = {
  config: typeof DEFAULTS
  errors: string[]
  configSource: string
  paths: { profile: string; project: string }
  root: string
  home: string
  calStats: ReturnType<typeof emptyCal>
  bandStats: ReturnType<typeof emptyBandCal>
}
let ctx: Ctx | null = null

const quiet = (config: typeof DEFAULTS) => (config.debug ? undefined : ({ to: 'debug' } as const))

// Terminal status line (실사용 통합 지침서): opt-out via config.statusLine.enabled (default
// true) — routing itself is unaffected either way, only this call is skipped when off.
// $.ui.status(undefined) clears it; failures are swallowed (a status line is cosmetic, never
// worth failing a turn over).
const setStatusLine = async ($: any, c: Ctx, text: string | undefined) => {
  if (!c.config.statusLine.enabled) return
  try {
    await $.ui.status(text)
  } catch {
    // cosmetic only — never worth failing a turn over (also covers an engine/test harness
    // that doesn't implement $.ui.status at all)
  }
}

const readJsonFile = async ($: any, path: string) => {
  if (!(await $.fs.exists(path).catch(() => false))) return { value: undefined, exists: false }
  const text = await $.fs.read(path).catch(() => null)
  if (text === null) return { value: undefined, exists: true, error: '읽을 수 없습니다' }
  const parsed = parseJson(text)
  return { value: parsed.value, exists: true, error: parsed.error }
}

const loadCtx = async ($: any): Promise<Ctx> => {
  const home = (await $.env.get('HOME')) ?? ''
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const root = await $.session.root()
  const paths = configPaths({ configDir, root })
  const profile = await readJsonFile($, paths.profile)
  const project = await readJsonFile($, paths.project)
  const { config, errors } = effectiveConfig(profile.value, project.value)
  if (profile.error) errors.push(`프로필 파일: ${profile.error}`)
  if (project.error) errors.push(`프로젝트 파일: ${project.error}`)
  const configSource = project.exists ? '프로젝트 파일' : profile.exists ? '프로필 파일' : '기본값'

  const keys: string[] = await $.store.keys().catch(() => [])
  const local = []
  const localBands = []
  for (const k of keys.filter((k) => k.startsWith('tsr-cal:'))) {
    const v = (await $.store.get(k)) as any
    local.push(v?.tiers)
    localBands.push(v?.bands)
  }
  const calStats = sumCals(local)
  const bandStats = sumBandCals(localBands)
  return { config, errors, configSource, paths, root, home, calStats, bandStats }
}

const ensureCtx = async ($: any) => (ctx ??= await loadCtx($))

const pruneStore = async ($: any, own: string) => {
  const keys: string[] = await $.store.keys().catch(() => [])
  const entries = []
  for (const key of keys) {
    if (key.startsWith('tsr-turns:') || key.startsWith('tsr-steps:') || key.startsWith('tsr-usage:')) {
      const rows = (await $.store.get(key).catch(() => null)) as any[] | null
      entries.push({ key, lastAt: Array.isArray(rows) ? (rows.at(-1)?.at ?? null) : null })
    } else if (key.startsWith('tsr-cal:')) {
      const v = (await $.store.get(key).catch(() => null)) as any
      entries.push({ key, lastAt: typeof v?.updatedAt === 'number' ? v.updatedAt : null })
    }
  }
  for (const key of keysToPrune({ keys, entries, now: Date.now(), own })) await $.store.delete(key).catch(() => {})
}

const spentToday = async ($: any) => {
  const keys: string[] = await $.store.keys().catch(() => [])
  let total = 0
  for (const k of costKeysOf(keys, localDay(Date.now()))) {
    const v = await $.store.get(k).catch(() => 0)
    if (typeof v === 'number') total += v
  }
  return total
}

const recordStep = async ($: any, e: any, requested: string, result: any) => {
  const sid = await $.session.id()
  const at = Date.now()
  const key = stepsKey(sid)
  const rows = ((await $.store.get(key)) as unknown[] | undefined) ?? []
  await $.store.set(key, [...rows, stepRecord({ turnId: e.turnId, index: e.index, requested, usage: result.usage, at })].slice(-STEP_CAP))
  const cost = requestCostUsd(result.usage?.model, result.usage)
  if (cost !== null) {
    const ck = costKey(localDay(at), sid)
    const prev = await $.store.get(ck)
    await $.store.set(ck, (typeof prev === 'number' ? prev : 0) + cost)
  }
}

// V/AA (HANDOFF.md section AA/V's P4 residual risk, closed here, director-assigned revise): the
// builtin classifier's own mechanism failed this turn — either it threw/returned an unusable
// answer, or its circuit breaker (classifierHealth) had already paused it. The caller (turn.step
// below) only reaches this when `c.config.mode === 'auto'`: manual mode keeps passing the
// original request through untouched, since a team's own configured routes are the only ones
// that should ever apply there, and router-off passthrough is a separate, earlier check that
// never reaches this far at all. Derives a route the same way a real classification would, with
// `classified: '중'` standing in for "no real label this turn" and `classifierFailed: true` so
// decideRoute's floor (lib/policy.mjs) applies: a known risk path still outranks it to
// 상/Sonnet+xhigh (or 최상/Opus+high), and the budget cap cannot push it below 중/Sonnet+high. A generator (not a plain
// async function) because it must `yield*` through to `next`, the same way the main turn.step
// body does for a normal classified turn.
async function* classifierFailureFallback(
  $: any,
  e: any,
  next: any,
  { c, settings, previous, spentUsd, paths, collectorFailed, log, reasonLabel }: {
    c: Ctx
    settings: { hungry?: boolean } | undefined
    previous: unknown
    spentUsd: number
    paths: string[]
    collectorFailed: boolean
    log: (text: string) => void
    reasonLabel: string
  },
) {
  let { route } = decideRoute({
    classified: '중', config: c.config, previous: (previous as TurnRoute | null) ?? null, stats: c.calStats, spentUsd,
    hungry: settings?.hungry === true, paths, ambiguitySource: null, confidence: null,
    collectorFailed, classifierFailed: true,
  })
  // A fresh literal here (not the `ref` the caller already built off the same e.turnId) — Mod
  // validation requires $.state.set's reference to be a plugin/key literal traceable at this
  // call site (only `id` may be computed); threading the caller's `ref` through as a parameter
  // defeats that, so this is reconstructed instead of passed in.
  const ref = { plugin: 'tube-slide-router', key: 'turnRoutes', id: e.turnId } as const
  await $.state.set(ref, { ...route, classifier: 'builtin' } as TurnRoute)
  const decisionReasons = route.decision?.reasons ?? []
  const finalModel = clampModelFloor(route.model, c.config.modelFloor)
  if (finalModel !== route.model) {
    log(`model-floor: clamped ${route.model} → ${finalModel} (floor=${c.config.modelFloor})`)
    route = { ...route, model: finalModel }
  }
  log(`classify: ${reasonLabel} — auto mode safety fallback to ${route.tier} (${route.model}/${route.effort})${decisionReasons.length ? ` (${decisionReasons.join('; ')})` : ''}`)
  {
    const _rec = buildTelemetryRecord({
      taskId: null, runId: null, turnId: e.turnId, stepIndex: e.index,
      policyVersion: 1, routingPolicy: 'r2',
      difficultyScore: route.decision?.score ?? null,
      tier: route.tier, profile: c.config.routeProfile, confidence: null,
      rationale: [...decisionReasons, 'classifier-fallback'], source: 'builtin-fallback',
      classifyLabel: '중', llmEvaluated: false,
      selectedModel: route.model, selectedEffort: route.effort,
      actualModel: null, actualEffort: null,
      escalatedFrom: null, escalatedAtStreak: null, shadow: null,
      contextStrategy: null, contextFiles: null, contextBytesOrTokens: null,
      cacheValidity: null, contextCollectionElapsedMs: null,
      timestamp: new Date().toISOString(),
    })
    const _path = telemetryPath(c.root)
    let _prev = ''; try { _prev = await $.fs.read(_path) } catch {}
    await $.fs.write(_path, _prev + formatTelemetryLine(_rec) + '\n').catch(() => {})
  }
  await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort }))
  const result = yield* next({ ...e, model: route.model, effort: route.effort })
  log(`served: step 0 requested=${route.model} served=${result.usage?.model ?? 'unknown'}`)
  await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort, actualModel: result.usage?.model ?? null }))
  await recordStep($, e, route.model, result).catch(() => {})
  return result
}

// The one network call shared by shadow (fire-and-forget, after the route is already decided)
// and assist (awaited before deciding the route, since its answer may nudge effort — see the
// turn.step handler). Never logs or stores the prompt text, the key, the endpoint, or the raw
// Jev response — only labels and timing, via recordJevComparison below.
const askJev = async ($: any, { text }: { text: string }) => {
  const healthRef = { plugin: 'tube-slide-router', key: 'jevHealth' } as const
  const { value: health } = await $.state.get(healthRef)
  if (!jevEngine.healthy(health)) return null
  const envPath = `${(await ensureCtx($)).home}/${JEV_ENV_FILE}`
  const envText = await $.fs.read(envPath).catch(() => null)
  const apiKey = typeof envText === 'string' ? parseEnvFile(envText)[JEV_ENV_KEY] : undefined
  if (!apiKey) return null // no key: stays silent, same as a classifier with no credential

  const startedAt = Date.now()
  let jevTier: string | null = null
  let confidence: number | null = null
  let error: string | null = null
  let countsAsFailure = true
  try {
    const response = await Promise.race([
      $.http.fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(jevEngine.buildRequest(text)),
      }),
      $.clock.sleep(JEV_TIMEOUT_MS).then(() => {
        throw new Error('jev timeout')
      }),
    ])
    if (response.status === 401 || response.status === 403) error = 'auth'
    else if (!response.ok) error = `http-${response.status}`
    else {
      const parsed = jevEngine.parseResponse(response.text)
      jevTier = parsed.tier
      confidence = parsed.confidence
    }
  } catch (e: any) {
    if (e instanceof JevMalformedError) error = e.message
    else if (isPolicyRefusal(e?.message)) {
      error = 'policy'
      countsAsFailure = false // an org/engine policy refusal is not Jev being down
    } else if (String(e?.message).includes('jev timeout')) error = 'timeout'
    else error = 'unreachable'
  }
  await $.state.set(healthRef, error && countsAsFailure ? jevEngine.failed(health) : jevEngine.succeeded())
  return { jevTier, confidence, error, latencyMs: Date.now() - startedAt }
}

const recordJevComparison = async (
  $: any,
  { turnId, builtinTier, jevTier, confidence, latencyMs, error }: { turnId: string; builtinTier: string; jevTier: string | null; confidence: number | null; latencyMs: number; error: string | null },
) => {
  const sid = await $.session.id()
  const key = jevKey(sid)
  const rows = ((await $.store.get(key)) as unknown[] | undefined) ?? []
  const record = comparisonRecord({ turnId, at: Date.now() - latencyMs, builtinTier, jevTier, confidence, latencyMs, error })
  await $.store.set(key, appendJevRecord(rows, record))
}

// Shadow-only: never affects the route. Runs concurrently with the real model request
// (started before `yield* next(...)`, awaited after), so it adds no visible latency in the
// common case where the real request outlasts Jev's 1.5s budget.
const jevShadowCompare = async ($: any, { text, turnId, builtinTier }: { text: string; turnId: string; builtinTier: string }) => {
  const ask = await askJev($, { text })
  if (!ask) return
  await recordJevComparison($, { turnId, builtinTier, ...ask })
}

// I. (HANDOFF.md section I) assist's fallback ambiguity signal when Jev gave no usable answer
// that turn. Re-asks the built-in classifier `calls - 1` more times (the first call, already
// made for routing, is `firstLabel`) with the exact same prompt, run concurrently since each is
// independent. A failed or unusable extra call is simply dropped from the vote, same spirit as
// askJev swallowing its own failures — never blocks the turn, never touches classifierHealth
// (that circuit breaker tracks the one authoritative call, not this secondary signal).
const selfConsistencyVotes = async ($: any, { text, note, calls, firstLabel }: { text: string; note: string | null; calls: number; firstLabel: string }) => {
  const extra = Math.max(0, calls - 1)
  if (extra === 0) return [firstLabel]
  const prompt = builtinEngine.buildPrompt({ text, note })
  const answers = await Promise.all(Array.from({ length: extra }, () => $.model.classify(prompt, TIERS).catch(() => undefined)))
  const votes = [firstLabel]
  for (const answer of answers) {
    const result = builtinEngine.parseResult(answer)
    if (result) votes.push(result.label)
  }
  return votes
}

// P3 (HANDOFF.md section Y): bounded, secret-masked file context for the classifier, backed by
// a real single-slot cache in `$.state` (cacheRef) — not just a fingerprint kept for a log
// line. Every turn still re-reads at most `limits.maxFiles` of the paths the request text named
// (pathsIn, the same extraction the risk floor already uses): there is no cheap metadata (no
// git, no mtime — see HANDOFF.md section Y) that would let a turn know its content is unchanged
// without reading it. What the cache actually saves a hit from redoing is the rest of the
// pipeline — masking and the maxBytes/maxTokens bind — by reusing the already-masked, already-
// bounded note straight from the cache entry (collector.mjs's resolveCachedNote). A miss (no
// entry yet, or the path signature, raw-content fingerprint, or limits signature no longer
// match) rebuilds via buildNote and replaces the entry. The limits signature (collector.mjs's
// limitsSignature, over maxFiles/maxBytes/maxTokens/timeoutMs) exists because /tsr-router reload
// can change `c.config.contextCollector` without a new session: same paths, same raw content,
// but a tightened maxBytes/maxTokens must still force a rebuild, never reuse a note that was
// bound under the old, looser limits. Only ever the masked note + its signature/fingerprint/
// limits signature is stored — never raw file text, so a secret can never reach the cache, the
// prompt or a log.
// The whole thing races `limits.timeoutMs` the same way askJev races JEV_TIMEOUT_MS; a timeout
// (or any other throw) rejects, and the caller treats that as a collector failure — never as
// "nothing to show" (see decideRoute's collectorFailed). A path that simply does not exist (not
// yet created, or unreadable to this plugin) is not a failure: it is dropped from the candidate
// list like any other miss.
const CONTEXT_LIMITS_SHAPE = { enabled: false, maxFiles: 0, maxBytes: 0, maxTokens: 0, timeoutMs: 0 }
// A literal (not a parameter) on purpose: `$.state.get`/`set` require a plugin/key literal
// (only `id` may be computed) so plugin validation can enumerate every state key a module
// touches — see `claude plugin validate`'s check on this. Single slot, so no `id` at all.
const CONTEXT_COLLECTOR_CACHE_REF = { plugin: 'tube-slide-router', key: 'contextCollectorCache' } as const
const collectContext = async ($: any, { paths, limits }: { paths: string[]; limits: typeof CONTEXT_LIMITS_SHAPE }) => {
  const work = (async () => {
    const uniquePaths = [...new Set(paths)]
    // Read at most maxFiles — bindFiles (inside buildNote) would enforce the same cap, but only
    // on what it is handed, so cutting the candidate list here as well (to bound how much is
    // actually read) would otherwise hide a maxFiles truncation from its own count. Tracked
    // separately so "there were more named paths than maxFiles allows" is never lost.
    const truncatedByFileCount = uniquePaths.length > limits.maxFiles
    const raw: { path: string; text: string }[] = []
    for (const path of uniquePaths.slice(0, limits.maxFiles)) {
      const text = await $.fs.read(path).catch(() => null)
      if (typeof text === 'string') raw.push({ path, text })
    }
    // Over every raw file just read (not only the ones that end up included after binding) —
    // computed before buildNote runs, on purpose, so a hit can be decided without ever calling
    // buildNote at all.
    const signature = pathsSignature(paths)
    const hash = fingerprint(raw)
    const limitsSig = limitsSignature(limits)
    const { value: cached } = await $.state.get(CONTEXT_COLLECTOR_CACHE_REF)
    const reused = resolveCachedNote(cached, signature, hash, limitsSig)
    if (reused) return { note: reused.note, truncated: reused.truncated, reused: true, hadPriorCache: true }
    const built = buildNote(raw, limits)
    const truncated = truncatedByFileCount || built.truncated
    await $.state.set(CONTEXT_COLLECTOR_CACHE_REF, { signature, hash, limitsSignature: limitsSig, note: built.note, truncated, at: Date.now() })
    return { note: built.note, truncated, reused: false, hadPriorCache: Boolean(cached) }
  })()
  return Promise.race([work, $.clock.sleep(limits.timeoutMs).then(() => { throw new Error('context collector timeout') })])
}

const saveProfile = async ($: any, draft: PaneDraft) => {
  const c = await ensureCtx($)
  const file: Record<string, unknown> = { version: 1, mode: draft.mode, budget: draft.budget }
  if (draft.mode === 'manual') file.routes = draft.routes
  await $.fs.write(c.paths.profile, JSON.stringify(file, null, 2) + '\n')
  ctx = await loadCtx($)
}

const draftFrom = (config: typeof DEFAULTS): PaneDraft => ({
  mode: config.mode as PaneDraft['mode'],
  routes: structuredClone(config.routes) as PaneDraft['routes'],
  budget: structuredClone(config.budget),
})

const setPane = ($: any, view: string, draft: PaneDraft) => $.state.set({ plugin: 'tube-slide-router', key: 'pane' }, { view, draft })

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tsr-router',
      description: 'Tube Slide Router 패널 열기, 또는 status / reload / on / off / hungry / normal / setup / export / risk',
      argumentHint: '[status|reload|on|off|hungry|normal|setup|export|risk|help]',
      immediate: true,
    })
    await $.command.register({
      name: 'tsr-docs',
      description: 'CLAUDE.md, AGENTS.md 등이 가리키는 경로가 실제로 있는지 검사합니다. all 을 붙이면 docs/ 도 봅니다',
      argumentHint: '[all]',
      immediate: true,
    })
    ctx = await loadCtx($)
    await pruneStore($, await $.session.id()).catch(() => {})
    if (e.isInteractive && !(await $.store.get(ONBOARDED_KEY)) && ctx.configSource === '기본값') {
      await setPane($, 'welcome', draftFrom(ctx.config))
      const opened = await $.ui.open({ id: PANE, title: 'Tube Slide Router' }).catch(() => null)
      if (!(opened && 'isPlaced' in opened && opened.isPlaced)) {
        // Narrow terminal, or any other reason the pane could not be placed: never fail silently.
        // The pane state is already 'welcome', so /tsr-router (or a future wider session, since we
        // do not mark onboarding done here) opens straight into it.
        $.ui.toast('Tube Slide Router: 자동 모드(기본 등급표)로 시작합니다. 설정을 보려면 /tsr-router 를 입력하세요.')
      } else {
        await $.store.set(ONBOARDED_KEY, true)
      }
    }
    return next(e)
  })

  // M. (HANDOFF.md section M) Purely observational: records the account's rate-limit windows
  // (empty off a subscription — that absence is itself the finding, not a bug) and the engine's
  // own session cost ledger, so the $-estimate figures everywhere else in this project (lib/
  // prices.mjs) can eventually be checked against both, instead of staying an unverified guess.
  // Never touches routing. A write failing here must never break the measurement the engine
  // itself is mid-delivery of, hence the outer .catch.
  on('session.measure', async ($, e, next) => {
    try {
      const sid = await $.session.id()
      const key = usageKey(sid)
      const rows = ((await $.store.get(key)) as unknown[] | undefined) ?? []
      await $.store.set(key, appendUsage(rows, usageSnapshot({ at: Date.now(), rateLimits: e.rateLimits, cost: e.cost })))
    } catch {
      // Never let a storage hiccup here surface as a session.measure failure.
    }
    return next(e)
  })

  // AF. Capture prompt text at turn.start so turn.step can read it from state — more reliable
  // than $.session.messages() which may return empty or use a different format in headless mode.
  on('turn.start', async ($, e, next) => {
    if (e.text) {
      await $.state.set({ plugin: 'tube-slide-router', key: 'turnText', id: e.turnId }, e.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      yield* next(e)
      return
    }
    const { value: settings } = await $.state.get({ plugin: 'tube-slide-router', key: 'settings' })
    const c = await ensureCtx($)
    if (settings?.off) {
      await setStatusLine($, c, 'TSR OFF')
      yield* next(e)
      return
    }
    const log = (text: string) => $.ui.log(`[tube-slide-router] ${text}`, quiet(c.config))
    const ref = { plugin: 'tube-slide-router', key: 'turnRoutes', id: e.turnId } as const

    if (e.index > 0) {
      // Continuation: reuse the turn's route; move up only on failed checks in a row.
      const { value: stored } = await $.state.get(ref)
      if (!stored) {
        yield* next(e)
        return
      }
      const { value: tally } = await $.state.get({ plugin: 'tube-slide-router', key: 'turnTools', id: e.turnId })
      const current = tally ?? emptyTally()
      let route: TurnRoute = stored
      const up = settings?.hungry ? null : escalationFor(current, stored.tier, stored.escalatedAtStreak ?? 0, c.config.escalation.failsInRow, c.config.riskAreas)
      if (up) {
        route = { ...stored, tier: up.tier as Tier, ...c.config.routes[up.tier as Tier], escalatedFrom: stored.escalatedFrom ?? stored.tier, escalatedAtStreak: current.failStreak }
        await $.state.set(ref, route)
        log(`escalated: ${stored.tier} -> ${route.tier} at step ${e.index}: ${up.reason}`)
        {
          const _rec = buildTelemetryRecord({
            taskId: null, runId: null, turnId: e.turnId, stepIndex: e.index,
            policyVersion: 1, routingPolicy: c.config.routingPolicy,
            difficultyScore: null, tier: route.tier, profile: c.config.routeProfile, confidence: null,
            rationale: [up.reason], source: 'escalation',
            classifyLabel: null, llmEvaluated: false,
            selectedModel: route.model, selectedEffort: route.effort,
            actualModel: null, actualEffort: null,
            escalatedFrom: stored.escalatedFrom ?? stored.tier,
            escalatedAtStreak: current.failStreak, shadow: null,
            preflightDecision: null, decisionSource: 'escalation',
            preflightElapsedMs: null, classificationCallSkipped: false, fallbackReason: null,
            contextStrategy: null, contextFiles: null, contextBytesOrTokens: null,
            cacheValidity: null, contextCollectionElapsedMs: null,
            timestamp: new Date().toISOString(),
          })
          const _path = telemetryPath(c.root)
          let _prev = ''; try { _prev = await $.fs.read(_path) } catch {}
          await $.fs.write(_path, _prev + formatTelemetryLine(_rec) + '\n').catch(() => {})
        }
      }
      const contModel = clampModelFloor(route.model, c.config.modelFloor)
      if (contModel !== route.model) {
        log(`model-floor: clamped ${route.model} → ${contModel} (floor=${c.config.modelFloor})`)
        route = { ...route, model: contModel }
      }
      const escalatedFrom = up ? stored.tier : null
      await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort, escalatedFrom, tier: route.tier }))
      const result = yield* next({ ...e, model: route.model, effort: route.effort })
      log(`served: step ${e.index} requested=${route.model} served=${result.usage?.model ?? 'unknown'}`)
      await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort, escalatedFrom, tier: route.tier, actualModel: result.usage?.model ?? null }))
      await recordStep($, e, route.model, result).catch(() => {})
      return result
    }

    await $.state.set({ plugin: 'tube-slide-router', key: 'currentTurnId' }, e.turnId)
    // AF. Primary: read text cached by turn.start handler (works in all modes including headless).
    // Fallback 1: $.session.messages({ as: 'api' }) with .content (API format).
    // Fallback 2: $.session.messages() with .text (interactive format).
    const { value: cachedText } = await $.state.get({ plugin: 'tube-slide-router', key: 'turnText', id: e.turnId })
    let text: string | undefined = typeof cachedText === 'string' ? cachedText : undefined
    if (!text) {
      try {
        const msgs = await $.session.messages({ as: 'api' }).catch(() => null) ?? await $.session.messages().catch(() => [])
        const last = (msgs as any[]).at(-1)
        if (last?.role === 'user') {
          const raw = last.text ?? last.content
          text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : undefined
        }
      } catch {
        // both message APIs failed — text stays undefined
      }
    }
    if (!text) {
      log('turn.step: no prompt text available — passing through without routing')
      yield* next(e)
      return
    }
    const riskNote = contextNote(text, c.config.riskAreas)
    const paths = pathsIn(text)

    // === P0-A (TSR-OPT-001): Fast Preflight ===
    // Rule-based check before $.model.classify — skip the LLM call for low-risk Sonnet turns.
    const preflightStart = c.config.preflight.enabled ? performance.now() : 0
    let preflightDecision: 'fast_path' | 'adaptive' | null = null
    let preflightFallbackReason: string | null = null
    let classificationSkipped = false

    if (c.config.preflight.enabled) {
      const sessionModel = e.model
      const hasRisk = !!riskNote
      const tooManyPaths = paths.length > c.config.preflight.maxPaths
      const { value: lastRoute } = await $.state.get({ plugin: 'tube-slide-router', key: 'lastRoute' })
      const recentlyEscalated = lastRoute?.escalatedFrom != null

      const pf = computePreflightDecision({
        sessionModel, hasRisk, tooManyPaths, recentlyEscalated, hungry: settings?.hungry === true,
      })
      preflightDecision = pf.decision
      preflightFallbackReason = pf.fallbackReason

      const preflightMs = Math.round(performance.now() - preflightStart)
      log(`preflight: ${preflightDecision} (${preflightMs}ms)${preflightFallbackReason ? ` reason=${preflightFallbackReason}` : ''}`)
    }
    const preflightElapsedMs = c.config.preflight.enabled ? Math.round(performance.now() - preflightStart) : null

    // P0-A fast path: skip classify entirely when preflight says fast_path and shadow mode is off.
    // The turn routes as 중 (sonnet/high) — the session default — with zero LLM overhead.
    if (c.config.preflight.enabled && !c.config.preflight.shadowMode && preflightDecision === 'fast_path') {
      classificationSkipped = true
      const { value: previous } = await $.state.get({ plugin: 'tube-slide-router', key: 'lastRoute' })
      const spentUsd = c.config.budget.enabled ? await spentToday($) : 0
      let { route } = decideRoute({
        classified: '중', config: c.config, previous: previous ?? null, stats: c.calStats, spentUsd,
        hungry: false, paths, ambiguitySource: null, confidence: null, collectorFailed: false,
      })
      await $.state.set(ref, { ...route, classifier: 'builtin' } as TurnRoute)
      const decisionReasons = route.decision?.reasons ?? []
      const pfModel = clampModelFloor(route.model, c.config.modelFloor)
      if (pfModel !== route.model) {
        log(`model-floor: clamped ${route.model} → ${pfModel} (floor=${c.config.modelFloor})`)
        route = { ...route, model: pfModel }
      }
      log(`rewrite: preflight fast_path label=중 -> ${route.tier} model ${e.model} -> ${route.model}, effort ${e.effort ?? 'none'} -> ${route.effort}${decisionReasons.length ? ` (${decisionReasons.join('; ')})` : ''}`)
      {
        const _rec = buildTelemetryRecord({
          taskId: null, runId: null, turnId: e.turnId, stepIndex: e.index,
          policyVersion: 1, routingPolicy: c.config.routingPolicy,
          difficultyScore: route.decision?.score ?? null,
          tier: route.tier, profile: c.config.routeProfile, confidence: null,
          rationale: decisionReasons, source: 'preflight',
          classifyLabel: '중', llmEvaluated: false,
          selectedModel: route.model, selectedEffort: route.effort,
          actualModel: null, actualEffort: null,
          escalatedFrom: null, escalatedAtStreak: null, shadow: null,
          preflightDecision: 'fast_path', decisionSource: 'preflight_rule',
          preflightElapsedMs, classificationCallSkipped: true, fallbackReason: null,
          contextStrategy: 'skipped', contextFiles: null, contextBytesOrTokens: null,
          cacheValidity: null, contextCollectionElapsedMs: null,
          timestamp: new Date().toISOString(),
        })
        const _path = telemetryPath(c.root)
        let _prev = ''; try { _prev = await $.fs.read(_path) } catch {}
        await $.fs.write(_path, _prev + formatTelemetryLine(_rec) + '\n').catch(() => {})
      }
      await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort }))
      const result = yield* next({ ...e, model: route.model, effort: route.effort })
      log(`served: step 0 requested=${route.model} served=${result.usage?.model ?? 'unknown'} [preflight fast_path]`)
      await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort, actualModel: result.usage?.model ?? null }))
      await recordStep($, e, route.model, result).catch(() => {})
      return result
    }
    // === End P0-A fast path ===

    const healthRef = { plugin: 'tube-slide-router', key: 'classifierHealth' } as const
    const { value: health } = await $.state.get(healthRef)
    if (!builtinEngine.healthy(health)) {
      if (c.config.mode === 'auto') {
        const { value: previous } = await $.state.get({ plugin: 'tube-slide-router', key: 'lastRoute' })
        const spentUsd = c.config.budget.enabled ? await spentToday($) : 0
        return yield* classifierFailureFallback($, e, next, {
          c, settings, previous, spentUsd, paths, collectorFailed: false, log,
          reasonLabel: 'built-in classifier temporarily paused after repeated failures',
        })
      }
      log('classify: built-in classifier temporarily paused after repeated failures, passing through')
      yield* next(e)
      return
    }
    // Phase 1: classify with just the prompt + risk note (no file content).
    // Context collection is deferred to Phase 2 below so 중-classified turns
    // (which map to the default route) never pay the collector's I/O + token cost.
    const quickNote = riskNote || null
    let answer = await $.model.classify(builtinEngine.buildPrompt({ text, note: quickNote }), TIERS).catch(() => undefined)
    let classified = builtinEngine.parseResult(answer)

    // Phase 2: collect file context only when the initial label suggests routing
    // will actually change (극소/하/상). For 중 the route is sonnet/high — the
    // session default — so file context cannot improve the outcome and its I/O +
    // token overhead is pure waste (the 1.3% medium-cohort REGRESSION in R-006).
    let collectorNoteText: string | null = null
    let collectorFailed = false
    let ctxStrategy: 'skipped' | 'collected' | 'cached' | null = null
    let ctxFiles: number | null = null
    let ctxBytesOrTokens: number | null = null
    let ctxCacheValidity: 'hit' | 'miss' | 'stale' | null = null
    let ctxElapsedMs: number | null = null
    const needsContext = classified && classified.label !== '중'
    if (needsContext && c.config.contextCollector.enabled) {
      const collectPaths = pathsIn(text)
      if (collectPaths.length) {
        const ctxStart = performance.now()
        try {
          const collected = await collectContext($, { paths: collectPaths, limits: c.config.contextCollector })
          ctxElapsedMs = Math.round(performance.now() - ctxStart)
          ctxStrategy = collected.reused ? 'cached' : 'collected'
          ctxCacheValidity = collected.reused ? 'hit' : (collected.hadPriorCache ? 'stale' : 'miss')
          ctxFiles = collectPaths.length
          ctxBytesOrTokens = collected.note?.length ?? 0
          if (collected.reused) log('context collector: cache hit — reused the masked note from a previous turn')
          else if (collected.hadPriorCache) log('context collector: cache invalidated (collected file content changed, or contextCollector limits changed)')
          if (collected.truncated) log('context collector: bounds applied (maxFiles/maxBytes/maxTokens)')
          collectorNoteText = collected.note
        } catch {
          ctxElapsedMs = Math.round(performance.now() - ctxStart)
          ctxStrategy = 'collected'
          ctxCacheValidity = 'miss'
          collectorFailed = true
          log('context collector: failed or timed out — forcing a 중 floor instead of trusting empty context')
        }
      } else {
        ctxStrategy = 'skipped'
      }
    } else {
      ctxStrategy = 'skipped'
    }
    const note = [riskNote, collectorNoteText].filter(Boolean).join('\n') || null
    // Re-classify with full context when the collector produced new information —
    // the initial Phase 1 label was good enough to decide WHETHER to collect, but
    // the file content may refine the label (e.g. 하 → 중 because files are complex).
    if (collectorNoteText && classified) {
      const refined = await $.model.classify(builtinEngine.buildPrompt({ text, note }), TIERS).catch(() => undefined)
      const refinedParsed = builtinEngine.parseResult(refined)
      if (refinedParsed) {
        classified = refinedParsed
        answer = refined
      }
    }
    if (!classified) {
      await $.state.set(healthRef, builtinEngine.failed(health))
      if (c.config.mode === 'auto') {
        const { value: previous } = await $.state.get({ plugin: 'tube-slide-router', key: 'lastRoute' })
        const spentUsd = c.config.budget.enabled ? await spentToday($) : 0
        return yield* classifierFailureFallback($, e, next, {
          c, settings, previous, spentUsd, paths, collectorFailed, log,
          reasonLabel: 'no usable built-in label',
        })
      }
      log('classify: no usable built-in label, passing through')
      yield* next(e)
      return
    }
    await $.state.set(healthRef, builtinEngine.succeeded())
    const { label, provider } = classified
    const { value: previous } = await $.state.get({ plugin: 'tube-slide-router', key: 'lastRoute' })
    const spentUsd = c.config.budget.enabled ? await spentToday($) : 0
    // assist needs its ambiguity signal before the route is decided (it may nudge effort), so
    // this is awaited here instead of running concurrently like shadow's. The known cost of
    // turning assist on is this one request's latency, capped at JEV_TIMEOUT_MS.
    const assistAsk = c.config.classifierMode === 'assist' ? await askJev($, { text }).catch(() => null) : null
    let ambiguitySource: 'jev' | 'self-consistency' | null = null
    if (assistAsk) {
      ambiguitySource = ambiguous(label, assistAsk.jevTier, assistAsk.confidence) ? 'jev' : null
    } else if (c.config.classifierMode === 'assist' && c.config.selfConsistency.enabled) {
      // Jev gave no usable answer this turn (no key, paused, error, timeout — askJev treats
      // them all the same) — fall back to re-asking the built-in classifier itself.
      const votes = await selfConsistencyVotes($, { text, note, calls: c.config.selfConsistency.calls, firstLabel: label }).catch(() => [label])
      ambiguitySource = selfConsistencyAmbiguous(votes) ? 'self-consistency' : null
    }
    let { route } = decideRoute({
      classified: label, config: c.config, previous: previous ?? null, stats: c.calStats, spentUsd,
      hungry: settings?.hungry === true, paths, ambiguitySource,
      confidence: ambiguitySource === 'jev' ? assistAsk?.confidence ?? null : null,
      collectorFailed,
    })
    await $.state.set(ref, { ...route, classifier: provider } as TurnRoute)
    // N. reads straight from route.decision now (same reasons array decideRoute always returned)
    // — proof the refactor changed nothing: this line's output is byte-for-byte the same as
    // before it switched from the old destructured `reasons` to `route.decision.reasons`.
    const decisionReasons = route.decision?.reasons ?? []
    log(`rewrite: classifier=${provider} label=${label} -> ${route.tier} model ${e.model} -> ${route.model}, effort ${e.effort ?? 'none'} -> ${route.effort}${decisionReasons.length ? ` (${decisionReasons.join('; ')})` : ''}${note ? ' [context]' : ''}`)
    {
      const _rec = buildTelemetryRecord({
        taskId: null, runId: null, turnId: e.turnId, stepIndex: e.index,
        policyVersion: 1, routingPolicy: c.config.routingPolicy,
        difficultyScore: route.decision?.score ?? null,
        tier: route.tier, profile: c.config.routeProfile,
        confidence: ambiguitySource === 'jev' ? assistAsk?.confidence ?? null : null,
        rationale: decisionReasons, source: provider,
        classifyLabel: label, llmEvaluated: true,
        selectedModel: route.model, selectedEffort: route.effort,
        actualModel: null, actualEffort: null,
        escalatedFrom: null, escalatedAtStreak: null, shadow: null,
        preflightDecision, decisionSource: 'classifier',
        preflightElapsedMs, classificationCallSkipped: false,
        fallbackReason: preflightFallbackReason,
        contextStrategy: ctxStrategy, contextFiles: ctxFiles,
        contextBytesOrTokens: ctxBytesOrTokens, cacheValidity: ctxCacheValidity,
        contextCollectionElapsedMs: ctxElapsedMs,
        timestamp: new Date().toISOString(),
      })
      const _path = telemetryPath(c.root)
      let _prev = ''; try { _prev = await $.fs.read(_path) } catch {}
      await $.fs.write(_path, _prev + formatTelemetryLine(_rec) + '\n').catch(() => {})
    }
    // Shadow: started before the real request so it runs concurrently, not after it. Assist
    // already has its answer, so just record it the same way shadow does, for later aggregation.
    const clsModel = clampModelFloor(route.model, c.config.modelFloor)
    if (clsModel !== route.model) {
      log(`model-floor: clamped ${route.model} → ${clsModel} (floor=${c.config.modelFloor})`)
      route = { ...route, model: clsModel }
    }
    const jevPromise =
      c.config.classifierMode === 'shadow'
        ? jevShadowCompare($, { text, turnId: e.turnId, builtinTier: route.tier }).catch(() => {})
        : assistAsk
          ? recordJevComparison($, { turnId: e.turnId, builtinTier: route.tier, ...assistAsk }).catch(() => {})
          : null
    await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort }))
    const result = yield* next({ ...e, model: route.model, effort: route.effort })
    log(`served: step 0 requested=${route.model} served=${result.usage?.model ?? 'unknown'}`)
    await setStatusLine($, c, statusLineText({ config: c.config, settings, model: route.model, effort: route.effort, actualModel: result.usage?.model ?? null }))
    await recordStep($, e, route.model, result).catch(() => {})
    if (jevPromise) await jevPromise
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await tallyToolCall($, e, result).catch(() => {})
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await recordTurn($, e).catch(() => {})
    return next(e)
  })

  registerCommandsAndPane(on)
}

const tallyToolCall = async ($: any, e: any, result: unknown) => {
    const { value: turnId } = await $.state.get({ plugin: 'tube-slide-router', key: 'currentTurnId' })
    if (!turnId) return
    const ref = { plugin: 'tube-slide-router', key: 'turnTools', id: turnId } as const
    const { value } = await $.state.get(ref)
    const call = e as unknown as { file_path?: unknown; command?: unknown; old_string?: unknown; new_string?: unknown; content?: unknown }
    const answer = result as unknown as { isError?: boolean; message?: unknown; error?: unknown; result?: { stderr?: string; message?: unknown; error?: unknown; interrupted?: boolean; exitCode?: unknown; exit_code?: unknown } }
    // stderr is often a warning or normal program output.  Escalating on it would
    // teach the router from environment noise; use explicit tool errors, an
    // interruption, or a reported non-zero exit code only.
    const outcome = checkOutcome(answer)
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
    await $.state.set(
      ref,
      addToolCall(
        value ?? emptyTally(),
        {
          tool: e.tool,
          file_path: str(call.file_path),
          command: str(call.command),
          changedLines: changedLinesOf({ tool: e.tool, old_string: call.old_string, new_string: call.new_string, content: call.content }),
        },
        { failed: outcome === 'failed', ran: outcome !== 'none' },
      ),
    )
}

const recordTurn = async ($: any, e: any) => {
    const { value: route } = await $.state.get({ plugin: 'tube-slide-router', key: 'turnRoutes', id: e.turnId })
    if (!route) return
    const { value: tally } = await $.state.get({ plugin: 'tube-slide-router', key: 'turnTools', id: e.turnId })
    const c = await ensureCtx($)
    const record = turnRecord({ turnId: e.turnId, route, tally: tally ?? emptyTally(), complete: e, startedAt: Date.now() - e.durationMs })
    const sid = await $.session.id()
    const rows = ((await $.store.get(turnsKey(sid))) as unknown[] | undefined) ?? []
    await $.store.set(turnsKey(sid), appendRecord(rows, record))
    const cal = (await $.store.get(calKey(sid))) as any
    await $.store.set(calKey(sid), {
      updatedAt: Date.now(),
      tiers: addToCal(cal?.tiers ?? emptyCal(), record),
      bands: addToBandCal(cal?.bands ?? emptyBandCal(), record),
    })
    await $.state.set({ plugin: 'tube-slide-router', key: 'lastRoute' }, { tier: route.tier, model: route.model, effort: route.effort })
    $.ui.log(`[tube-slide-router] turn recorded: predicted=${record.predicted} final=${record.final} observed=${record.observed ?? 'none'} files=${record.files} tests=${record.tests}`, quiet(c.config))
}

const registerCommandsAndPane = (on: Parameters<Register>[0]) => {
  on('command.run', { command: 'tsr-router' }, async ($, e) => {
    const arg = e.args.trim().split(/\s+/)[0] ?? ''
    const settingsRef = { plugin: 'tube-slide-router', key: 'settings' } as const
    const { value: settings } = await $.state.get(settingsRef)
    const s = settings ?? {}
    const c = await ensureCtx($)
    if (arg === 'help') return { text: HELP }
    if (arg === 'reload') {
      ctx = await loadCtx($)
      return { text: `설정을 다시 읽었습니다. 현재 설정: ${ctx.configSource}` }
    }
    if (arg === 'off' || arg === 'on') {
      await $.state.set(settingsRef, { ...s, off: arg === 'off' })
      return { text: arg === 'off' ? '이 세션의 라우팅을 껐습니다. 원래 모델로 요청이 나갑니다.' : '이 세션의 라우팅을 켰습니다.' }
    }
    if (arg === 'hungry' || arg === 'normal') {
      await $.state.set(settingsRef, { ...s, hungry: arg === 'hungry' })
      return { text: arg === 'hungry' ? 'hungry 모드(가칭): 이 세션은 예산과 상관없이 모든 턴을 최상 등급으로 보냅니다.' : 'hungry 모드를 해제했습니다.' }
    }
    if (arg === 'reset') {
      const keys: string[] = await $.store.keys().catch(() => [])
      const toDelete = resettableKeys(keys)
      if (e.args.trim().split(/\s+/)[1] !== 'confirm') {
        const summary = resetSummary(keys)
        const lines = Object.entries(summary).filter(([, n]) => (n as number) > 0).map(([p, n]) => `${p} ${n as number}개`)
        return {
          text:
            `이 기기에 쌓인 턴·사용량·보정·Jev 비교 기록을 전부 지웁니다(다른 세션 것 포함, 총 ${toDelete.length}개 키).\n` +
            (lines.length ? lines.join(', ') + '\n' : '(지울 기록이 없습니다)\n') +
            `설정 파일은 지우지 않습니다.\n` +
            `정말 지우려면 /tsr-router reset confirm`,
        }
      }
      for (const k of toDelete) await $.store.delete(k).catch(() => {})
      ctx = await loadCtx($)
      return { text: `기록 ${toDelete.length}개를 지웠습니다. 보정은 지금부터 새로 쌓입니다.` }
    }
    if (arg === 'risk') {
      const parts = e.args.trim().split(/\s+/)
      const sub = parts[1]
      if (sub === undefined || sub === 'list') return { text: riskAreasText(c.config.riskAreas) }
      const existing = await readJsonFile($, c.paths.project)
      const base: Record<string, unknown> = isPlainObject(existing.value) ? existing.value : {}
      if (sub === 'add') {
        const label = parts[2]
        const minTier = parts[3] as Tier
        if (!label || !TIERS.includes(minTier)) return { text: `사용법: /tsr-router risk add <폴더이름> <${TIERS.join('|')}>` }
        const area = riskAreaFromLabel(label, minTier)
        const file = { ...base, riskAreas: upsertRiskArea((base.riskAreas as unknown[]) ?? [], area) }
        const { errors } = mergeConfig(DEFAULTS, file)
        if (errors.length) return { text: `설정이 올바르지 않아 쓰지 않았습니다: ${errors.join('; ')}` }
        await $.fs.write(c.paths.project, JSON.stringify(file, null, 2) + '\n')
        ctx = await loadCtx($)
        return { text: `위험 영역에 추가했습니다 (${c.paths.project}):\n  - ${label}: ${area.pattern}  →  최소 ${minTier}` }
      }
      if (sub === 'remove') {
        const label = parts[2]
        if (!label) return { text: '사용법: /tsr-router risk remove <폴더이름>' }
        const before = (base.riskAreas as unknown[]) ?? []
        const after = removeRiskArea(before as any, label)
        if (after.length === before.length) return { text: `프로젝트 설정 파일에 "${label}" 이름으로 등록된 위험 영역이 없습니다. (기본 제공 영역이라면 이 파일에 같은 이름으로 재정의한 적이 없는 한 지울 항목이 없습니다.)` }
        await $.fs.write(c.paths.project, JSON.stringify({ ...base, riskAreas: after }, null, 2) + '\n')
        ctx = await loadCtx($)
        return { text: `프로젝트 설정에서 "${label}"을(를) 지웠습니다. 기본값과 이름이 같았다면 기본값으로 돌아갑니다.` }
      }
      return { text: '사용법: /tsr-router risk list | risk add <폴더이름> <등급> | risk remove <폴더이름>' }
    }
    const sid = await $.session.id()
    const turns = ((await $.store.get(turnsKey(sid))) as any[] | undefined) ?? []
    const { value: classifierHealth } = await $.state.get({ plugin: 'tube-slide-router', key: 'classifierHealth' })
    const jevSummary =
      c.config.classifierMode === 'shadow' || c.config.classifierMode === 'assist'
        ? summarizeJevComparisons(((await $.store.get(jevKey(sid))) as any[] | undefined) ?? [])
        : undefined
    const usageRows = ((await $.store.get(usageKey(sid))) as any[] | undefined) ?? []
    const status = statusText({
      config: c.config, settings: s, spentTodayUsd: await spentToday($), turns, errors: c.errors, configSource: c.configSource, classifierHealth, jevSummary,
      downgradeNotes: downgradeAdvisories(c.calStats, c.config.downgrade), bandNotes: bandAdvisories(c.bandStats, c.config.bandCalibration),
      usage: latestUsage(usageRows),
    })
    if (arg === 'status') return { text: status }
    await setPane($, arg === 'setup' ? 'welcome' : 'status', draftFrom(c.config))
    const opened = await $.ui.open({ id: PANE, title: 'Tube Slide Router', focus: true }).catch(() => null)
    if (opened && 'isPlaced' in opened && opened.isPlaced) return { text: '' }
    return { text: `${status}\n\n(패널을 그릴 자리가 없어 글로 보여드립니다. 창을 넓히면 패널이 열립니다.)\n\n${HELP}` }
  })

  on('command.run', { command: 'tsr-docs' }, async ($, e) => {
    const root = await $.session.root()
    const files = [...INSTRUCTION_FILES, 'README.md']
    if (e.args.trim() === 'all') {
      const entries = await $.fs.list(`${root}/docs`).catch(() => [])
      for (const en of entries) if (en.kind === 'file' && en.name.endsWith('.md')) files.push(`docs/${en.name}`)
    }
    const results = []
    for (const file of files) {
      const abs = `${root}/${file}`
      if (!(await $.fs.exists(abs).catch(() => false))) continue
      const text = await $.fs.read(abs).catch(() => '')
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
      const refs = referencedPaths(text)
      const missing = []
      for (const p of refs) {
        const fromRoot = await $.fs.exists(`${root}/${p}`).catch(() => false)
        const fromDir = dir ? await $.fs.exists(`${root}/${dir}/${p}`).catch(() => false) : false
        if (!fromRoot && !fromDir) missing.push(p)
      }
      results.push({ file, checked: refs.length, missing })
    }
    return { text: docsReport(results) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, (async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e) as any
    const c = await ensureCtx($)
    const { value } = await $.state.get({ plugin: 'tube-slide-router', key: 'pane' })
    const view = value?.view ?? 'status'
    const draft: PaneDraft = value?.draft ?? draftFrom(c.config)
    const go = (v: string, d: PaneDraft = draft) => void setPane($, v, d)
    const close = () => void $.ui.close({ id: PANE }).catch(() => {})
    const col = (...children: unknown[]) => h(Box, { flexDirection: 'column', gap: 1 }, ...children)
    const row = (...children: unknown[]) => h(Box, { flexDirection: 'row', gap: 2 }, ...children)
    const options = (list: readonly (string | number)[], fmt = (v: string | number) => String(v)) => list.map((v) => ({ value: String(v), label: fmt(v) }))

    if (view === 'welcome') {
      return col(
        h(Text, { mono: true }, LOGO),
        h(Text, { dimColor: true }, TAGLINE),
        h(Text, { bold: true }, '처음 오셨네요. 라우팅을 어떻게 시작할까요?'),
        h(Button, { key: 'auto', variant: 'primary', onPress: () => go('budget', { ...draft, mode: 'auto', routes: structuredClone(DEFAULTS.routes) as PaneDraft['routes'] }) }, '자동 모드 (추천) — 기본 등급표로 바로 시작'),
        h(Button, { key: 'manual', onPress: () => go('tiers', { ...draft, mode: 'manual' }) }, '수동 설정 — 등급별 모델·effort를 직접 고름'),
        h(Button, { key: 'later', role: 'dismiss', onPress: close }, '나중에 (자동 모드로 시작)'),
      )
    }
    if (view === 'tiers') {
      return col(
        h(Text, { bold: true }, 'Tube Slide Router › 수동 설정'),
        h(Text, { dimColor: true }, '각 난이도에 어떤 모델·effort를 쓸지 정하세요. 기본값이 채워져 있어요.'),
        ...TIERS.map((t: Tier) =>
          col(
            h(Text, {}, `${t}  ${tierHint(t)}`),
            row(
              h(Select, { key: `model-${t}`, label: '모델', value: draft.routes[t].model, options: options(MODELS), onSelect: (v: string) => go('tiers', { ...draft, routes: { ...draft.routes, [t]: { ...draft.routes[t], model: v } } }) }),
              h(Select, { key: `effort-${t}`, label: 'effort', value: draft.routes[t].effort, options: options(EFFORTS), onSelect: (v: string) => go('tiers', { ...draft, routes: { ...draft.routes, [t]: { ...draft.routes[t], effort: v } } }) }),
            ),
          ),
        ),
        h(Text, { dimColor: true }, '작업 종류별 세부 조정은 아직 없습니다(다음 버전).'),
        row(
          h(Button, { key: 'next', variant: 'primary', onPress: () => go('budget') }, '다음'),
          h(Button, { key: 'auto', onPress: () => go('budget', { ...draft, mode: 'auto', routes: structuredClone(DEFAULTS.routes) as PaneDraft['routes'] }) }, '자동 모드로'),
        ),
      )
    }
    if (view === 'budget') {
      const b = draft.budget
      const setB = (patch: Partial<PaneDraft['budget']>) => go('budget', { ...draft, budget: { ...b, ...patch } })
      return col(
        h(Text, { bold: true }, 'Tube Slide Router › 예산 가드 (선택)'),
        h(Text, {}, '하루 사용량이 많아지면 자동으로 등급 상한을 낮출까요?'),
        h(Select, { key: 'enabled', label: '예산 가드', value: b.enabled ? 'on' : 'off', options: [{ value: 'off', label: '사용 안함' }, { value: 'on', label: '사용함' }], onSelect: (v: string) => setB({ enabled: v === 'on' }) }),
        b.enabled
          ? col(
              h(Select, { key: 'daily', label: '하루 예산', value: String(b.dailyUsd), options: options([5, 10, 20, 50, 100], (v) => `$${v}`), onSelect: (v: string) => setB({ dailyUsd: Number(v) }) }),
              h(Select, { key: 'warn', label: '경고 임계치 (이 선부터 상 이상 제한)', value: String(b.warnPct), options: options([50, 60, 70, 80], (v) => `${v}%`), onSelect: (v: string) => setB({ warnPct: Number(v) }) }),
              h(Select, { key: 'save', label: '절전 임계치 (이 선부터 하 이하)', value: String(b.savePct), options: options([80, 90, 95], (v) => `${v}%`), onSelect: (v: string) => setB({ savePct: Number(v) }) }),
            )
          : null,
        h(Text, { dimColor: true }, '예산과 상관없이 최상위 등급을 쓰고 싶을 땐 /tsr-router hungry (가칭)'),
        row(
          h(Button, { key: 'save', variant: 'primary', onPress: () => void saveProfile($, draft).then(() => go('done')).catch(() => go('error')) }, '저장하고 시작'),
          h(Button, { key: 'skip', onPress: () => void saveProfile($, { ...draft, budget: { ...b, enabled: false } }).then(() => go('done')).catch(() => go('error')) }, '예산 가드 없이 저장'),
        ),
      )
    }
    if (view === 'done' || view === 'error') {
      return col(
        h(Text, { bold: true }, view === 'done' ? '설정 완료 ✓' : '설정 파일을 쓰지 못했습니다. 기본값으로 계속 동작합니다.'),
        h(Text, {}, routeLine(c.config.routes)),
        h(Text, {}, '지금부터 작업 난이도에 맞춰 자동 전환됩니다. 나중에 /tsr-router 로 다시 열 수 있어요.'),
        h(Button, { key: 'close', variant: 'primary', role: 'dismiss', onPress: close }, '닫기'),
      )
    }
    const { value: settings } = await $.state.get({ plugin: 'tube-slide-router', key: 'settings' })
    const sid = await $.session.id()
    const turns = ((await $.store.get(turnsKey(sid))) as any[] | undefined) ?? []
    const { value: classifierHealth } = await $.state.get({ plugin: 'tube-slide-router', key: 'classifierHealth' })
    const jevSummary =
      c.config.classifierMode === 'shadow' || c.config.classifierMode === 'assist'
        ? summarizeJevComparisons(((await $.store.get(jevKey(sid))) as any[] | undefined) ?? [])
        : undefined
    const usageRows = ((await $.store.get(usageKey(sid))) as any[] | undefined) ?? []
    const text = statusText({
      config: c.config, settings: settings ?? {}, spentTodayUsd: await spentToday($), turns, errors: c.errors, configSource: c.configSource, classifierHealth, jevSummary,
      downgradeNotes: downgradeAdvisories(c.calStats, c.config.downgrade), bandNotes: bandAdvisories(c.bandStats, c.config.bandCalibration),
      usage: latestUsage(usageRows),
    })
    return col(
      h(Text, { bold: true }, 'Tube Slide Router'),
      h(Text, {}, text),
      row(
        h(Button, { key: 'setup', onPress: () => go('welcome', draftFrom(c.config)) }, '설정 다시 하기'),
        h(Button, { key: 'toggle', onPress: () => void $.state.set({ plugin: 'tube-slide-router', key: 'settings' }, { ...(settings ?? {}), off: !settings?.off }) }, settings?.off ? '라우팅 켜기' : '이 세션 라우팅 끄기'),
        h(Button, { key: 'close', role: 'dismiss', onPress: close }, '닫기'),
      ),
    )
  }) as any)
}
