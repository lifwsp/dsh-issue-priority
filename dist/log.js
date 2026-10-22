/** Structured logging that never echoes credentials. */
const SECRET_KEY = /(?:token|password|secret|authorization|api[_-]?key|credential)/i;
const SECRET_VALUE = /(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9]+|ts_live_[A-Za-z0-9]+)/g;
function redactValue(value) {
    if (typeof value === 'string') {
        return value.replace(SECRET_VALUE, '[REDACTED]');
    }
    if (Array.isArray(value))
        return value.map(redactValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redactValue(v);
        }
        return out;
    }
    return value;
}
function format(message, fields) {
    if (!fields || Object.keys(fields).length === 0)
        return message;
    return `${message} ${JSON.stringify(redactValue(fields))}`;
}
const ORDER = { silent: 0, warn: 1, info: 2, debug: 3 };
export function createLogger(base, level, prefix = '[dsh-work-planner]') {
    const enabled = (min) => ORDER[level] >= ORDER[min];
    const write = (fn, fallback, message, fields) => {
        const line = `${prefix} ${format(message, fields)}`;
        (fn ?? fallback).call(base, line);
    };
    return {
        warn(message, fields) {
            if (enabled('warn'))
                write(base.warn?.bind(base), console.warn, message, fields);
        },
        info(message, fields) {
            if (enabled('info'))
                write(base.info?.bind(base), console.info, message, fields);
        },
        debug(message, fields) {
            if (enabled('debug'))
                write(base.debug?.bind(base), console.debug, message, fields);
        },
    };
}
//# sourceMappingURL=log.js.map