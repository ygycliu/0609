/**
 * 版本信息服务
 *
 * 提供应用版本信息（service / version / commit）
 * 来源：
 * - service:  package.json 的 name 字段
 * - version: package.json 的 version 字段
 * - commit:  process.env.GIT_COMMIT（构建时注入）或 "unknown"
 *
 * 兜底：所有字段都缺失时使用合理的默认值
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PackageInfo {
  name: string;
  version: string;
}

function readPackageInfo(): PackageInfo {
  // 从 src/version/ 向上找到 package.json
  // apps/server/src/version/version.service.ts → apps/server/package.json
  const candidates = [
    path.join(__dirname, "..", "..", "package.json"),   // apps/server/package.json
    path.join(__dirname, "..", "package.json"),         // apps/server/src/package.json
    path.join(__dirname, "package.json"),              // apps/server/src/version/package.json
  ];

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = JSON.parse(raw) as PackageInfo;
      if (parsed.name && parsed.version) {
        return parsed;
      }
    } catch {
      // 继续尝试下一个候选
    }
  }

  // 兜底默认值
  return {
    name: "ai-consulting-center",
    version: "0.0.0",
  };
}

export interface VersionInfo {
  service: string;
  version: string;
  commit: string;
}

let cached: VersionInfo | null = null;

export function getVersionInfo(): VersionInfo {
  if (cached) {
    return cached;
  }

  const pkg = readPackageInfo();
  cached = {
    service: pkg.name,
    version: pkg.version,
    commit: process.env.GIT_COMMIT ?? "unknown",
  };
  return cached;
}

/**
 * 重置缓存（仅用于测试）
 */
export function resetVersionCache(): void {
  cached = null;
}
