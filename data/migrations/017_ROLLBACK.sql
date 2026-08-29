-- ============================================================
-- Migration 017 ROLLBACK
-- ============================================================

-- 回退数据
DO $$
BEGIN
    UPDATE certification_project
    SET status = 'suspended',
        updated_at = NOW()
    WHERE status = 'paused' AND deleted_at IS NULL;

    UPDATE project_event SET from_status = 'suspended' WHERE from_status = 'paused';
    UPDATE project_event SET to_status = 'suspended' WHERE to_status = 'paused';
    UPDATE project_event SET from_status = 'project_archived' WHERE from_status = 'project_archived';
    UPDATE project_event SET to_status = 'project_archived' WHERE to_status = 'project_archived';

    UPDATE certification_project
    SET status = 'completed',
        updated_at = NOW()
    WHERE status = 'project_archived' AND deleted_at IS NULL;
END
$$;

-- DROP 新 CHECK
ALTER TABLE certification_project DROP CONSTRAINT IF EXISTS certification_project_status_check;

-- 恢复旧 CHECK（包含 suspended，不包含 project_archived）
ALTER TABLE certification_project ADD CONSTRAINT certification_project_status_check
    CHECK (status IN (
        'lead', 'communicating', 'quoted', 'contract_pending',
        'contract_signed', 'contract_archived', 'first_pay_pending', 'first_paid',
        'delivery_prep', 'doc_collecting', 'contract_review', 'expert_review_pending',
        'expert_reviewing', 'correcting', 'final_pay_pending', 'invoice_pending',
        'cert_pending', 'certified', 'shipment_pending', 'completed',
        'suspended', 'at_risk', 'cancelled'
    ));

-- 验证
DO $$
DECLARE
    paused_remaining INT;
    archived_remaining INT;
BEGIN
    SELECT COUNT(*) INTO paused_remaining FROM certification_project WHERE status = 'paused' AND deleted_at IS NULL;
    SELECT COUNT(*) INTO archived_remaining FROM certification_project WHERE status = 'project_archived' AND deleted_at IS NULL;
    IF paused_remaining > 0 OR archived_remaining > 0 THEN
        RAISE EXCEPTION 'Rollback FAILED: 仍有 paused=% 或 project_archived=% 行', paused_remaining, archived_remaining;
    END IF;
    RAISE NOTICE 'Rollback 017 SUCCESS';
END
$$;
