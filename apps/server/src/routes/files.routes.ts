/**
 * 文件浏览路由（/api/files/*）
 *
 * 业务：浏览 / 上传 / 下载 / 删除 / 创建子目录，所有操作限定在 FILES_ROOT (/mnt/renz)
 *
 * 拆分前：app.ts L336-527（168 行，5 个端点）
 * 拆分后：本文件 + app.ts 一行 app.use("/api/files", createFilesRouter({ getUserFromReq }))
 *
 * 依赖：
 *  - getUserFromReq(request) — 从 express.Request 抽取 UserRecord，401 if absent
 *  - upload — multer 实例（200MB 限制）
 *  - FILES_ROOT 写死为 /mnt/renz（与拆分前一致）
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { NotFoundError, ValidationError } from "../shared/errors.js";

const FILES_ROOT = "/mnt/renz";

function resolveSafePath(relative: string): string {
  // 空路径 = 根目录（合法）
  if (relative == null) throw new ValidationError("路径无效");
  if (typeof relative !== "string") throw new ValidationError("路径无效");
  if (relative.includes("\0")) throw new ValidationError("路径包含非法字符");
  const normalized = path.posix.normalize(relative).replace(/^[/\\]+/, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new ValidationError("禁止跳出根目录");
  }
  const abs = path.join(FILES_ROOT, normalized);
  const real = path.resolve(abs);
  const rootReal = path.resolve(FILES_ROOT);
  if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
    throw new ValidationError("禁止跳出根目录");
  }
  return real;
}

export interface FilesRouterDeps {
  getUserFromReq: (request: express.Request) => unknown;
  upload: multer.Multer;
}

export function createFilesRouter(deps: FilesRouterDeps) {
  const { getUserFromReq, upload } = deps;
  const router = express.Router();

  // 1. 列出目录
  router.get("/list", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      const abs = resolveSafePath(relative);

      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        throw new NotFoundError("目录");
      }
      if (!stat.isDirectory()) throw new ValidationError("不是目录");

      const entries = await fs.readdir(abs, { withFileTypes: true });
      const items: any[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const fullPath = path.join(abs, e.name);
        const rel = path.posix.join(relative, e.name);
        try {
          const st = await fs.stat(fullPath);
          items.push({
            name: e.name,
            path: rel,
            isDir: e.isDirectory(),
            size: e.isDirectory() ? 0 : st.size,
            modifiedAt: st.mtime.toISOString(),
          });
        } catch {
          /* ignore */
        }
      }

      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-Hans-CN");
      });

      const breadcrumbs = relative
        ? relative.split("/").filter(Boolean).map((part: string, i: number, arr: string[]) => ({
            name: part,
            path: arr.slice(0, i + 1).join("/"),
          }))
        : [];

      response.json({
        data: {
          path: relative,
          breadcrumbs,
          parent: relative ? relative.split("/").slice(0, -1).join("/") : null,
          items,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // 2. 上传文件
  router.post("/upload", upload.single("file"), async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      if (!request.file) throw new ValidationError("请选择文件");
      const target = (request.body?.path as string) || "";
      const absDir = resolveSafePath(target);
      let stat;
      try {
        stat = await fs.stat(absDir);
      } catch {
        throw new NotFoundError("目标目录");
      }
      if (!stat.isDirectory()) throw new ValidationError("目标不是目录");

      const originalName = request.file.originalname;
      let final = path.join(absDir, originalName);
      let n = 1;
      while (true) {
        try {
          await fs.access(final);
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          final = path.join(absDir, `${base} (${n})${ext}`);
          n++;
        } catch {
          break;
        }
      }

      await fs.writeFile(final, request.file.buffer);

      response.status(201).json({
        data: {
          name: path.basename(final),
          path: path.posix.join(target, path.basename(final)),
          size: request.file.size,
          sizeBytes: request.file.size,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // 3. 下载文件
  router.get("/download", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      const abs = resolveSafePath(relative);
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        throw new NotFoundError("文件");
      }
      if (!stat.isFile()) throw new ValidationError("不是文件");

      const originalName = path.basename(abs);
      // RFC 6266 兼容 + 防 header 注入
      const safeAscii = originalName
        .replace(/[\r\n"]/g, "_") // 移除危险字符
        .replace(/[^\x20-\x7E]/g, "_"); // 非 ASCII 替换为 _
      const encoded = encodeURIComponent(originalName);
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", stat.size);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
      );
      // 用流避免 sendFile 兼容问题
      const stream = fsSync.createReadStream(abs);
      stream.on("error", (err: NodeJS.ErrnoException) => {
        console.error("[files/download] stream error:", err);
        if (!response.headersSent) next(err);
      });
      stream.pipe(response);
    } catch (error) {
      next(error);
    }
  });

  // 4. 删除
  router.delete("/delete", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const relative = (request.query.path as string) || "";
      if (!relative) throw new ValidationError("路径必填");
      const abs = resolveSafePath(relative);
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        throw new NotFoundError("文件");
      }
      if (abs === path.resolve(FILES_ROOT)) {
        throw new ValidationError("禁止删除根目录");
      }

      if (stat.isDirectory()) {
        await fs.rm(abs, { recursive: true, force: true });
      } else {
        await fs.unlink(abs);
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // 5. 创建子目录
  router.post("/mkdir", async (request, response, next) => {
    try {
      const u = getUserFromReq(request);
      if (!u) throw new ValidationError("未登录");
      const { path: parent = "", name } = request.body || {};
      if (!name || typeof name !== "string") throw new ValidationError("目录名必填");
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new ValidationError("目录名包含非法字符");
      }
      const absParent = resolveSafePath(parent);
      const target = path.join(absParent, name);
      const realTarget = path.resolve(target);
      const rootReal = path.resolve(FILES_ROOT);
      if (!realTarget.startsWith(rootReal + path.sep)) {
        throw new ValidationError("禁止跳出根目录");
      }

      await fs.mkdir(target, { recursive: false });
      response.status(201).json({
        data: { name, path: path.posix.join(parent, name) },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}