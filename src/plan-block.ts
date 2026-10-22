/**
 * `<!-- dsh-plan ... -->` block: the single schema used both by `issue_draft`
 * (validate + render) and by sync (parse). A block that fails validation is
 * treated as "no block" by the planner, never as a fatal error.
 */
import type { IssueSize, PlanBlock } from './types.js'

export const BLOCK_VERSION = 1 as const
const BLOCK_RE = /<!--\s*dsh-plan\b([\s\S]*?)-->/i
const SIZES: readonly IssueSize[] = ['S', 'M', 'L']
const AREA_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const MAX_FILES = 30
const MAX_ACCEPTANCE = 300

export interface PlanBlockInput {
  areas?: unknown
  size?: unknown
  files?: unknown
  dependsOn?: unknown
  acceptance?: unknown
}

export type ValidationResult =
  | { ok: true; block: PlanBlock }
  | { ok: false; errors: string[] }

function asStringList(value: unknown): string[] | null {
  if (value == null) return []
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  return null
}

/** Validate structured input against the v1 schema. */
export function validatePlanBlock(input: PlanBlockInput): ValidationResult {
  const errors: string[] = []

  const areas = asStringList(input.areas)
  if (!areas || areas.length === 0) errors.push('areas: 1 つ以上必要です')
  else {
    for (const a of areas) {
      if (!AREA_RE.test(a)) errors.push(`areas: "${a}" は小文字英数字とハイフン（32 文字以内）にしてください`)
    }
  }

  const sizeRaw = typeof input.size === 'string' ? input.size.trim().toUpperCase() : undefined
  if (!sizeRaw || !SIZES.includes(sizeRaw as IssueSize)) errors.push('size: S / M / L のいずれかが必要です')

  const files = asStringList(input.files)
  if (files === null) errors.push('files: 文字列の配列にしてください')
  else {
    if (files.length > MAX_FILES) errors.push(`files: ${MAX_FILES} 件以内にしてください`)
    for (const f of files) {
      if (f.startsWith('/') || f.includes('..')) errors.push(`files: "${f}" はリポジトリ相対パスにしてください`)
      if (/[\s,]/.test(f)) errors.push(`files: "${f}" に空白やカンマは使えません`)
    }
  }

  const depsRaw = asStringList(input.dependsOn)
  const dependsOn: number[] = []
  if (depsRaw === null) errors.push('dependsOn: Issue 番号の配列にしてください')
  else {
    for (const d of depsRaw) {
      const n = Number(d.replace(/^#/, ''))
      if (!Number.isInteger(n) || n <= 0) errors.push(`dependsOn: "${d}" は Issue 番号ではありません`)
      else dependsOn.push(n)
    }
  }

  let acceptance: string | undefined
  if (input.acceptance != null) {
    if (typeof input.acceptance !== 'string') errors.push('acceptance: 文字列にしてください')
    else {
      acceptance = input.acceptance.replace(/\s+/g, ' ').trim()
      if (acceptance.includes('--')) errors.push('acceptance: "--" は使えません（HTML コメントが壊れるため）')
      if (acceptance.length > MAX_ACCEPTANCE) errors.push(`acceptance: ${MAX_ACCEPTANCE} 文字以内にしてください`)
      if (!acceptance) acceptance = undefined
    }
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    block: {
      v: BLOCK_VERSION,
      areas: [...new Set(areas!)],
      size: sizeRaw as IssueSize,
      files: [...new Set(files!)],
      dependsOn: [...new Set(dependsOn)].sort((a, b) => a - b),
      ...(acceptance ? { acceptance } : {}),
    },
  }
}

function renderList(values: readonly (string | number)[]): string {
  return `[${values.join(', ')}]`
}

/** Render the block as an HTML comment (invisible on GitHub). */
export function renderPlanBlock(block: PlanBlock): string {
  const lines = ['<!-- dsh-plan', `v: ${block.v}`, `areas: ${renderList(block.areas)}`, `size: ${block.size}`]
  if (block.files.length) lines.push(`files: ${renderList(block.files)}`)
  if (block.dependsOn.length) lines.push(`dependsOn: ${renderList(block.dependsOn)}`)
  if (block.acceptance) lines.push(`acceptance: ${block.acceptance}`)
  lines.push('-->')
  return lines.join('\n')
}

function parseValue(raw: string): string | string[] {
  const v = raw.trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  return v.replace(/^["']|["']$/g, '')
}

export type ParseResult =
  | { found: false }
  | { found: true; ok: true; block: PlanBlock }
  | { found: true; ok: false; errors: string[] }

/** Extract and validate the block from an Issue body. */
export function parsePlanBlock(body: string): ParseResult {
  const match = body.match(BLOCK_RE)
  if (!match) return { found: false }
  const fields: Record<string, string | string[]> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*)$/)
    if (!m) continue
    fields[m[1]!] = parseValue(m[2]!)
  }
  if (String(fields.v ?? '') !== String(BLOCK_VERSION)) {
    return { found: true, ok: false, errors: [`v: ${String(fields.v ?? '(なし)')} は未対応のバージョンです`] }
  }
  const result = validatePlanBlock({
    areas: fields.areas,
    size: fields.size,
    files: fields.files,
    dependsOn: fields.dependsOn,
    acceptance: fields.acceptance,
  })
  return result.ok ? { found: true, ok: true, block: result.block } : { found: true, ok: false, errors: result.errors }
}

/** Remove the block so judgment input carries only human-written text. */
export function stripPlanBlock(body: string): string {
  return body.replace(BLOCK_RE, '').trim()
}

/** Append (or replace) the block at the end of a body. */
export function attachPlanBlock(body: string, block: PlanBlock): string {
  const base = stripPlanBlock(body)
  return `${base}${base ? '\n\n' : ''}${renderPlanBlock(block)}\n`
}
