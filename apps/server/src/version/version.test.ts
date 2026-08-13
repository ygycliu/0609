/**
 * /api/version 端点测试
 *
 * 验证：
 * 1. 返回 HTTP 200
 * 2. 字段包含 service、version、commit
 * 3. 版本信息可追溯
 * 4. 不需要认证
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { getVersionInfo, resetVersionCache } from "./version.service.js";
import { createVersionRouter } from "./version.controller.js";

describe("version.service", () => {
  beforeEach(() => {
    resetVersionCache();
  });

  it("返回 service / version / commit 三个字段", () => {
    const info = getVersionInfo();
    expect(info).toHaveProperty("service");
    expect(info).toHaveProperty("version");
    expect(info).toHaveProperty("commit");
    expect(typeof info.service).toBe("string");
    expect(typeof info.version).toBe("string");
    expect(typeof info.commit).toBe("string");
  });

  it("service 字段非空字符串", () => {
    const info = getVersionInfo();
    expect(info.service.length).toBeGreaterThan(0);
  });

  it("version 字段符合 semver 或 '0.0.0' 兜底", () => {
    const info = getVersionInfo();
    const isSemver = /^\d+\.\d+\.\d+/.test(info.version);
    expect(isSemver).toBe(true);
  });

  it("commit 字段在无 GIT_COMMIT 时为 'unknown'", () => {
    delete process.env.GIT_COMMIT;
    resetVersionCache();
    const info = getVersionInfo();
    expect(info.commit).toBe("unknown");
  });

  it("commit 字段在有 GIT_COMMIT 时使用环境变量值", () => {
    process.env.GIT_COMMIT = "abc1234";
    resetVersionCache();
    const info = getVersionInfo();
    expect(info.commit).toBe("abc1234");
    delete process.env.GIT_COMMIT;
  });
});

describe("createVersionRouter", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    resetVersionCache();
    const app = express();
    app.use(createVersionRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address && typeof address === "object") {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error("Failed to get server address");
    }
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/version 返回 HTTP 200", async () => {
    const response = await fetch(`${baseUrl}/api/version`);
    expect(response.status).toBe(200);
  });

  it("返回 JSON 格式数据", async () => {
    const response = await fetch(`${baseUrl}/api/version`);
    const data = await response.json();
    expect(data).toBeTypeOf("object");
    expect(data.service).toBeDefined();
    expect(data.version).toBeDefined();
    expect(data.commit).toBeDefined();
  });

  it("GET /api/version 不需要认证", async () => {
    // 此端点为只读查询，不需要任何认证或权限
    const response = await fetch(`${baseUrl}/api/version`);
    expect(response.status).toBe(200);
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it("响应头 Content-Type 为 application/json", async () => {
    const response = await fetch(`${baseUrl}/api/version`);
    const contentType = response.headers.get("content-type") || "";
    expect(contentType).toMatch(/application\/json/);
  });
});
