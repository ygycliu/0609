-- ============================================================
-- AI 中心 2.0-MVP 认证项目中心 (migration 013)
-- 创建时间：2026-08-26
-- ============================================================

-- ============================================================
-- 1. 签约主体（3类）
-- ============================================================
CREATE TABLE IF NOT EXISTS signatory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  code VARCHAR(20) NOT NULL,         -- A/B/C
  name VARCHAR(200) NOT NULL,
  short_name VARCHAR(50),
  contact_person VARCHAR(100),
  contact_phone VARCHAR(50),
  address VARCHAR(500),
  status VARCHAR(20) DEFAULT 'active',     -- active/inactive
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(company_id, code)
);

COMMENT ON TABLE signatory IS '签约主体（A=华中集团/B=中认宁夏/C=外协认证单位）';

-- ============================================================
-- 2. 合作认证单位（外协）
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_certification_org (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100),
  contact_phone VARCHAR(50),
  address VARCHAR(500),
  cooperation_status VARCHAR(20) DEFAULT 'active',   -- active/paused/closed
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE partner_certification_org IS '合作认证单位（外协）';

-- ============================================================
-- 3. 服务类型（3类固定 + 可配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS service_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  code VARCHAR(30) NOT NULL,         -- consulting / certification / integrated
  name VARCHAR(100) NOT NULL,        -- 咨询服务/认证服务/咨询+认证一体化
  description TEXT,
  -- 配置项（JSONB：报价模板、合同模板、是否需要外协等）
  config JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'active',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(company_id, code)
);

COMMENT ON TABLE service_type IS '服务类型（3类固定）';

-- ============================================================
-- 4. 认证项目（核心主档）
-- ============================================================
CREATE TABLE IF NOT EXISTS certification_project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_code VARCHAR(50) NOT NULL,         -- PRJ-2026-001
  customer_id UUID NOT NULL,
  customer_name VARCHAR(200) NOT NULL,        -- 历史快照
  contact_person VARCHAR(100),
  contact_phone VARCHAR(50),

  -- 服务信息
  service_type_id UUID NOT NULL,
  service_type_code VARCHAR(30) NOT NULL,    -- 历史快照
  service_type_name VARCHAR(100) NOT NULL,
  signatory_id UUID NOT NULL,
  signatory_name VARCHAR(200) NOT NULL,       -- 历史快照
  partner_org_id UUID,                       -- 外协
  partner_org_name VARCHAR(200),             -- 快照

  -- 项目字段
  industry VARCHAR(100),
  certification_scope TEXT,                  -- 申请认证范围
  certification_standards TEXT,               -- 认证标准 GB/T 19001...
  risk_level VARCHAR(20),                    -- low/medium/high
  sales_source VARCHAR(100),

  -- 金额
  contract_amount NUMERIC(12,2),
  paid_amount NUMERIC(12,2) DEFAULT 0,
  invoice_amount NUMERIC(12,2) DEFAULT 0,

  -- 状态
  status VARCHAR(30) NOT NULL DEFAULT 'lead', -- 详见状态机
  prev_status VARCHAR(30),
  is_suspended BOOLEAN DEFAULT false,
  is_cancelled BOOLEAN DEFAULT false,
  cancel_reason TEXT,

  -- 关键日期
  expected_cert_date DATE,
  actual_cert_date DATE,
  first_pay_date DATE,
  final_pay_date DATE,
  next_followup_date DATE,
  last_followup_date DATE,

  -- 微信群信息
  group_name VARCHAR(200),
  group_external_id VARCHAR(500),

  -- 项目团队
  sales_id UUID,
  sales_name VARCHAR(100),
  project_owner_id UUID,
  project_owner_name VARCHAR(100),
  consultant_id UUID,
  consultant_name VARCHAR(100),
  reviewer_id UUID,
  reviewer_name VARCHAR(100),

  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE certification_project IS '认证项目（业务主线主档）';
