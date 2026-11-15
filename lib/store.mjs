// Pure: the keys the mod keeps in $.store, what to prune, and the calibration counts.
// One writer per key: each session writes only keys that carry its own session id.
//   tsr-turns:<session>         turn records (newest RECORD_CAP)
//   tsr-steps:<session>         per-request usage (newest STEP_CAP)
//   tsr-cost:<YYYY-MM-DD>:<session>  that session's spend on that local day, USD
//   tsr-cal:<session>           { updatedAt, tiers: { tier: { turns, escalated } } }
//   tsr-jev:<session>           Jev shadow comparison records (labels/agreement only, see lib/jev.mjs)
//   tsr-usage:<session>         session.measure snapshots (rate-limit %, host cost ledger — see lib/usage.mjs)
import { BANDS, TIERS } from './config.mjs'

export const turnsKey = (sid) => `tsr-turns:${sid}`
export const stepsKey = (sid) => `tsr-steps:${sid}`
export const calKey = (sid) => `tsr-cal:${sid}`
export const costKey = (day, sid) => `tsr-cost:${day}:${sid}`
export const jevKey = (sid) => `tsr-jev:${sid}`
export const usageKey = (sid) => `tsr-usage:${sid}`

export const localDay = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const costKeysOf = (keys, day) => keys.filter((k) => k.startsWith(`tsr-cost:${day}:`))

// /tsr-router reset: wipes every session's turn/step/calibration/cost/Jev record on this
// machine — e.g. before real use starts, so dev-time test runs never pollute calibration.
// Never touches the config files; those are reset by hand (they are files, not $.store keys).
export const RESET_PREFIXES = ['tsr-turns:', 'tsr-steps:', 'tsr-cal:', 'tsr-jev:', 'tsr-cost:', 'tsr-usage:']
export const resettableKeys = (keys) => keys.filter((k) => RESET_PREFIXES.some((p) => k.startsWith(p)))
export const resetSummary = (keys) =>
  Object.fromEntries(RESET_PREFIXES.map((p) => [p, keys.filter((k) => k.startsWith(p)).length]))

const DAY = 24 * 60 * 60 * 1000
export const PRUNE = { sessionDays: 30, maxSessions: 100, costDays: 7, calDays: 90 }

// `entries` is [{ key, lastAt }] for tsr-turns/tsr-steps/tsr-cal/tsr-usage keys; lastAt null when unreadable.
// Unreadable records are never named: a later version may have written them.
export const keysToPrune = ({ keys, entries, now, own }) => {
  const out = new Set()
  for (const k of keys) {
    if (!k.startsWith('tsr-cost:')) continue
    const day = k.split(':')[1]
    const t = Date.parse(`${day}T00:00:00`)
    if (Number.isFinite(t) && now - t > PRUNE.costDays * DAY && !k.endsWith(`:${own}`)) out.add(k)
  }
  const bySession = new Map()
  for (const { key, lastAt } of entries) {
    if (lastAt === null || lastAt === undefined) continue
    const sid = key.slice(key.indexOf(':') + 1)
    if (sid === own) continue
    const limit = key.startsWith('tsr-cal:') ? PRUNE.calDays : PRUNE.sessionDays
    if (now - lastAt > limit * DAY) out.add(key)
    if (!key.startsWith('tsr-cal:')) bySession.set(sid, Math.max(bySession.get(sid) ?? 0, lastAt))
  }
  const newest = [...bySession.entries()].sort((a, b) => b[1] - a[1])
  for (const [sid] of newest.slice(PRUNE.maxSessions)) {
    out.add(turnsKey(sid))
    out.add(stepsKey(sid))
    out.add(jevKey(sid))
    out.add(usageKey(sid))
  }
  return [...out]
}

export const emptyCal = () => Object.fromEntries(TIERS.map((t) => [t, { turns: 0, escalated: 0 }]))

// Counts a finished turn under the tier it was first routed to.
export const addToCal = (tiers, record) => {
  const tier = record.predicted
  if (!TIERS.includes(tier) || record.aborted) return tiers
  const next = structuredClone(tiers)
  next[tier].turns += 1
  if (record.escalated) next[tier].escalated += 1
  return next
}

export const sumCals = (list) => {
  const out = emptyCal()
  for (const tiers of list) {
    if (!tiers || typeof tiers !== 'object') continue
    for (const t of TIERS) {
      const v = tiers[t]
      if (!v || !Number.isFinite(v.turns) || !Number.isFinite(v.escalated)) continue
      out[t].turns += v.turns
      out[t].escalated += v.escalated
    }
  }
  return out
}

// Assist mode's tier×band aggregation (H. step 4): not read by any decision yet — collected
// now so a later band-threshold calibration (H. step 5) has real outcome data to tune against,
// the same way ④'s calibratedTier needed turns to build up before it could be enabled. Stored
// as `tsr-cal:<session>`'s `bands` field, alongside the existing per-tier `tiers` (see addToCal).
export const emptyBandCal = () => Object.fromEntries(TIERS.map((t) => [t, Object.fromEntries(BANDS.map((b) => [b, { turns: 0, escalated: 0 }]))]))

// Counts a finished turn under its tier and assist's band, when the turn has one (only assist
// mode, outside hungry mode, ever sets record.band — see policy.mjs's decideRoute).
export const addToBandCal = (bands, record) => {
  const tier = record.predicted
  const band = record.band
  if (!TIERS.includes(tier) || !BANDS.includes(band) || record.aborted) return bands
  const next = structuredClone(bands)
  next[tier][band].turns += 1
  if (record.escalated) next[tier][band].escalated += 1
  return next
}

export const sumBandCals = (list) => {
  const out = emptyBandCal()
  for (const bands of list) {
    if (!bands || typeof bands !== 'object') continue
    for (const t of TIERS) {
      for (const b of BANDS) {
        const v = bands[t]?.[b]
        if (!v || !Number.isFinite(v.turns) || !Number.isFinite(v.escalated)) continue
        out[t][b].turns += v.turns
        out[t][b].escalated += v.escalated
      }
    }
  }
  return out
}
