-- ============================================================
-- AI 中心 2.0 Migration 016
-- 创建 certified_organization（认证机构主档）
-- 任务包：§4.1 P0 业务事实表
-- 文件：016_certified_organization.sql
-- 创建时间：2026-08-29
-- ============================================================

-- ============================================================
-- 1. 新建 certified_organization 表
-- ============================================================
CREATE TABLE IF NOT EXISTS certified_organization (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT,

    -- 基本信息
    code VARCHAR(50) NOT NULL,                        -- 机构代码（如 CNAS-001, CNCA-A）
    name VARCHAR(200) NOT NULL,                       -- 机构全称
    short_name VARCHAR(100),                          -- 简称
    org_type VARCHAR(50) NOT NULL DEFAULT 'cert_body', -- cert_body / lab / inspection_body / accreditation_body
    country_code CHAR(2) DEFAULT 'CN',                -- ISO 3166-1 alpha-2

    -- 资质信息
    accreditation_no VARCHAR(100),                    -- 认可号（如 CNAS C164-M）
    accreditation_scope TEXT,                         -- 认可范围
    valid_from DATE,                                  -- 资质起始
    valid_until DATE,                                 -- 资质到期

    -- 联系信息
    contact_person VARCHAR(100),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(200),
    address TEXT,
    website VARCHAR(500),

    -- 关联
    signing_entity_id UUID REFERENCES signing_entity(id), -- 关联签约主体（华中/中认宁夏/外协）

    -- 状态与元信息
    status VARCHAR(20) NOT NULL DEFAULT 'active',     -- active / suspended / expired / archived
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================
-- 2. 唯一约束
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_certified_org_company_code
    ON certified_organization(company_id, code)
    WHERE deleted_at IS NULL;

-- ============================================================
-- 3. 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_certified_org_company
    ON certified_organization(company_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_certified_org_type
    ON certified_organization(company_id, org_type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_certified_org_signing
    ON certified_organization(signing_entity_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 4. 同步到 partner_cert_unit（兼容层）
-- 任务包 §3.1 保留：partner_cert_unit 不删除
-- 任务包 §4.1 新增：certified_organization 是主档
-- ============================================================
-- 备注：partner_cert_unit 仍然保留，
-- 通过视图 partner_cert_unit_v2 关联到 certified_organization（type=cert_body）
-- 视图实现在 P0-A 第 7 步

-- ============================================================
-- 5. 数据初始化（从已有数据种子）
-- ============================================================
-- 种子 1：华中国际认证检验集团有限公司（主机构）
INSERT INTO certified_organization (
    company_id, code, name, short_name, org_type,
    accreditation_no, country_code, status,
    signing_entity_id, created_by
)
SELECT
    c.id,
    'HZ-CN-001',
    '华中国际认证检验集团有限公司',
    '华中认证',
    'cert_body',
    'CNAS-C164-M',
    'CN',
    'active',
    se.id,
    NULL
FROM company c
LEFT JOIN signing_entity se ON se.company_id = c.id AND se.entity_code = 'HZ' AND se.deleted_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM certified_organization
    WHERE company_id = c.id AND code = 'HZ-CN-001'
)
LIMIT 1
ON CONFLICT DO NOTHING;

-- 种子 2：中认认证有限公司宁夏分公司
INSERT INTO certified_organization (
    company_id, code, name, short_name, org_type,
    accreditation_no, country_code, status,
    signing_entity_id, created_by
)
SELECT
    c.id,
    'ZR-CN-NX-001',
    '中认认证有限公司宁夏分公司',
    '中认宁夏',
    'cert_body',
    'CNAS-C164-M-NX',
    'CN',
    'active',
    se.id,
    NULL
FROM company c
LEFT JOIN signing_entity se ON se.company_id = c.id AND se.entity_code = 'ZR' AND se.deleted_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM certified_organization
    WHERE company_id = c.id AND code = 'ZR-CN-NX-001'
)
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. 迁移记录（写入 project_event 类型 audit_log）
-- ============================================================
-- 注：当前 DB 无 schema_migrations 表，使用一次性查询验证
DO $$
DECLARE
    cert_org_count INT;
    hz_count INT;
    zr_count INT;
BEGIN
    SELECT COUNT(*) INTO cert_org_count FROM certified_organization WHERE deleted_at IS NULL;
    SELECT COUNT(*) INTO hz_count FROM certified_organization WHERE code = 'HZ-CN-001' AND deleted_at IS NULL;
    SELECT COUNT(*) INTO zr_count FROM certified_organization WHERE code = 'ZR-CN-NX-001' AND deleted_at IS NULL;
    RAISE NOTICE 'Migration 016 完成: 总 % 个机构, 华中认证 % 个, 中认宁夏 % 个', cert_org_count, hz_count, zr_count;
END
$$;
