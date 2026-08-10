import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../");
const production = process.env.NODE_ENV === "production";

function requiredInProduction(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (production) {
    throw new Error(`${name} is required when NODE_ENV=production`);
  }
  return "";
}

export const config = {
  production,
  host: process.env.HOST?.trim() || "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  defaultModel: process.env.DEFAULT_MODEL ?? "demo",
  databaseUrl: requiredInProduction("DATABASE_URL"),
  jwtSecret: requiredInProduction("JWT_SECRET"),
  jwtExpiryHours: Number(process.env.JWT_EXPIRY_HOURS ?? 8),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  dataDir: path.join(projectRoot, "data"),
  uploadsDir: path.join(projectRoot, "data", "uploads"),
  webDist: path.join(projectRoot, "apps", "web", "dist"),
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL ?? "qwen2.5:7b"
  }
} as const;
