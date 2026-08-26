-- ============================================================
-- AI 中心 2.0-MVP 数据库模型升级 (migration 014)
-- 时间：2026-08-26
-- 对齐：AI数字化咨询中心 2.0 最小数据库模型文档
-- ============================================================

-- ============================================================
-- 1. 重命名现有表：signatory → signing_entity
-- ============================================================
ALTER TABLE IF EXISTS signatory RENAME TO signing_entity;
ALTER TABLE IF EXISTS signing_entity RENAME COLUMN code TO entity_code;

-- ============================================================
-- 2. 重命名：partner_certification_org → partner_cert_unit
-- ============================================================
ALTER TABLE IF EXISTS partner_certification_org RENAME TO partner_cert_unit;
ALTER TABLE IF EXISTS partner_cert_unit RENAME COLUMN cooperation_status TO status;
ALTER TABLE IF EXISTS partner_cert_unit ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE IF EXISTS partner_cert_unit RENAME COLUMN contact_person TO contact_name;
ALTER TABLE IF EXISTS partner_cert_unit RENAME COLUMN notes TO remark;

-- ============================================================
-- 3. 重命名：service_type 改造为 service_type 枚举型（按文档）
-- ============================================================
ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS signing_entity_id UUID REFERENCES signing_entity(id);

-- service_type 表的 code 改为固定枚举：consulting/certification/bundle
UPDATE service_type
SET code = CASE
  WHEN code = 'consulting' THEN 'consulting'
  WHEN code = 'certification' THEN 'certification'
  WHEN code = 'integrated' THEN 'bundle'
  ELSE code
END;

-- 4. 改造 certification_project 表对齐文档
-- ============================================================
-- 添加文档中要求的字段
ALTER TABLE certification_project
  ADD COLUMN IF NOT EXISTS project_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS primary_contact_id UUID,
  ADD COLUMN IF NOT EXISTS partner_cert_unit_name_snapshot VARCHAR(200),
  ADD COLUMN IF NOT EXISTS project_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS standard_scope TEXT,
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS sales_user_id UUID,
  ADD COLUMN IF NOT EXISTS expected_certificate_date DATE,
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS wechat_group_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS wechat_group_ref VARCHAR(200),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 重命名列以对齐文档
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='certification_project' AND column_name='signatory_id') THEN
    ALTER TABLE certification_project RENAME COLUMN signatory_id TO signing_entity_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='certification_project' AND column_name='signatory_name') THEN
    ALTER TABLE certification_project RENAME COLUMN signatory_name TO signing_entity_name;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='certification_project' AND column_name='partner_org_id') THEN
    ALTER TABLE certification_project RENAME COLUMN partner_org_id TO partner_cert_unit_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='certification_project' AND column_name='partner_org_name') THEN
    ALTER TABLE certification_project RENAME COLUMN partner_org_name TO partner_cert_unit_name_snapshot;
  END IF;
END$$;

-- 拷贝数据：project_no = project_code, project_name = customer_name
UPDATE certification_project
SET project_no = project_code,
    project_name = customer_name || ' - ' || COALESCE(service_type_name, '认证项目'),
    standard_scope = certification_scope,
    expected_certificate_date = expected_cert_date,
    risk_level = COALESCE(risk_level, 'medium'),
    wechat_group_name = group_name,
    partner_cert_unit_name_snapshot = partner_org_name
WHERE project_no IS NULL;

-- 唯一约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'certification_project_no_uk'
  ) THEN
    ALTER TABLE certification_project ADD CONSTRAINT certification_project_no_uk UNIQUE (project_no);
  END IF;
END$$;

-- 索引
CREATE INDEX IF NOT EXISTS idx_cert_project_no ON certification_project(project_no);

