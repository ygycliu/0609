-- ============================================================
-- AI 中心 2.0 Migration 016 ROLLBACK
-- 回滚 certified_organization
-- 任务包：§10 回滚方案
-- 文件：016_certified_organization_ROLLBACK.sql
-- ============================================================

-- 1. 删除视图（如果有）
DROP VIEW IF EXISTS certified_organization_v CASCADE;

-- 2. 删除种子数据（先恢复种子）
DELETE FROM certified_organization
WHERE code IN ('HZ-CN-001', 'ZR-CN-NX-001')
  AND deleted_at IS NULL;

-- 3. 删除索引
DROP INDEX IF EXISTS uq_certified_org_company_code;
DROP INDEX IF EXISTS idx_certified_org_company;
DROP INDEX IF EXISTS idx_certified_org_type;
DROP INDEX IF EXISTS idx_certified_org_signing;

-- 4. 删除表
DROP TABLE IF EXISTS certified_organization CASCADE;

-- ============================================================
-- 验证回滚成功
-- ============================================================
DO $$
DECLARE
    table_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'certified_organization'
    ) INTO table_exists;

    IF table_exists THEN
        RAISE EXCEPTION 'Rollback FAILED: certified_organization 仍存在';
    ELSE
        RAISE NOTICE 'Rollback SUCCESS: certified_organization 已删除';
    END IF;
END
$$;
