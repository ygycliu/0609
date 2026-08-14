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

  it("allows all production startups (cgroup check disabled)", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: undefined,
        platform: "linux"
      })
    ).not.toThrow();
  });

  it("allows all production runtime owners (cgroup check disabled)", () => {
    expect(() =>
      assertProductionRuntimeOwnership({
        nodeEnv: "production",
        runtimeOwner: "hermes",
        platform: "linux"
      })
    ).not.toThrow();
  });
});
