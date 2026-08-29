-- ============================================================
-- Migration 017: 状态机更新（suspended → paused + 新增 project_archived）
-- 任务包：§P0-B 第 2-4 步
-- ============================================================

-- ============================================================
-- 1. 数据迁移：任何 suspended 状态改为 paused
-- ============================================================
DO $$
DECLARE
    suspended_count INT;
BEGIN
    UPDATE certification_project
    SET status = 'paused',
        is_suspended = true,
        updated_at = NOW()
    WHERE status = 'suspended' AND deleted_at IS NULL;

    GET DIAGNOSTICS suspended_count = ROW_COUNT;
    RAISE NOTICE '数据迁移: % 行从 suspended 改为 paused', suspended_count;

    UPDATE project_event
    SET from_status = 'paused'
    WHERE from_status = 'suspended';

    UPDATE project_event
    SET to_status = 'paused'
    WHERE to_status = 'suspended';

    RAISE NOTICE 'project_event 历史记录已迁移';
END
$$;

-- ============================================================
-- 2. DROP 旧 CHECK 约束
-- ============================================================
ALTER TABLE certification_project DROP CONSTRAINT IF EXISTS certification_project_status_check;

-- ============================================================
-- 3. ADD 新 CHECK 约束（22 → 24 状态：paused 替换 suspended + 新增 project_archived）
-- ============================================================
ALTER TABLE certification_project ADD CONSTRAINT certification_project_status_check
    CHECK (status IN (
        'lead', 'communicating', 'quoted', 'contract_pending',
        'contract_signed', 'contract_archived', 'first_pay_pending', 'first_paid',
        'delivery_prep', 'doc_collecting', 'contract_review', 'expert_review_pending',
        'expert_reviewing', 'correcting', 'final_pay_pending', 'invoice_pending',
        'cert_pending', 'certified', 'shipment_pending', 'completed',
        'project_archived',   -- P0-B 新增
        'paused',              -- P0-B 替代 suspended
        'at_risk', 'cancelled'
    ));

-- ============================================================
-- 4. 验证
-- ============================================================
DO $$
DECLARE
    suspended_remaining INT;
    paused_count INT;
    archived_count INT;
BEGIN
    SELECT COUNT(*) INTO suspended_remaining
    FROM certification_project
    WHERE status = 'suspended' AND deleted_at IS NULL;

    SELECT COUNT(*) INTO paused_count
    FROM certification_project
    WHERE status = 'paused' AND deleted_at IS NULL;

    SELECT COUNT(*) INTO archived_count
    FROM certification_project
    WHERE status = 'project_archived' AND deleted_at IS NULL;

    IF suspended_remaining > 0 THEN
        RAISE EXCEPTION 'Migration FAILED: 仍有 % 行 status=suspended', suspended_remaining;
    ELSE
        RAISE NOTICE 'Migration 017 完成: 0 行 suspended，% 行 paused，% 行 project_archived', paused_count, archived_count;
    END IF;
END
$$;
