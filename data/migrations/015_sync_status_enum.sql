-- ============================================================
-- Migration 015: 更新 certification_project 状态 CHECK 约束
-- ============================================================

-- 1. 删除老 CHECK 约束
ALTER TABLE certification_project
  DROP CONSTRAINT IF EXISTS certification_project_status_check;

-- 2. 添加新 CHECK 约束（与代码 PROJECT_STATUS_TRANSITIONS 一致）
ALTER TABLE certification_project
  ADD CONSTRAINT certification_project_status_check
  CHECK (status = ANY (ARRAY[
    'lead', 'communicating', 'quoted', 'contract_pending', 'contract_signed',
    'contract_archived', 'first_pay_pending', 'first_paid', 'delivery_prep',
    'doc_collecting', 'contract_review', 'expert_review_pending', 'expert_reviewing',
    'correcting', 'final_pay_pending', 'invoice_pending', 'cert_pending',
    'certified', 'shipment_pending', 'completed', 'suspended', 'at_risk', 'cancelled'
  ]));

-- 3. 同步更新旧状态值（如有）
-- contracted → contract_signed
-- archived → contract_archived
-- deposit_paid → first_paid
-- delivery_ready → delivery_prep
-- collecting_documents → doc_collecting
-- reviewing → expert_reviewing
-- rectifying → correcting
-- awaiting_balance → final_pay_pending
-- invoicing → invoice_pending
-- awaiting_certificate → cert_pending
-- shipping → shipment_pending
-- paused → suspended
-- risk → at_risk
UPDATE certification_project SET status = 'contract_signed' WHERE status = 'contracted';
UPDATE certification_project SET status = 'contract_archived' WHERE status = 'archived';
UPDATE certification_project SET status = 'first_paid' WHERE status = 'deposit_paid';
UPDATE certification_project SET status = 'delivery_prep' WHERE status = 'delivery_ready';
UPDATE certification_project SET status = 'doc_collecting' WHERE status = 'collecting_documents';
UPDATE certification_project SET status = 'expert_reviewing' WHERE status = 'reviewing';
UPDATE certification_project SET status = 'correcting' WHERE status = 'rectifying';
UPDATE certification_project SET status = 'final_pay_pending' WHERE status = 'awaiting_balance';
UPDATE certification_project SET status = 'invoice_pending' WHERE status = 'invoicing';
UPDATE certification_project SET status = 'cert_pending' WHERE status = 'awaiting_certificate';
UPDATE certification_project SET status = 'shipment_pending' WHERE status = 'shipping';
UPDATE certification_project SET status = 'suspended' WHERE status = 'paused';
UPDATE certification_project SET status = 'at_risk' WHERE status = 'risk';

-- 4. 同样修复 project_event 表的 status 约束
DO $$
BEGIN
  -- 检查是否有约束
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'project_event' AND constraint_name = 'project_event_status_check'
  ) THEN
    ALTER TABLE project_event DROP CONSTRAINT project_event_status_check;
  END IF;
END $$;

-- project_event 是否有约束不一定，先看
SELECT
  tc.constraint_name,
  pg_get_constraintdef(tc.oid)
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'project_event'
  AND tc.constraint_type = 'CHECK';