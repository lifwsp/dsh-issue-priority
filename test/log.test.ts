import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../src/log.js'

describe('createLogger', () => {
  it('redacts token-like fields and values', () => {
    const warn = vi.fn()
    const logger = createLogger({ warn, info: vi.fn(), debug: vi.fn() }, 'warn')
    logger.warn('auth', { authorization: 'Bearer ghp_secretvalue', note: 'ok' })
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain('[REDACTED]')
    expect(line).not.toContain('ghp_secretvalue')
    expect(line).toContain('ok')
  })
})
