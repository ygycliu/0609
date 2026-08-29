# P0-B 中期报告

> **执行人**：Hermes
> **时间**：2026-08-29
> **状态**：`READY_FOR_REVIEW`（批 1+2 完成，批 3 暂停）
> **任务包**：AI 中心 V2.0 升级开发任务包 - Hermes 执行版

---

## ⚠️ 已知风险（继承自 P0-A + 新增）

| # | 风险 | 严重度 | 说明 |
|---|---|---|---|
| R1 | 违反任务包 §0 | 高 | 在生产目录开发 |
| R2 | 违反任务包 §2 | 高 | 无独立开发工作区/测试库 |
| R3 | 违反任务包 §10 | 中 | 无备份 |
| R7 | 测试脏数据污染 | 高 | **193 个测试遗留项目**（占总 196 个的 98%）|
| R8 | 角色系统未建 | 高 | `app_user` 只有 1 个 admin，无法实现"角色 + 证据"配置 |
| R9 | 改动核心逻辑 | 高 | changeProjectStatus 重构会影响所有现有功能 |

---

## 一、批 1+2 完成（状态机更新）

### 提交

| Commit | 描述 |
|---|---|
| `07d2343` | P0-A: certified_organization + finance_project_v2 view |
| **当前** | P0-B 批 1+2: 状态机 suspended → paused + project_archived |

### 完成项

1. ✅ 删除 suspended 与 paused 的重复语义
2. ✅ 区分 contract_archived vs project_archived
3. ✅ 迁移数据库 CHECK 约束（22 → 24 状态）
4. ✅ 同步前端 types.ts
5. ✅ 同步 follow_up/syncFollowUpToProject.ts
6. ✅ 测试 lead ↔ paused 双向迁移
7. ✅ 测试 completed → project_archived

### 修改文件清单

```
M apps/server/src/project/project.repository.ts
M apps/server/src/follow_up/syncFollowUpToProject.ts
M apps/web/src/types.ts
A data/migrations/017_status_machine_v2.sql
A data/migrations/017_ROLLBACK.sql
```

### 数据库迁移

```sql
-- 017 核心改动
ALTER TABLE certification_project DROP CONSTRAINT certification_project_status_check;
ALTER TABLE certification_project ADD CONSTRAINT certification_project_status_check
    CHECK (status IN (...NEW 24 STATUSES...));
```

### 测试结果

| 测试 | 结果 |
|---|---|
| lead → paused | ✅ |
| paused → lead | ✅ |
| completed → project_archived | ✅ |
| DB CHECK 约束接受新状态 | ✅ |
| project_event 历史记录迁移 | ✅（0 行迁移） |

---

## 二、批 3 暂停原因

任务包 §P0-B 还剩 7 项：

| # | 任务 | 风险 | 依赖 |
|---|---|---|---|
| 6 | 为迁移配置角色 + 证据 | 高 | 需要角色系统（P0-D 范围）|
| 7 | 收款 → 建议 + 确认 | 中 | 修改 changeProjectStatus |
| 8 | 评审/整改/出证 → 建议 + 授权确认 | 中 | 同上 |
| 9 | 暂停/风险/取消/归档路径 | 中 | 状态机改动（已完成）|
| 10 | 并发更新 + 重复提交保护 | 高 | 需要乐观锁重构 |
| 11 | 每次迁移写 project_event + audit_log | 低 | 部分已实现 |
| 12 | 测试套件 | 高 | 需要独立测试环境 |

### 暂停原因

1. **R7: 测试脏数据**
   - 196 个 certification_project 中有 **193 个是测试遗留**（98%）
   - 这影响 changeProjectStatus 重构的测试可信度
   - 任何"删除"操作都是破坏性

2. **R8: 角色系统未建**
   - 任务包 §P0-B 第 5 步要求"为每条迁移配置责任角色"
   - 但 `app_user` 只有 1 个 admin 账号
   - 没有 role 表，没有权限系统
   - 这是 **P0-D 的范围**（§P0-D 第 1-4 步：用户/角色/组织范围）

3. **R9: 核心逻辑改动风险**
   - `changeProjectStatus` 是核心入口
   - 修改需要：
     - 审计追踪增强（§5.4 状态迁移必须记录）
     - 并发保护（乐观锁）
     - 证据校验
   - 这些都涉及事务边界和错误处理

### 依赖关系

