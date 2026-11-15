// Pure: Context Collector bounds, secret masking and cache-key logic (P3, see HANDOFF.md
// section Y for the design). No `$` here — hooks/register.ts does the $.fs reads, the
// $.clock.sleep timeout race, and holds the cache in $.state, the same split classifier.mjs
// and jev.mjs already use for their own `$`-touching halves.

// Order matters: a private-key block is matched as one block first so a narrower pattern
// below (e.g. "key") never re-matches a fragment left behind inside an already-redacted block.
const SECRET_PATTERNS = [
  { name: 'private-key', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi },
  // Covers `API_KEY = "..."`, `password: '...'`, `secret=...` and similar assignments —
  // deliberately broad since missing a real credential is worse than over-redacting a label.
  { name: 'credential-assignment', re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*(['"]?)[^\s'",;]{6,}\1/gi },
]

// Replaces every match with a placeholder naming only the pattern, never the matched value —
// so a secret can never round-trip into a cache entry, a log line or the classifier prompt,
// even truncated or partially. Applied before anything else touches the file's text (see
// collectContext in hooks/register.ts).
export const maskSecrets = (text) => {
  let masked = String(text)
  let redacted = 0
  for (const { name, re } of SECRET_PATTERNS) {
    masked = masked.replace(re, () => {
      redacted += 1
      return `[REDACTED:${name}]`
    })
  }
  return { text: masked, redacted }
}

// A rough, clearly-labeled estimate (chars/4) — never presented as a measured token count,
// only a cheap budget gate. Matches this project's rule against inventing measured numbers.
export const estimateTokens = (text) => Math.ceil(String(text).length / 4)

// Applies maxFiles, then maxBytes/maxTokens cumulatively over already-masked candidates, in
// the order given. Stops adding once either budget would be exceeded — never includes a file
// partially, since a half-file is more likely to misdirect the classifier than to help it.
export const bindFiles = (candidates, limits) => {
  const limited = candidates.slice(0, limits.maxFiles)
  const included = []
  let bytes = 0
  let tokens = 0
  let truncated = limited.length < candidates.length
  for (const file of limited) {
    const fBytes = file.text.length
    const fTokens = estimateTokens(file.text)
    if (bytes + fBytes > limits.maxBytes || tokens + fTokens > limits.maxTokens) {
      truncated = true
      break
    }
    included.push(file)
    bytes += fBytes
    tokens += fTokens
  }
  return { included, truncated, bytesUsed: bytes, tokensUsed: tokens }
}

// What the classifier sees in addition to the request text. null when nothing survived the
// bounds (nothing to add — not a failure, see HANDOFF.md section Y on the failure/empty split).
export const collectorNote = (included) => {
  if (!included.length) return null
  const blocks = included.map((f) => `--- ${f.path} ---\n${f.text}`)
  return `다음은 요청이 가리킨 파일 중 일부입니다(비밀 값은 가려짐, 상한 적용):\n${blocks.join('\n\n')}`
}

// A cheap, deterministic fingerprint (DJB2-style) of the raw file content actually read for
// this collection — not a security hash, a change detector. Taken over the pre-mask text so
// an edit that only touches a secret's value still invalidates the cache: masking only
// decides what is shown, never what counts as "changed".
export const fingerprint = (rawFiles) => {
  let h = 5381
  for (const f of rawFiles) {
    const s = `${f.path}\u0000${f.text.length}\u0000${f.text}`
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

export const pathsSignature = (paths) => [...new Set(paths)].sort().join('|')

// A deterministic signature of every bound a reload can change (maxFiles, maxBytes, maxTokens,
// timeoutMs) — fixed key list, not Object.keys(limits), so key order in the config object can
// never shift the signature. Without this, a cache entry keyed only on paths + raw-content hash
// would survive a reload that tightens (or loosens) a bound: same paths, same raw content, but
// a smaller maxBytes/maxTokens must still force a rebuild, since bindFiles' output depends on
// all four numbers, not just on what was read.
export const limitsSignature = (limits) =>
  ['maxFiles', 'maxBytes', 'maxTokens', 'timeoutMs'].map((k) => `${k}:${limits[k]}`).join('|')

// True only when the path set, the raw-content fingerprint, AND the limits signature all match
// the cache entry — so any edit to a collected file (committed or not), or any reload that
// changes maxFiles/maxBytes/maxTokens/timeoutMs, invalidates it. There is no commit-aware state
// to go stale against in the first place: a committed change and an uncommitted one look
// identical here on purpose (both are just "the text changed").
export const cacheIsFresh = (cached, signature, hash, limitsSig) =>
  Boolean(cached && cached.signature === signature && cached.hash === hash && cached.limitsSignature === limitsSig)

// The one step a fresh cache entry exists to let a matching turn skip: masking every candidate
// and applying the four bounds. Takes already-read raw (pre-mask) files, same as fingerprint —
// never raw text, only this function's output (the masked, bounded note) is safe to cache.
export const buildNote = (raw, limits) => {
  const masked = raw.map((f) => ({ path: f.path, text: maskSecrets(f.text).text }))
  const bound = bindFiles(masked, limits)
  return { note: collectorNote(bound.included), truncated: bound.truncated }
}

// The cache's one read path: a hit returns the already-masked, already-bounded note straight
// from the cache entry — the caller never calls buildNote (so never re-runs maskSecrets or
// bindFiles) on a hit. A miss (no entry yet, or signature/hash/limits no longer match) returns
// null; the caller is expected to call buildNote itself and store the fresh result as the new
// entry.
export const resolveCachedNote = (cached, signature, hash, limitsSig) =>
  cacheIsFresh(cached, signature, hash, limitsSig) ? { note: cached.note, truncated: cached.truncated } : null
