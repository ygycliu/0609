-- ============================================================
-- Migration 022: risk_level 表（风险等级枚举）
-- 任务包：V2.0 业务主线 - 报价系统支持灵活风险等级
-- 日期：2026-08-30
-- ============================================================

-- 风险等级表（替代 quote.service.ts 中的硬编码 RISK_LEVEL_OPTIONS）
CREATE TABLE risk_level (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,        -- 内部 code（如 medium/high/low）
    label VARCHAR(100) NOT NULL,      -- 显示名称
    description TEXT,                  -- 详细描述
    -- 审核员级别（用于报价公式）
    auditor_level VARCHAR(20) NOT NULL DEFAULT 'intermediate',  -- intermediate / senior
    -- 倍率（影响审核费）
    multiplier NUMERIC(8, 4) NOT NULL DEFAULT 1.0000,
    -- 排序
    sort_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active/inactive
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    deleted_at TIMESTAMPTZ
);

-- 唯一约束：同一公司 code 唯一
CREATE UNIQUE INDEX uq_risk_level_company_code
    ON risk_level(company_id, code)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_risk_level_company ON risk_level(company_id);
CREATE INDEX idx_risk_level_status ON risk_level(status);

-- 注释
COMMENT ON TABLE risk_level IS '认证项目风险等级（可录入）。替代硬编码的 RISK_LEVEL_OPTIONS。';
COMMENT ON COLUMN risk_level.auditor_level IS '审核员级别：intermediate（中级）/ senior（高级）';
COMMENT ON COLUMN risk_level.multiplier IS '审核费倍率（用于报价计算）';

-- ============================================================
-- 迁移：将现有硬编码风险等级迁移到表
-- ============================================================

-- 默认公司 ID
DO $$
DECLARE
    v_company_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- 中级（中等风险，常规行业）
    INSERT INTO risk_level (company_id, code, label, description, auditor_level, multiplier, sort_order)
    VALUES (v_company_id, 'medium', '中级（常规行业）', '适用于一般制造业、服务业等常规行业', 'intermediate', 1.0000, 1)
    ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO NOTHING;

    -- 高级（高风险行业）
    INSERT INTO risk_level (company_id, code, label, description, auditor_level, multiplier, sort_order)
    VALUES (v_company_id, 'high', '高级（高风险行业）', '适用于化工、石油、矿业等高风险行业', 'senior', 1.5000, 2)
    ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO NOTHING;

    -- 低级（简单行业，新加）
    INSERT INTO risk_level (company_id, code, label, description, auditor_level, multiplier, sort_order)
    VALUES (v_company_id, 'low', '初级（简单行业）', '适用于批发零售、轻工等低复杂度行业', 'intermediate', 0.8500, 0)
    ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO NOTHING;
END $$;
