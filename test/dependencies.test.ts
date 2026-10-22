import { describe, expect, it } from 'vitest'
import { parseDependencies } from '../src/github/dependencies.js'

describe('parseDependencies', () => {
  it('parses blocked-by and blocks phrases', () => {
    const r = parseDependencies([
      'This is blocked by #12 and depends on #15.',
      'Also blocks #99.',
    ])
    expect(r.blockedBy).toEqual([12, 15])
    expect(r.blocks).toEqual([99])
  })

  it('deduplicates and sorts', () => {
    const r = parseDependencies(['blocked by #3', 'depends on #3', 'blocked by #1'])
    expect(r.blockedBy).toEqual([1, 3])
  })
})
