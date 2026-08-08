import pino, { type DestinationStream } from "pino";

export const sensitiveLogPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie"
] as const;

export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [...sensitiveLogPaths],
        censor: "[REDACTED]"
      }
    },
    destination
  );
}