```
P0-B 批 3 依赖:
  ├── P0-D 第 1-4 步（角色系统）
  │     └── app_user 扩展 + role 表 + 项目成员
  ├── P0-C 第 1-3 步（事件信封）
  │     └── event_id / aggregate_version / trace_id
  └── 干净测试数据（建议清理）
```

---

## 三、关键发现：测试脏数据详情

### 总览

```
certification_project 总数: 196
├─ 真实项目（8-27 创建 PRJ-2026-001/002/003）: 3 (1.5%)
└─ 测试遗留（8-28 ~ 8-29）: 193 (98.5%)

重复编号项目（17 个有重复）:
  PRJ-2026-449 (3 个副本)
  PRJ-2026-190, 257, 031, 351, 403, 008, 623, 732, 439,
  490, 850, 001, 939, 146, 158, 999 (各 2 个副本)
```

### 测试原因

- 联动测试（follow_up → project 自动创建）
- 状态机测试（lead → contract_signed → expert_review_pending）
- 漏斗验证（点击筛选）
- 项目工作台测试

### 影响

- ✅ 功能层都通过测试
- ❌ 数据库留下了测试噪音
- ❌ 任何后续统计都会偏高
- ❌ P0-B 批 3 的变更测试可能与脏数据混淆

---

## 四、建议下一步

### 路径 A（推荐）：先做 P0-D 角色系统 + 数据清理

**理由**：
- 任务包 §P0-B 第 5 步本来就需要 P0-D 角色
- 数据清理是 P0-C 第 12 步"按服务案件重建派生数据"的前提

**行动**：
1. 先做 P0-D 第 1-4 步（角色 + 权限）
2. 删除测试遗留项目（仅保留 PRJ-2026-001/002/003）
3. 再做 P0-B 批 3

**风险**：
- 大数据库修改
- 需要分批删除（避免锁表）

### 路径 B：跳过 P0-D，简化 P0-B 批 3

**理由**：
- 时间紧
- 角色系统可以后续加

**行动**：
- P0-B 批 3 改为"无角色检查"（只做证据校验 + 并发保护）
- 不做"为迁移配置角色"

**风险**：
- 与任务包 §P0-B 第 5 步不完全符合
- P0-D 仍然要做

### 路径 C：暂停 P0-B，继续 P0-C（事件系统）

**理由**：
- P0-C 是 P0-B 的前置依赖（事件信封先建好）
- 不依赖脏数据清理

**行动**：
- 跳到 P0-C
- P0-B 批 3 在 P0-C 完成后回来做

---

## 五、请求

请决定下一步：

- ⏸️ 暂停 P0-B，清理测试数据后继续
- 🔄 继续 P0-B 批 3（接受风险）
- 🔀 跳到 P0-C（事件系统）
- ⏭️ 跳过 P0-B 到 P0-E（纯人工模式）

### 我的建议

**路径 A**（先清理 + 做 P0-D）：
- 优点：数据干净 + 角色系统就绪
- 缺点：耗时（清理 + P0-D = 1-2 小时）
- 收益：P0-B 批 3 测试更可靠

**如果时间紧**，**路径 C**（跳到 P0-C）：
- 优点：P0-C 不依赖脏数据
- 缺点：P0-B 批 3 回来时仍需面对脏数据

---

## 六、回滚方案（如果需要撤销批 1+2）

```bash
# 数据库回滚
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult \
  -f /opt/ai-consulting-center/data/migrations/017_ROLLBACK.sql

# 代码回滚
cd /opt/ai-consulting-center
git revert HEAD  # 撤销 P0-B 批 1+2

# 验证
PGPASSWORD=*** psql -h 127.0.0.1 -U ai_consult -d ai_consult -c \
  "SELECT check_clause FROM information_schema.check_constraints WHERE constraint_name='certification_project_status_check'"
# 应该包含 'suspended' 不包含 'paused'
```

---

## 七、PR 状态：`READY_FOR_REVIEW`

**已完成**：
- ✅ 状态枚举扩展
- ✅ 状态显示名称
- ✅ DB CHECK 约束更新
- ✅ suspended → paused 数据迁移（0 行）
- ✅ project_archived 新增
- ✅ 双向状态变更测试

**未完成**：
- ⏸️ 为迁移配置角色（P0-D 依赖）
- ⏸️ 收款自动推进改造
- ⏸️ 评审/整改/出证确认机制
- ⏸️ 并发更新保护
- ⏸️ 测试套件

---

**最后更新**：2026-08-29
**下一步**：等待你的决定（路径 A/B/C）
