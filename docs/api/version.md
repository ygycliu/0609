# GET /api/version

## 概述

返回应用的版本信息（服务名、版本号、Git 提交号）。用于：

- 健康检查时确认服务运行版本
- 部署验证时确认代码版本
- 故障排查时定位具体 commit
- 客户端显示当前版本

## 端点信息

| 项目 | 值 |
|---|---|
| **URL** | `/api/version` |
| **方法** | `GET` |
| **认证** | 不需要 |
| **权限** | 不需要 |
| **限流** | 无 |
| **CORS** | 允许 |
| **幂等性** | 是 |

## 响应

### 状态码

- `200 OK` — 成功

### 响应头

```
Content-Type: application/json
```

### 响应体

```json
{
  "service": "ai-consulting-center",
  "version": "1.5.0",
  "commit": "abc1234"
}
```

### 字段说明

| 字段 | 类型 | 说明 | 来源 |
|---|---|---|---|
| `service` | string | 应用包名 | `package.json` 的 `name` 字段 |
| `version` | string | 语义化版本号 | `package.json` 的 `version` 字段 |
| `commit` | string | Git 提交号（短 SHA）| `process.env.GIT_COMMIT` |

### commit 字段的特殊值

- `abc1234` — 实际 Git 提交号（短 SHA，前 7 位）
- `unknown` — 当 `GIT_COMMIT` 环境变量未设置时

## 数据来源可追溯性

| 字段 | 物理位置 | 设置方式 |
|---|---|---|
| `service` | `apps/server/package.json` → `name` | 手动维护 |
| `version` | `apps/server/package.json` → `version` | 手动维护（按 semver） |
| `commit` | `process.env.GIT_COMMIT` | 构建时由 CI/CD 注入 |

### Git Commit 注入示例

**Bash**:
```bash
GIT_COMMIT=$(git rev-parse --short HEAD) npm start
```

**GitHub Actions**:
```yaml
- name: Build with commit
  env:
    GIT_COMMIT: ${{ github.sha }}
  run: npm run build && npm start
```

**GitLab CI**:
```yaml
build:
  variables:
    GIT_COMMIT: $CI_COMMIT_SHORT_SHA
  script:
    - npm run build
    - npm start
```

## 错误码

| 状态码 | 含义 | 触发条件 |
|---|---|---|
| 200 | 成功 | 正常返回版本信息 |
| 500 | 服务异常 | 服务内部错误（极少见）|

## 示例

### curl

```bash
curl -i http://localhost:3001/api/version
```

**响应**:
```http
HTTP/1.1 200 OK
Content-Type: application/json
{
  "service": "ai-consulting-center",
  "version": "1.0.0",
  "commit": "abc1234"
}
```

### JavaScript (fetch)

```javascript
const response = await fetch('/api/version');
const data = await response.json();
console.log(`Service: ${data.service}, Version: ${data.version}, Commit: ${data.commit}`);
```

### Python (requests)

```python
import requests
response = requests.get("http://localhost:3001/api/version")
data = response.json()
print(f"Service: {data['service']}, Version: {data['version']}, Commit: {data['commit']}")
```

## 设计说明

### 为什么需要版本信息接口？

1. **健康检查** — 监控系统确认服务运行的版本
2. **部署验证** — 上线后确认代码版本
3. **故障排查** — 报告问题时附带版本号
4. **客户端显示** — 在 UI 角落显示版本号（透明度）

### 为什么只读？

- 不需要认证：版本信息不是敏感数据
- 不需要权限：所有用户都可以查看
- 不修改数据：仅返回静态信息
- 不影响业务：与现有功能完全隔离

### 为什么不用现有 /health 接口？

`/health` 端点返回：
```json
{ "status": "ok", "service": "ai-digital-consulting-center" }
```

但只有 `status` 和 `service` 字段，没有版本号和 commit。新增 `/api/version` 提供更详细的版本信息。

## 变更历史

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | 2026-08-13 | 首次实现（feature/version-info 分支） |

## 相关文件

- 服务实现：`apps/server/src/version/version.service.ts`
- 路由控制器：`apps/server/src/version/version.controller.ts`
- 单元测试：`apps/server/src/version/version.test.ts`
- 路由注册：`apps/server/src/app.ts`（createApp 函数内）
