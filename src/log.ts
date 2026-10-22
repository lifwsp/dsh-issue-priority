/** Structured logging that never echoes credentials. */

const SECRET_KEY = /(?:token|password|secret|authorization|api[_-]?key|credential)/i
const SECRET_VALUE =
  /(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9]+|ts_live_[A-Za-z0-9]+)/g

export type LogLevel = 'silent' | 'warn' | 'info' | 'debug'

export interface Logger {
  warn(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  debug(message: string, fields?: Record<string, unknown>): void
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE, '[REDACTED]')
  }
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redactValue(v)
    }
    return out
  }
  return value
}

function format(message: string, fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return message
  return `${message} ${JSON.stringify(redactValue(fields))}`
}

const ORDER: Record<LogLevel, number> = { silent: 0, warn: 1, info: 2, debug: 3 }

export function createLogger(
  base: { warn?: (m: string) => void; info?: (m: string) => void; debug?: (m: string) => void } | Console,
  level: LogLevel,
  prefix = '[dsh-work-planner]',
): Logger {
  const enabled = (min: LogLevel) => ORDER[level] >= ORDER[min]
  const write = (fn: ((m: string) => void) | undefined, fallback: (m: string) => void, message: string, fields?: Record<string, unknown>) => {
    const line = `${prefix} ${format(message, fields)}`
    ;(fn ?? fallback).call(base, line)
  }
  return {
    warn(message, fields) {
      if (enabled('warn')) write(base.warn?.bind(base), console.warn, message, fields)
    },
    info(message, fields) {
      if (enabled('info')) write(base.info?.bind(base), console.info, message, fields)
    },
    debug(message, fields) {
      if (enabled('debug')) write(base.debug?.bind(base), console.debug, message, fields)
    },
  }
}