-- ============================================================
-- 5. 改造 service_type 表的 code 改为对应 enum（兼容）
-- ============================================================
ALTER TABLE service_type DROP CONSTRAINT IF EXISTS service_type_code_check;
ALTER TABLE service_type ADD CONSTRAINT service_type_code_check
  CHECK (code IN ('consulting', 'certification', 'bundle'));

-- ============================================================
-- 6. 删除 service_type 中不必要的字段（保留 config, sort_order, status）
-- ============================================================
ALTER TABLE service_type DROP COLUMN IF EXISTS description;

-- ============================================================
-- 7. 创建 customer_contact 表（文档要求）
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  position VARCHAR(100),
  phone VARCHAR(50),
  wechat VARCHAR(100),
  is_primary BOOLEAN DEFAULT false,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_contact_customer ON customer_contact(customer_id);

COMMENT ON TABLE customer_contact IS '客户联系人';

-- ============================================================
-- 8. 改造项目状态枚举（对齐文档）
-- 文档中状态：
-- lead, communicating, quoted, contract_pending, contracted, archived,
-- awaiting_deposit, deposit_paid, delivery_ready, collecting_documents,
-- contract_review, expert_pending, reviewing, rectifying, awaiting_balance,
-- invoicing, awaiting_certificate, certified, shipping, completed,
-- paused, risk, cancelled
-- ============================================================

-- 旧状态: contract_signed, contract_archived, first_pay_pending, first_paid,
--         delivery_prep, doc_collecting, expert_review_pending, expert_reviewing,
--         final_pay_pending, invoice_pending, cert_pending, shipment_pending,
--         suspended, at_risk
-- 状态对照迁移：
--   contract_signed      → contracted
--   contract_archived    → archived
--   first_pay_pending    → awaiting_deposit
--   first_paid           → deposit_paid
--   delivery_prep        → delivery_ready
--   doc_collecting       → collecting_documents
--   expert_review_pending → expert_pending
--   expert_reviewing     → reviewing
--   final_pay_pending    → awaiting_balance
--   invoice_pending      → invoicing
--   cert_pending         → awaiting_certificate
--   shipment_pending     → shipping
--   suspended            → paused
--   at_risk              → risk
-- 其余保持（lead, communicating, quoted, contract_pending, quoted,
--         contract_review, rectifying, certified, completed, cancelled）

UPDATE certification_project
SET status = CASE status
  WHEN 'contract_signed' THEN 'contracted'
  WHEN 'contract_archived' THEN 'archived'
  WHEN 'first_pay_pending' THEN 'awaiting_deposit'
  WHEN 'first_paid' THEN 'deposit_paid'
  WHEN 'delivery_prep' THEN 'delivery_ready'
  WHEN 'doc_collecting' THEN 'collecting_documents'
  WHEN 'expert_review_pending' THEN 'expert_pending'
  WHEN 'expert_reviewing' THEN 'reviewing'
  WHEN 'final_pay_pending' THEN 'awaiting_balance'
  WHEN 'invoice_pending' THEN 'invoicing'
  WHEN 'cert_pending' THEN 'awaiting_certificate'
  WHEN 'shipment_pending' THEN 'shipping'
  WHEN 'suspended' THEN 'paused'
  WHEN 'at_risk' THEN 'risk'
  ELSE status
END;

-- 添加 CHECK 约束
ALTER TABLE certification_project DROP CONSTRAINT IF EXISTS certification_project_status_check;
ALTER TABLE certification_project ADD CONSTRAINT certification_project_status_check CHECK (
  status IN (
    'lead', 'communicating', 'quoted', 'contract_pending', 'contracted', 'archived',
    'awaiting_deposit', 'deposit_paid', 'delivery_ready', 'collecting_documents',
    'contract_review', 'expert_pending', 'reviewing', 'rectifying',
    'awaiting_balance', 'invoicing', 'awaiting_certificate', 'certified',
    'shipping', 'completed', 'paused', 'risk', 'cancelled'
  )
);