CREATE INDEX IF NOT EXISTS idx_project_company_status ON certification_project(company_id, status);
CREATE INDEX IF NOT EXISTS idx_project_customer ON certification_project(customer_id);
CREATE INDEX IF NOT EXISTS idx_project_code ON certification_project(project_code);

-- ============================================================
-- 5. 项目状态变更日志
-- ============================================================
CREATE TABLE IF NOT EXISTS project_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason TEXT,
  note TEXT,
  operator_id UUID NOT NULL,
  operator_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE project_status_log IS '项目状态变更日志（必须记录所有变更）';

-- ============================================================
-- 6. 项目任务 / 待办
-- ============================================================
CREATE TABLE IF NOT EXISTS project_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  parent_task_id UUID,                       -- 子任务
  title VARCHAR(200) NOT NULL,
  description TEXT,
  assignee_id UUID,
  assignee_name VARCHAR(100),
  reviewer_id UUID,
  reviewer_name VARCHAR(100),
  priority VARCHAR(20) DEFAULT 'normal',     -- low/normal/high/urgent
  status VARCHAR(20) DEFAULT 'pending',     -- pending/in_progress/blocked/completed/cancelled
  due_date DATE,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  tags TEXT[],
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_project ON project_task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON project_task(company_id, status);

-- ============================================================
-- 7. 项目资料 / 版本管理
-- ============================================================
CREATE TABLE IF NOT EXISTS project_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  category VARCHAR(50),                     -- contract / invoice / certificate / review / correction
  doc_code VARCHAR(50),
  title VARCHAR(200) NOT NULL,
  version INT DEFAULT 1,
  file_path VARCHAR(500),
  file_name VARCHAR(200),
  file_size INT,
  mime_type VARCHAR(100),
  sha256 VARCHAR(64),
  uploaded_by UUID,
  uploaded_by_name VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_doc_project ON project_document(project_id, category);

-- ============================================================
-- 8. 资料清单模板
-- ============================================================
CREATE TABLE IF NOT EXISTS document_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  service_type_id UUID,
  name VARCHAR(200) NOT NULL,
  items JSONB NOT NULL,                       -- [{name, required, description}]
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 9. 收款记录（首付款 + 尾款）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_payment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  payment_type VARCHAR(20) NOT NULL,         -- first / final / other
  amount NUMERIC(12,2) NOT NULL,
  payment_method VARCHAR(50),                -- bank / cash / wechat / alipay
  received_date DATE,
  voucher_no VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',      -- pending/received/overdue
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 10. 发票记录
-- ============================================================
CREATE TABLE IF NOT EXISTS project_invoice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  invoice_type VARCHAR(20) NOT NULL,         -- vat_special / vat_general
  invoice_no VARCHAR(100),
  amount NUMERIC(12,2) NOT NULL,
  tax_rate NUMERIC(5,2),                    -- 6% / 13% / 3%
  tax_amount NUMERIC(12,2),
  issue_date DATE,
  status VARCHAR(20) DEFAULT 'pending',      -- pending/issued/cancelled
  file_path VARCHAR(500),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 11. 评审安排（合同评审 + 专家评审）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  review_type VARCHAR(20) NOT NULL,          -- contract / expert
  review_method VARCHAR(20),                 -- onsite / remote
  scheduled_date DATE,
  scheduled_time TIME,
  location VARCHAR(200),
  reviewer_id UUID,
  reviewer_name VARCHAR(100),
  reviewer_role VARCHAR(50),
  external_reviewer VARCHAR(200),            -- 外协评审人员
  conclusion VARCHAR(20),                    -- pass / supplement / fail
  conclusion_note TEXT,
  report_file_path VARCHAR(500),
  status VARCHAR(20) DEFAULT 'scheduled',    -- scheduled/in_progress/completed/cancelled
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 12. 整改项
-- ============================================================
CREATE TABLE IF NOT EXISTS project_correction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  review_id UUID,                            -- 关联评审
  title VARCHAR(200) NOT NULL,
  description TEXT,
  responsible_id UUID,
  responsible_name VARCHAR(100),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  status VARCHAR(20) DEFAULT 'pending',      -- pending/submitted/verified/rejected
  evidence_file_path VARCHAR(500),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 13. 证书信息
