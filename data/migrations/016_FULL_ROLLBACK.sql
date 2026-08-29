-- ============================================================
-- Migration 016 ROLLBACK: 全部回滚
-- 任务包 §P0-A 第 10 步
-- ============================================================

-- 016c 回滚
DROP VIEW IF EXISTS finance_transaction_null_customer CASCADE;

-- 016b 回滚（无需操作，016b 只是 UPDATE，不创建新对象）

-- 016a 回滚
DROP VIEW IF EXISTS finance_project_v2 CASCADE;

-- 016 回滚
-- 注意：016b 已经把 HZ-CN-001/ZR-CN-NX-001 的 signing_entity_id 设回了正确值
-- 但 016 创建表时 INSERT 用 LEFT JOIN，所以 signing_entity_id 是 NULL
-- 016b 只是 UPDATE 修复这个，不影响回滚

-- DELETE 种子
DELETE FROM certified_organization
WHERE code IN ('HZ-CN-001', 'ZR-CN-NX-001')
  AND deleted_at IS NULL;

-- DROP 索引
DROP INDEX IF EXISTS uq_certified_org_company_code;
DROP INDEX IF EXISTS idx_certified_org_company;
DROP INDEX IF EXISTS idx_certified_org_type;
DROP INDEX IF EXISTS idx_certified_org_signing;

-- DROP 表
DROP TABLE IF EXISTS certified_organization CASCADE;

-- 验证
DO $$
DECLARE
    table_exists BOOLEAN;
    view_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'certified_organization'
    ) INTO table_exists;

    SELECT EXISTS(
        SELECT 1 FROM information_schema.views
        WHERE table_name IN ('finance_project_v2', 'finance_transaction_null_customer')
    ) INTO view_exists;

    IF table_exists THEN
        RAISE EXCEPTION 'Rollback FAILED: certified_organization 仍存在';
    ELSE
        RAISE NOTICE 'Rollback SUCCESS: certified_organization 已删除';
    END IF;

    IF view_exists THEN
        RAISE EXCEPTION 'Rollback FAILED: 视图仍存在';
    ELSE
        RAISE NOTICE 'Rollback SUCCESS: 视图已删除';
    END IF;
END
$$;