-- ============================================================
-- 9. 改造 project_status_log 对齐 project_event（文档定义）
-- ============================================================
ALTER TABLE project_status_log
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(40) DEFAULT 'status_change',
  ADD COLUMN IF NOT EXISTS content TEXT;

UPDATE project_status_log SET event_type = 'status_change', content = reason WHERE event_type IS NULL;

ALTER TABLE project_status_log RENAME TO project_event;

-- ============================================================
-- 10. 改造 project_task 对齐文档
-- ============================================================
ALTER TABLE project_task
  ADD COLUMN IF NOT EXISTS task_type VARCHAR(40) DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE project_task SET task_type = COALESCE(tags[1], 'other') WHERE task_type = 'other';
-- assignee_user_id 保留原 assignee_id 关系
UPDATE project_task SET assignee_user_id = assignee_id WHERE assignee_user_id IS NULL AND assignee_id IS NOT NULL;
UPDATE project_task SET completed_at = completed_at WHERE status = 'completed' AND completed_at IS NULL;

-- status 改为 todo/doing/done/cancelled 枚举
UPDATE project_task
SET status = CASE status
  WHEN 'pending' THEN 'todo'
  WHEN 'in_progress' THEN 'doing'
  WHEN 'completed' THEN 'done'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'blocked' THEN 'todo'
  ELSE status
END;

ALTER TABLE project_task DROP CONSTRAINT IF EXISTS project_task_status_check;
ALTER TABLE project_task ADD CONSTRAINT project_task_status_check CHECK (
  status IN ('todo', 'doing', 'done', 'cancelled')
);

-- ============================================================
-- 11. 改造 project_payment 对齐文档（增加新字段）
-- ============================================================
ALTER TABLE project_payment
  ADD COLUMN IF NOT EXISTS receivable_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS received_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS voucher_document_id UUID;

UPDATE project_payment
SET receivable_amount = amount,
    received_amount = CASE WHEN status = 'received' THEN amount ELSE 0 END
WHERE receivable_amount IS NULL;

-- payment_type: first/final/other → deposit/balance/other
UPDATE project_payment
SET payment_type = CASE payment_type
  WHEN 'first' THEN 'deposit'
  WHEN 'final' THEN 'balance'
  ELSE 'other'
END;

-- status: pending/received/overdue
ALTER TABLE project_payment DROP CONSTRAINT IF EXISTS project_payment_status_check;
ALTER TABLE project_payment ADD CONSTRAINT project_payment_status_check CHECK (
  status IN ('pending', 'partial', 'paid', 'overdue')
);

-- ============================================================
-- 12. 改造 project_document 对齐文档
-- ============================================================
ALTER TABLE project_document
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS document_status VARCHAR(20) DEFAULT 'active';

UPDATE project_document
SET document_type = COALESCE(category, 'other'),
    storage_key = file_path,
    size_bytes = file_size,
    document_status = CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'obsolete' END
WHERE document_type IS NULL;

-- document_status 替代 status 字段
ALTER TABLE project_document DROP COLUMN IF EXISTS status;
ALTER TABLE project_document RENAME COLUMN document_status TO status;

-- status 枚举
ALTER TABLE project_document DROP CONSTRAINT IF EXISTS project_document_status_check;
ALTER TABLE project_document ADD CONSTRAINT project_document_status_check CHECK (
  status IN ('active', 'obsolete', 'verified')
);

-- 清理已删除的字段
ALTER TABLE project_document DROP COLUMN IF EXISTS file_path;
ALTER TABLE project_document DROP COLUMN IF EXISTS file_size;

-- ============================================================
-- 13. 改造 project_invoice 对齐文档
-- ============================================================
-- invoice_type / status 已有。保留。
-- 添加 document_id
ALTER TABLE project_invoice
  ADD COLUMN IF NOT EXISTS document_id UUID,
  ADD COLUMN IF NOT EXISTS remark TEXT;

