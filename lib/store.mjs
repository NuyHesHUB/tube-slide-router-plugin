// Pure: the keys the mod keeps in $.store, what to prune, and the calibration counts.
// One writer per key: each session writes only keys that carry its own session id.
//   tsr-turns:<session>         turn records (newest RECORD_CAP)
//   tsr-steps:<session>         per-request usage (newest STEP_CAP)
//   tsr-cost:<YYYY-MM-DD>:<projHash>:<session>  that session's spend on that local day, that
//                                                project, USD
//   tsr-cal:<projHash>:<session>  { updatedAt, tiers: { tier: { turns, escalated } } }
//   tsr-jev:<session>           Jev shadow comparison records (labels/agreement only, see lib/jev.mjs)
//   tsr-usage:<session>         session.measure snapshots (rate-limit %, host cost ledger — see lib/usage.mjs)
//
// `projHash` (2026-11-15): `$.store` is one JSON file per plugin, not per project (confirmed in
// benchmark/project-scoping-DESIGN.md) — tsr-cal/tsr-cost used to have no project identity at
// all, so a session on an unrelated project's calibration/spend silently counted toward every
// other project's. `projectHash` below gives each project root its own short, stable segment in
// just these two prefixes (the only two ever aggregated across sessions — see loadCtx/spentToday
// in hooks/register.ts). tsr-turns/tsr-steps/tsr-jev/tsr-usage are read back only for the current
// session's own key, never aggregated across sessions, so they had no cross-project leak to begin
// with and are deliberately left unscoped (day stays right after the prefix in tsr-cost so
// keysToPrune's existing day-extraction below needs no change).
import { BANDS, TIERS } from './config.mjs'

export const turnsKey = (sid) => `tsr-turns:${sid}`
export const stepsKey = (sid) => `tsr-steps:${sid}`
export const calKey = (projHash, sid) => `tsr-cal:${projHash}:${sid}`
export const costKey = (day, projHash, sid) => `tsr-cost:${day}:${projHash}:${sid}`
export const jevKey = (sid) => `tsr-jev:${sid}`
export const usageKey = (sid) => `tsr-usage:${sid}`

// A short, stable, non-cryptographic identifier for a project root (FNV-1a, 32-bit, 8 hex
// chars) — just a $.store namespace discriminator, not a security boundary, and deliberately not
// `node:crypto` (this module runs inside the engine's sandboxed hook worker, which has no Node
// builtins — see plugin-authoring skill: "The module has no DOM or Node"). Path-based: the same
// repository checked out at a second path (a worktree, a second clone) gets a different hash and
// so a separate calibration/budget scope — a known limitation, not a bug (see README.md).
export const projectHash = (root) => {
  let h = 0x811c9dc5
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const localDay = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const costKeysOf = (keys, day, projHash) => keys.filter((k) => k.startsWith(`tsr-cost:${day}:${projHash}:`))

// /tsr-router reset: by default wipes every session's turn/step/Jev/usage record on this machine
// (those carry no project identity — see the module doc comment above) PLUS this project's own
// calibration/cost records — never another project's, now that those carry `projHash`. Never
// touches the config files; those are reset by hand (they are files, not $.store keys).
export const RESET_PREFIXES = ['tsr-turns:', 'tsr-steps:', 'tsr-cal:', 'tsr-jev:', 'tsr-cost:', 'tsr-usage:']
const DEVICE_WIDE_RESET_PREFIXES = ['tsr-turns:', 'tsr-steps:', 'tsr-jev:', 'tsr-usage:']

// `tsr-cal:<projHash>:<sid>` → projHash is the segment right after the prefix; `tsr-cost:
// <day>:<projHash>:<sid>` → it's the second segment (index 2, after the prefix's own `tsr-cost`
// and the day). Any other prefix is device-wide and always kept.
const matchesProject = (key, projHash) => {
  if (key.startsWith('tsr-cal:')) return key.split(':')[1] === projHash
  if (key.startsWith('tsr-cost:')) return key.split(':')[2] === projHash
  return true
}

export const resettableKeys = (keys, projHash) =>
  keys.filter((k) => (DEVICE_WIDE_RESET_PREFIXES.some((p) => k.startsWith(p)) || (RESET_PREFIXES.some((p) => k.startsWith(p)) && matchesProject(k, projHash))))
export const resetSummary = (keys, projHash) =>
  Object.fromEntries(RESET_PREFIXES.map((p) => [p, keys.filter((k) => k.startsWith(p) && (DEVICE_WIDE_RESET_PREFIXES.includes(p) || matchesProject(k, projHash))).length]))

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
    // The session id is always the LAST colon-separated segment — true whether the key has one
    // segment after its prefix (tsr-turns/tsr-steps/tsr-jev/tsr-usage) or two (tsr-cal:<projHash>:
    // <sid>, since 2026-11-15); `indexOf` alone would have read `<projHash>:<sid>` as the "sid"
    // for a cal key and never matched `own`, below.
    const sid = key.slice(key.lastIndexOf(':') + 1)
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
