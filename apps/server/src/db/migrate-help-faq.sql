-- V2.3.8：帮助中心 FAQ 表
-- 一个常见问题处理库：分类、问题、答案、标签、错误码、关联模块

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS help_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  category VARCHAR(50) NOT NULL DEFAULT '其他',
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  error_code VARCHAR(100),          -- 关联错误码/状态字（可选）
  related_module VARCHAR(50),       -- 关联模块 contract/customer/audit/finance/system（可选）
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active/draft/archived
  view_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_help_faq_company ON help_faq(company_id);
CREATE INDEX IF NOT EXISTS idx_help_faq_category ON help_faq(company_id, category);
CREATE INDEX IF NOT EXISTS idx_help_faq_module ON help_faq(company_id, related_module);
CREATE INDEX IF NOT EXISTS idx_help_faq_status ON help_faq(company_id, status);
CREATE INDEX IF NOT EXISTS idx_help_faq_tags ON help_faq USING gin(tags);

-- 全文搜索（问题+答案）
CREATE INDEX IF NOT EXISTS idx_help_faq_search
  ON help_faq
  USING gin(to_tsvector('simple', coalesce(question,'') || ' ' || coalesce(answer,'')));

COMMENT ON TABLE help_faq IS 'V2.3.8 帮助中心 FAQ：常见问题处理库';
COMMENT ON COLUMN help_faq.category IS '分类：合同/客户/认证/财务/审核/系统/其他';
COMMENT ON COLUMN help_faq.related_module IS '关联模块：contract/customer/audit/finance/system';
COMMENT ON COLUMN help_faq.error_code IS '关联错误码或状态关键字';