-- file_path 保留为冗余
ALTER TABLE project_invoice DROP COLUMN IF EXISTS file_path;

-- status 枚举
ALTER TABLE project_invoice DROP CONSTRAINT IF EXISTS project_invoice_status_check;
ALTER TABLE project_invoice ADD CONSTRAINT project_invoice_status_check CHECK (
  status IN ('pending', 'issued', 'cancelled')
);

-- ============================================================
-- 14. 改造 project_review 对齐文档
-- ============================================================
ALTER TABLE project_review
  ADD COLUMN IF NOT EXISTS source_document_id UUID,
  ADD COLUMN IF NOT EXISTS remark TEXT;

UPDATE project_review SET remark = report_file_path WHERE remark IS NULL;

-- review_type: contract/expert
-- conclusion: pass/supplement/fail
-- status 保留

-- ============================================================
-- 15. 改造 project_correction 对齐文档（保留 corrective_action 设计）
-- ============================================================
ALTER TABLE project_correction
  ADD COLUMN IF NOT EXISTS source_document_id UUID,
  ADD COLUMN IF NOT EXISTS item_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS requirement TEXT,
  ADD COLUMN IF NOT EXISTS owner_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS submitted_document_id UUID,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS remark TEXT;

UPDATE project_correction
SET source_document_id = review_id,
    owner_name = responsible_name,
    item_no = 'CA-' || SUBSTRING(id::text, 1, 8),
    requirement = description
WHERE source_document_id IS NULL OR item_no IS NULL;

-- status 改为 open/submitted/verified/rejected/closed
UPDATE project_correction
SET status = CASE status
  WHEN 'pending' THEN 'open'
  WHEN 'submitted' THEN 'submitted'
  WHEN 'verified' THEN 'verified'
  WHEN 'rejected' THEN 'rejected'
  ELSE status
END;

ALTER TABLE project_correction DROP CONSTRAINT IF EXISTS project_correction_status_check;
ALTER TABLE project_correction ADD CONSTRAINT project_correction_status_check CHECK (
  status IN ('open', 'submitted', 'verified', 'rejected', 'closed')
);

-- ============================================================
-- 16. 改造 project_certificate 对齐文档（拆为 certificate 表）
-- ============================================================
ALTER TABLE project_certificate
  ADD COLUMN IF NOT EXISTS certificate_no VARCHAR(100),
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS document_id UUID;

UPDATE project_certificate
SET certificate_no = COALESCE(cert_no, 'CERT-' || SUBSTRING(id::text, 1, 8)),
    valid_until = expiry_date
WHERE certificate_no IS NULL;

-- 清理已删除字段
ALTER TABLE project_certificate DROP COLUMN IF EXISTS cert_no;
ALTER TABLE project_certificate DROP COLUMN IF EXISTS expiry_date;
ALTER TABLE project_certificate DROP COLUMN IF EXISTS certificate_file_path;

-- ============================================================
-- 17. 改造 project_shipment 对齐文档（拆为 shipment）
-- ============================================================
-- 文档字段：certificate_id, recipient_name, recipient_phone, recipient_address,
-- carrier, tracking_no, status, shipped_at, delivered_at, remark
-- 当前字段：project_id, recipient_name, recipient_phone, recipient_address,
-- courier_company, tracking_no, status, shipped_date, received_date, notes

ALTER TABLE project_shipment
  ADD COLUMN IF NOT EXISTS certificate_id UUID,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 字段重命名
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'courier_company'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'carrier'
  ) THEN
    ALTER TABLE project_shipment RENAME COLUMN courier_company TO carrier;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'shipped_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'shipped_at'
  ) THEN
    ALTER TABLE project_shipment RENAME COLUMN shipped_date TO shipped_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'notes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'remark'
  ) THEN
    ALTER TABLE project_shipment RENAME COLUMN notes TO remark;
  END IF;
END$$;

