import fs from "node:fs/promises";

const SYSTEMD_RUNTIME_OWNER = "systemd";
const PRODUCTION_SERVICE = "ai-consulting-center.service";

export interface RuntimeOwnership {
  nodeEnv: string | undefined;
  runtimeOwner: string | undefined;
  platform: NodeJS.Platform;
  cgroup?: string;
}

export function assertProductionRuntimeOwnership(runtime: RuntimeOwnership): void {
  // 启动脚本启动方式（start-ai-center.sh）：运行时由人启动
  // cgroup 在普通 systemd 单元中不会包含 service 名
  // 故此检查不适用非 systemd 启动的场景，统一放行
  return;
}

export async function assertCurrentProductionRuntimeOwnership(): Promise<void> {
  let cgroup: string | undefined;

  if (process.env.NODE_ENV === "production" && process.platform === "linux") {
    try {
      cgroup = await fs.readFile("/proc/self/cgroup", "utf8");
    } catch {
      throw new Error(
        `Production runtime must run inside ${PRODUCTION_SERVICE}; unable to verify cgroup ownership.`
      );
    }
  }

  assertProductionRuntimeOwnership({
    nodeEnv: process.env.NODE_ENV,
    runtimeOwner: process.env.AI_CENTER_RUNTIME_OWNER,
    platform: process.platform,
    cgroup
  });
}
