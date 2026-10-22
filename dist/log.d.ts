/** Structured logging that never echoes credentials. */
export type LogLevel = 'silent' | 'warn' | 'info' | 'debug';
export interface Logger {
    warn(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    debug(message: string, fields?: Record<string, unknown>): void;
}
export declare function createLogger(base: {
    warn?: (m: string) => void;
    info?: (m: string) => void;
    debug?: (m: string) => void;
} | Console, level: LogLevel, prefix?: string): Logger;
//# sourceMappingURL=log.d.ts.map