-- received_date 改为 delivered_at
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_shipment' AND column_name = 'received_date'
  ) THEN
    UPDATE project_shipment SET delivered_at = received_date::timestamptz WHERE received_date IS NOT NULL;
    ALTER TABLE project_shipment DROP COLUMN received_date;
  END IF;
END$$;

-- status 改为 pending/shipped/delivered/returned
ALTER TABLE project_shipment DROP CONSTRAINT IF EXISTS project_shipment_status_check;
ALTER TABLE project_shipment ADD CONSTRAINT project_shipment_status_check CHECK (
  status IN ('pending', 'shipped', 'delivered', 'returned')
);

-- ============================================================
-- 18. 改造 project_log 为 audit_log
-- ============================================================
-- 项目事件已经迁移到 project_event，project_log 可以保留为通用审计日志
COMMENT ON TABLE project_log IS '通用项目审计日志（详细变更历史）';

-- ============================================================
-- 19. 初始化 signing_entity 数据
-- ============================================================
-- 已存在 A 华中、B 中认宁夏。增加 C 外协占位（如不存在）。
INSERT INTO signing_entity (id, company_id, entity_code, name, short_name, status)
VALUES (
  '00000000-0000-0000-0000-00000000000c',
  '00000000-0000-0000-0000-000000000001',
  'C',
  '外协认证单位（占位）',
  '外协',
  'active'
)
ON CONFLICT (company_id, entity_code) DO NOTHING;

-- ============================================================
-- 20. 初始化 customer_contact（从 customer 表导出现有联系人）
-- ============================================================
-- 如果 customer 表有 contact_person 字段，迁移过来
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer' AND column_name = 'contact_person'
  ) THEN
    INSERT INTO customer_contact (company_id, customer_id, name, position, phone, is_primary)
    SELECT
      company_id, id, contact_person, '', COALESCE(contact_phone, ''), true
    FROM customer
    WHERE deleted_at IS NULL AND contact_person IS NOT NULL
      AND id NOT IN (SELECT customer_id FROM customer_contact WHERE deleted_at IS NULL)
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

-- ============================================================
-- 21. 添加约束
-- ============================================================
-- 客户、项目外键关系
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'certification_project_customer_fk'
  ) THEN
    ALTER TABLE certification_project
      ADD CONSTRAINT certification_project_customer_fk FOREIGN KEY (customer_id) REFERENCES customer(id);
  END IF;
END$$;

-- 签约主体外键
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'certification_project' AND column_name = 'signing_entity_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'certification_project_signing_entity_fk'
  ) THEN
    ALTER TABLE certification_project
      ADD CONSTRAINT certification_project_signing_entity_fk FOREIGN KEY (signing_entity_id) REFERENCES signing_entity(id);
  END IF;
END$$;

-- ============================================================
-- 完成
-- ============================================================
COMMENT ON TABLE signing_entity IS '签约主体（华中集团/中认宁夏/外协）';
COMMENT ON TABLE partner_cert_unit IS '合作认证单位（外协）';
COMMENT ON TABLE service_type IS '服务类型（consulting/certification/bundle）';
COMMENT ON TABLE certification_project IS '认证项目（业务主线主档）';
COMMENT ON TABLE project_event IS '项目事件（状态变更与关键操作日志）';
COMMENT ON TABLE project_task IS '项目待办';
COMMENT ON TABLE project_payment IS '项目收款（首付款/尾款）';
COMMENT ON TABLE project_document IS '项目资料（带版本管理）';
COMMENT ON TABLE project_invoice IS '项目发票';
COMMENT ON TABLE project_review IS '评审安排（合同评审 + 专家评审）';
COMMENT ON TABLE project_correction IS '整改项';
COMMENT ON TABLE project_certificate IS '证书信息';
COMMENT ON TABLE project_shipment IS '证书邮寄';
COMMENT ON TABLE customer_contact IS '客户联系人';