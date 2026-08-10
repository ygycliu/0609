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
  if (runtime.nodeEnv !== "production") return;

  if (runtime.runtimeOwner !== SYSTEMD_RUNTIME_OWNER) {
    throw new Error(
      `Production runtime must be started by ${PRODUCTION_SERVICE}; direct startup is not allowed.`
    );
  }

  if (runtime.platform !== "linux") return;

  const belongsToProductionService = runtime.cgroup
    ?.split(/\r?\n/)
    .some((line) => line.split(":").at(-1)?.split("/").includes(PRODUCTION_SERVICE));

  if (!belongsToProductionService) {
    throw new Error(
      `Production runtime must run inside ${PRODUCTION_SERVICE}; cgroup ownership check failed.`
    );
  }
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
