// Pure: list prices in USD per million tokens, and what one model request cost.
// Source: https://platform.claude.com/docs/en/about-claude/pricing.md, as copied from
// alexei-led/claude-router lib/prices.mjs (checked 2026-11-04), re-checked 2026-11-10 by
// fetching that page directly. Every number here (including cacheRead and the Haiku 5x
// long-context tier, both unconfirmed as of the first 2026-11-10 pass) matches the official
// page exactly: Opus cacheRead $0.20/MTok (0.05x input, a model-specific rate per that page's
// footnote — not the 0.1x most other models get), Sonnet cacheRead $0.10/MTok (same 0.05x
// footnote), Haiku cacheRead $0.01/MTok (0.1x, the general rate).
// Haiku 5.5 bills every rate (input/output/cacheRead/write alike) at 5x when the prompt is over
// 100,000 tokens — confirmed against the page's own split table for that tier.
//
// Cache writes (ticket 14, mod/HANDOFF.md, 2026-11-10): the official page prices a 5-minute
// cache write at 1.25x base input and a 1-hour one at 2x, uniformly across Opus/Sonnet/Haiku —
// confirmed directly against the page's table, not a guess. This file CANNOT tell which one a
// request used: the usage this plugin is actually handed (ModelUsage/TurnUsage in
// .claude-plugin/types/claude-code/index.d.ts, the same shape turn.step's `result.usage` and
// recordStep pass in here) carries only one merged `cache_creation_input_tokens` count, with no
// ephemeral_1h/5m split — that split exists only in --debug's raw API response and in this
// repo's own unrelated agent-tool types (claude-code-tools/index.d.ts), confirmed absent from
// claude-code/index.d.ts by grep. So WRITE_MULTIPLIER is set to the worse-case 2x on purpose:
// this estimate feeds the budget guard (lib/policy.mjs's budgetCeiling), and a safety cap must
// never silently under-count real spend the way 1.25x did on an actual 1-hour-cache turn
// (confirmed firsthand: tsr-cost read $0.00377395 against the engine's own real $0.0060172 for
// the same turn, matching 1.25x exactly while the engine's number matched 2x exactly) — the same
// "never under-route to save money" bias this project's other safety gates already take (see
// policy.mjs's risk floor). The cost: on the more common 5-minute-cache turn this overstates the
// true cost, so the budget guard may trip a little earlier than a perfectly accurate meter would
// — over-caution, not a silent miss, which is the failure mode this project accepts everywhere
// else too. 9-12차/ticket13's own $ comparisons never used this estimate at all (they read
// `claude -p --output-format json`'s own `total_cost_usd`), so they are unaffected either way.

export const PRICES_CHECKED = '2026-11-10'
const WRITE_MULTIPLIER = 2

const PRICES = {
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { input: 2, output: 10, cacheRead: 0.1 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, longContext: { above: 100000, multiplier: 5 } },
}

export const familyOf = (model) => {
  if (typeof model !== 'string') return null
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return null
}

// Null when the model has no price here: an unknown cost is not counted as zero.
export const requestCostUsd = (model, usage) => {
  const p = PRICES[familyOf(model)]
  if (!p || !usage) return null
  const input = usage.input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const write = usage.cache_creation_input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const prompt = input + read + write
  const m = p.longContext && prompt > p.longContext.above ? p.longContext.multiplier : 1
  return (m * (input * p.input + read * p.cacheRead + write * p.input * WRITE_MULTIPLIER + output * p.output)) / 1_000_000
}
