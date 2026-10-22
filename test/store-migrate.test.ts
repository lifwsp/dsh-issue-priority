import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileStore, emptyState, migrateLegacyDataDir } from '../src/store.js'

describe('legacy data dir (dsh-issue-priority) carry-over', () => {
  it('copies the old directory once and keeps the original', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwp-'))
    const legacy = join(root, 'data', 'dsh-issue-priority')
    const target = join(root, 'data', 'dsh-work-planner')
    mkdirSync(legacy, { recursive: true })
    const old = { ...emptyState('o/r'), syncedUntil: '2026-10-01T00:00:00Z' }
    writeFileSync(join(legacy, 'o__r.json'), JSON.stringify(old))

    const store = createFileStore(target, 2000, migrateLegacyDataDir(target, legacy))
    expect(await store.listRepos()).toEqual(['o/r'])
    const state = await store.load('o/r')
    expect(state.syncedUntil).toBe('2026-10-01T00:00:00Z')
    expect(state.outcomes).toEqual([])
    expect(JSON.parse(readFileSync(join(legacy, 'o__r.json'), 'utf8')).repo).toBe('o/r')

    // Already migrated: never copies again (new data wins).
    expect(await migrateLegacyDataDir(target, legacy)).toBe(false)
  })

  it('does nothing without a legacy directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwp-'))
    expect(await migrateLegacyDataDir(join(root, 'new'), join(root, 'old'))).toBe(false)
  })
})
