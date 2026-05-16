import { LogLevel } from "./fdw.types";

const levelRank: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface FdwLogger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export function createFdwLogger(context: string, level: LogLevel = "error"): FdwLogger {
  const shouldLog = (messageLevel: LogLevel): boolean => {
    return levelRank[messageLevel] <= levelRank[level];
  };

  const print = (method: "error" | "warn" | "info" | "debug", ...args: unknown[]) => {
    if (!shouldLog(method)) {
      return;
    }

    const prefix = `[${context}]`;
    console[method](prefix, ...args);
  };

  return {
    error: (...args: unknown[]) => print("error", ...args),
    warn: (...args: unknown[]) => print("warn", ...args),
    info: (...args: unknown[]) => print("info", ...args),
    debug: (...args: unknown[]) => print("debug", ...args),
  };
}
