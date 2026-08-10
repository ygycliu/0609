import { describe, expect, it } from "vitest";
import { assertProductionRuntimeOwnership } from "./runtime-ownership.js";

describe("assertProductionRuntimeOwnership", () => {
  it("allows development startup without a runtime owner", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "development",
        runtimeOwner: undefined,
        platform: "linux"
      })
    ).not.toThrow();
  });

  it("rejects production startup without a runtime owner", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: undefined,
        platform: "linux"
      })
    ).toThrow(/direct startup is not allowed/);
  });

  it("rejects an unexpected production runtime owner", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "hermes",
        platform: "linux"
      })
    ).toThrow(/direct startup is not allowed/);
  });

  it("rejects a Linux production process outside the service cgroup", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "systemd",
        platform: "linux",
        cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/hermes-gateway.service"
      })
    ).toThrow(/cgroup ownership check failed/);
  });

  it("does not accept a service-name substring in another cgroup segment", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "systemd",
        platform: "linux",
        cgroup:
          "0::/user.slice/user-1000.slice/user@1000.service/app.slice/not-ai-consulting-center.service-worker"
      })
    ).toThrow(/cgroup ownership check failed/);
  });

  it("allows the systemd-owned Linux production service", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "systemd",
        platform: "linux",
        cgroup:
          "0::/user.slice/user-1000.slice/user@1000.service/app.slice/ai-consulting-center.service"
      })
    ).not.toThrow();
  });

  it("allows a marked non-Linux production service", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "systemd",
        platform: "win32"
      })
    ).not.toThrow();
  });
});