-- ============================================================
CREATE TABLE IF NOT EXISTS project_certificate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  cert_type VARCHAR(50) NOT NULL,            -- qms/ems/ohsms/is27001/haccp
  cert_no VARCHAR(100),                      -- 证书编号
  standard VARCHAR(200),                     -- GB/T 19001-2016
  issue_date DATE,
  expiry_date DATE,
  issuing_body VARCHAR(200),                 -- 颁证机构
  certificate_file_path VARCHAR(500),
  status VARCHAR(20) DEFAULT 'pending',      -- pending/issued/expired/cancelled
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 14. 邮寄记录
-- ============================================================
CREATE TABLE IF NOT EXISTS project_shipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  recipient_name VARCHAR(100) NOT NULL,
  recipient_phone VARCHAR(50),
  recipient_address VARCHAR(500) NOT NULL,
  courier_company VARCHAR(100),               -- 顺丰/EMS/...
  tracking_no VARCHAR(100),
  shipped_date DATE,
  received_date DATE,
  items_description TEXT,                     -- 邮寄物品清单
  status VARCHAR(20) DEFAULT 'pending',      -- pending/shipped/received/returned
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 15. 项目操作日志（全程审计）
-- ============================================================
CREATE TABLE IF NOT EXISTS project_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,               -- create/update/status_change/upload/payment...
  entity_type VARCHAR(50),                   -- project/task/document/payment...
  entity_id UUID,
  detail JSONB,                             -- 变更详情
  operator_id UUID,
  operator_name VARCHAR(100),
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_log ON project_log(project_id, created_at);

-- ============================================================
-- 16. 初始化 3 类签约主体
-- ============================================================
INSERT INTO signatory (company_id, code, name, short_name, status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'A', '华中国际认证检验集团有限公司', '华中集团', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'B', '中认认证有限公司宁夏分公司', '中认宁夏', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'C', '外协认证单位（占位）', '外协', 'active')
ON CONFLICT (company_id, code) DO NOTHING;

-- ============================================================
-- 17. 初始化 3 类服务类型
-- ============================================================
INSERT INTO service_type (company_id, code, name, description, config, sort_order)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'consulting', '咨询服务', '仅提供认证咨询、体系辅导服务',
   '{"need_partner": false, "need_certificate": false}'::jsonb, 1),
  ('00000000-0000-0000-0000-000000000001', 'certification', '认证服务', '提供认证审核及证书发放',
   '{"need_partner": true, "need_certificate": true}'::jsonb, 2),
  ('00000000-0000-0000-0000-000000000001', 'integrated', '咨询+认证一体化', '咨询 + 认证一条龙',
   '{"need_partner": true, "need_certificate": true}'::jsonb, 3)
ON CONFLICT (company_id, code) DO NOTHING;

-- ============================================================
-- 18. 初始化资料清单模板（QES 三体系）
-- ============================================================
INSERT INTO document_checklist (company_id, name, items)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'QES 三体系认证资料清单',
   '[
     {"name": "营业执照副本", "required": true, "description": "加盖公章"},
     {"name": "组织机构代码证", "required": true},
     {"name": "体系文件（手册+程序文件）", "required": true, "description": "电子版"},
     {"name": "内审报告", "required": true, "description": "近1年内"},
     {"name": "管理评审报告", "required": true, "description": "近1年内"},
     {"name": "认证申请书", "required": true, "description": "我方提供模板"},
     {"name": "组织架构图", "required": true},
     {"name": "生产工艺流程图", "required": false, "description": "生产型企业需要"},
     {"name": "主要设备清单", "required": false},
     {"name": "厂区平面图", "required": false}
   ]'::jsonb);
