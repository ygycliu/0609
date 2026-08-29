-- ============================================================
-- Migration 016a ROLLBACK + CREATE: finance_project_v2 兼容视图
-- 任务包 §3.3 + §P0-A 第 7 步
-- ============================================================

-- 先删除旧视图
DROP VIEW IF EXISTS finance_project_v2 CASCADE;

-- 视图：finance_project_v2
CREATE VIEW finance_project_v2 AS
SELECT
    fp.id,
    fp.company_id,
    fp.customer_id,
    fp.project_code,
    fp.name,
    fp.certification_type,
    fp.service_type,
    fp.contract_amount,
    fp.received_amount,
    fp.paid_amount,
    fp.status AS old_status,
    fp.signed_at,
    fp.started_at,
    fp.completed_at,
    fp.deadline_at,
    fp.notes,
    fp.owner_user_id,
    fp.tags,
    fp.created_at,
    fp.updated_at,
    fp.deleted_at,
    -- 映射到 V2.0 字段
    c.id AS cert_org_id,
    c.code AS cert_org_code,
    c.name AS cert_org_name,
    cp.id AS certification_project_id,
    cp.status AS project_status,
    cp.project_code AS v2_project_code,
    -- 计算字段
    (fp.received_amount IS NOT NULL AND fp.contract_amount IS NOT NULL
        AND fp.received_amount >= fp.contract_amount) AS is_fully_paid,
    (fp.deleted_at IS NULL) AS is_active
FROM finance_project fp
-- 一个 finance_project 关联到 1 个签约主体（取第一个）
LEFT JOIN LATERAL (
    SELECT id, company_id
    FROM signing_entity
    WHERE company_id = fp.company_id AND deleted_at IS NULL
    ORDER BY entity_code
    LIMIT 1
) se ON true
-- 通过签约主体找认证机构
LEFT JOIN certified_organization c
    ON c.company_id = se.company_id
    AND c.signing_entity_id = se.id
    AND c.deleted_at IS NULL
LEFT JOIN certification_project cp
    ON cp.company_id = fp.company_id
    AND cp.customer_id = fp.customer_id
    AND EXTRACT(YEAR FROM cp.created_at) = EXTRACT(YEAR FROM fp.created_at)
    AND cp.deleted_at IS NULL;

COMMENT ON VIEW finance_project_v2 IS '兼容视图：finance_project → certified_organization + certification_project（§3.3 停止新业务主档）';

DO $$
DECLARE
    view_rows INT;
BEGIN
    SELECT COUNT(*) INTO view_rows FROM finance_project_v2;
    RAISE NOTICE 'finance_project_v2 视图创建完成: % 行', view_rows;
END
$$;
