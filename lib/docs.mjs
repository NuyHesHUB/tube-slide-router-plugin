// Pure: ⑦ /tsr-docs. Finds the file paths an instruction or docs file names, so the hook can
// check each one exists. It only flags references that no longer resolve; whether the prose
// is still true is beyond it.

export const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']

const EXT = /\.(md|mdx|js|mjs|cjs|ts|tsx|jsx|json|ya?ml|py|go|rs|java|kt|sql|sh|toml|css|html)$/i

const looksLikePath = (s) => {
  if (!s || s.length > 200 || /\s/.test(s)) return false
  if (/^[a-z]+:\/\//i.test(s) || s.startsWith('#') || s.startsWith('~') || s.startsWith('$')) return false
  if (/[<>*{}|`"'()]/.test(s)) return false
  if (s.startsWith('/') || s.startsWith('-') || s.startsWith('@')) return false
  return s.includes('/') || EXT.test(s)
}

// Strips a trailing line locator (`file.mjs:123` or `file.mjs:6-56`, a common citation style
// in this project's own docs) before the path is checked — the number isn't part of the path.
const clean = (s) => s.replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '').replace(/[:,.;]+$/, '').replace(/#.*$/, '')

// Returns the distinct relative paths a markdown text names in code spans or links.
export const referencedPaths = (markdown) => {
  const out = new Set()
  const text = String(markdown).replace(/```[\s\S]*?```/g, '')
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const s = clean(m[1].trim())
    if (looksLikePath(s)) out.add(s)
  }
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const s = clean(m[1].trim())
    if (looksLikePath(s)) out.add(s)
  }
  return [...out]
}

export const docsReport = (results) => {
  const stale = results.filter((r) => r.missing.length)
  if (!results.length) return '검사할 지시 파일(CLAUDE.md, AGENTS.md 등)을 찾지 못했습니다.'
  const lines = [`검사한 파일 ${results.length}개, 참조 ${results.reduce((n, r) => n + r.checked, 0)}개.`]
  if (!stale.length) lines.push('존재하지 않는 경로를 가리키는 참조는 없습니다.')
  for (const r of stale) {
    lines.push(`\n${r.file}: 없는 경로 ${r.missing.length}개`)
    for (const p of r.missing) lines.push(`  - ${p}`)
  }
  lines.push('\n참고: 경로가 존재하는지만 봅니다. 설명 내용이 맞는지는 판단하지 않습니다.')
  return lines.join('\n')
}
