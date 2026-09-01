-- ============================================================
-- Migration 024: 审核员档案表（独立管理）
-- 用途：审核员档案增删改查，可被数字审核 / 审计员选择等模块调用
-- ============================================================

CREATE TABLE IF NOT EXISTS auditor_profile (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL,
  name            varchar(100) NOT NULL,             -- 审核员姓名
  code            varchar(50),                       -- 审核员编号（人工分配或系统生成）
  gender          varchar(10),                       -- 性别：male / female
  id_number       varchar(50),                       -- 身份证号
  phone           varchar(50),
  email           varchar(100),
  organization    varchar(200),                      -- 所属机构（中认/华中/博创众诚）
  department      varchar(200),                      -- 部门
  position        varchar(100),                      -- 职位（高级审核员/审核员/实习等）
  level           varchar(20) DEFAULT 'intermediate',-- 审核员级别：junior/intermediate/senior/expert
  specialties     text[],                            -- 专业领域（Q/ES/SC/FSHA/QJES）
  cert_no         varchar(100),                      -- 证书编号
  cert_issue_date date,                              -- 证书签发日期
  cert_expiry     date,                              -- 证书有效期
  cert_status     varchar(20) DEFAULT 'active',      -- 证书状态：active/expired/suspended
  daily_rate      numeric(10,2),                     -- 标准日费率
  expert_type     varchar(50),                      -- 专家类型：auditor/technical_expert
  region          varchar(100),                      -- 地区
  languages       text[],                            -- 语种
  bio             text,                              -- 简介
  notes           text,                              -- 备注
  status          varchar(20) DEFAULT 'active',      -- 档案状态：active/inactive/retired
  tags            text[],                            -- 标签（如：CCAA 注册审核员）
  source          varchar(50) DEFAULT 'manual',      -- 数据来源：manual / import
  source_path     text,                              -- 原始档案路径
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  deleted_at      timestamptz
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_auditor_profile_company ON auditor_profile(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auditor_profile_name ON auditor_profile(company_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auditor_profile_org ON auditor_profile(company_id, organization) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auditor_profile_status ON auditor_profile(company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auditor_profile_specialty ON auditor_profile USING gin(specialties) WHERE deleted_at IS NULL;

-- 注释
COMMENT ON TABLE auditor_profile IS '审核员档案表 - 数字审核、审计员分配等模块调用';
COMMENT ON COLUMN auditor_profile.status IS 'active=启用 / inactive=停用 / retired=退休';
COMMENT ON COLUMN auditor_profile.level IS 'junior=初级 / intermediate=中级 / senior=高级 / expert=专家';
COMMENT ON COLUMN auditor_profile.cert_status IS 'active=有效 / expired=过期 / suspended=暂停';
COMMENT ON COLUMN auditor_profile.expert_type IS 'auditor=审核员 / technical_expert=技术专家';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP TABLE IF EXISTS auditor_profile;
