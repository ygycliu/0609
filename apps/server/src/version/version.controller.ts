/**
 * /api/version 路由控制器
 *
 * 提供只读版本信息端点，无认证、无权限要求
 */
import { Router } from "express";
import { getVersionInfo } from "./version.service.js";

export function createVersionRouter(): Router {
  const router = Router();

  router.get("/api/version", (_request, response) => {
    const info = getVersionInfo();
    response.json(info);
  });

  return router;
}
