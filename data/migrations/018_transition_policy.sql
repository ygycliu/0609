-- ============================================================
-- Migration 018: 状态机迁移策略表
-- 任务包：§P0-B 第 5-6 步
-- ============================================================

-- 状态机迁移策略（每条迁移的配置）
CREATE TABLE IF NOT EXISTS status_transition_policy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT,

    -- 迁移标识
    from_status VARCHAR(50) NOT NULL,                -- 起始状态
    to_status VARCHAR(50) NOT NULL,                  -- 目标状态
    trigger_type VARCHAR(50) NOT NULL,               -- A=自动/B=待确认/C=禁止AI

    -- 责任角色（JSON 数组，可多个）
    required_roles JSONB NOT NULL DEFAULT '["admin"]'::jsonb,

    -- 必要证据（JSON 数组）
    required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- 风险等级
    risk_level VARCHAR(20) NOT NULL DEFAULT 'medium', -- low/medium/high/critical

    -- 描述
    description TEXT,
    notes TEXT,

    -- 元信息
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    UNIQUE(company_id, from_status, to_status)
);

CREATE INDEX idx_stp_company ON status_transition_policy(company_id) WHERE is_active = true;
CREATE INDEX idx_stp_trigger ON status_transition_policy(company_id, trigger_type) WHERE is_active = true;

COMMENT ON TABLE status_transition_policy IS '状态机迁移策略（任务包 §P0-B 第 5-6 步）';

-- ============================================================
-- 插入状态机迁移策略
-- ============================================================

-- A 类：自动迁移（技术事件，不代表业务结论）
INSERT INTO status_transition_policy (company_id, from_status, to_status, trigger_type, required_roles, required_evidence, risk_level, description) VALUES
((SELECT id FROM company LIMIT 1), 'file_uploaded_status', 'doc_collecting', 'A', '["system"]'::jsonb, '[]'::jsonb, 'low', '文件上传完成'),
((SELECT id FROM company LIMIT 1), 'pending_parse', 'doc_collecting', 'A', '["system"]'::jsonb, '["file_parsed"]'::jsonb, 'low', '文件解析完成'),
((SELECT id FROM company LIMIT 1), 'pending_index', 'doc_collecting', 'A', '["system"]'::jsonb, '["embedding_done"]'::jsonb, 'low', 'AI 索引完成')
ON CONFLICT DO NOTHING;

-- B 类：待确认迁移
INSERT INTO status_transition_policy (company_id, from_status, to_status, trigger_type, required_roles, required_evidence, risk_level, description) VALUES
((SELECT id FROM company LIMIT 1), 'first_pay_pending', 'first_paid', 'B', '["finance"]'::jsonb, '["payment_record", "bank_receipt"]'::jsonb, 'high', '财务确认到账'),
((SELECT id FROM company LIMIT 1), 'expert_reviewing', 'correcting', 'B', '["reviewer", "lead_auditor"]'::jsonb, '["review_report", "non_conformance_list"]'::jsonb, 'high', '评审人员确认产生整改'),
((SELECT id FROM company LIMIT 1), 'correcting', 'cert_pending', 'B', '["lead_auditor"]'::jsonb, '["corrective_action_verified"]'::jsonb, 'high', '授权人员确认整改闭环'),
((SELECT id FROM company LIMIT 1), 'final_pay_pending', 'invoice_pending', 'B', '["finance"]'::jsonb, '["final_payment_record"]'::jsonb, 'high', '财务确认付款条件'),
((SELECT id FROM company LIMIT 1), 'invoice_pending', 'cert_pending', 'B', '["finance", "admin"]'::jsonb, '["invoice_issued"]'::jsonb, 'medium', '发票条件满足')
ON CONFLICT DO NOTHING;

-- C 类：禁止 AI 自动迁移（必须人工授权）
INSERT INTO status_transition_policy (company_id, from_status, to_status, trigger_type, required_roles, required_evidence, risk_level, description) VALUES
((SELECT id FROM company LIMIT 1), 'quoted', 'contract_pending', 'C', '["sales_lead", "admin"]'::jsonb, '["signed_contract", "contract_scan"]'::jsonb, 'critical', '合同正式签订'),
((SELECT id FROM company LIMIT 1), '*', '*', 'C', '["admin"]'::jsonb, '["change_request", "approval_record"]'::jsonb, 'critical', '合同金额变更'),
((SELECT id FROM company LIMIT 1), '*', 'cancelled', 'C', '["admin", "customer"]'::jsonb, '["cancellation_request", "reason"]'::jsonb, 'critical', '项目取消'),
((SELECT id FROM company LIMIT 1), 'correcting', 'cert_pending', 'C', '["admin", "lead_auditor"]'::jsonb, '["review_passed", "no_non_conformance"]'::jsonb, 'critical', '评审通过'),
((SELECT id FROM company LIMIT 1), '*', 'certified', 'C', '["admin", "lead_auditor"]'::jsonb, '["certificate_issued", "issuing_body"]'::jsonb, 'critical', '出证'),
((SELECT id FROM company LIMIT 1), 'completed', 'project_archived', 'C', '["admin"]'::jsonb, '["archive_request", "retention_period"]'::jsonb, 'high', '项目完成归档')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 验证
-- ============================================================
DO $$
DECLARE
    a_count INT;
    b_count INT;
    c_count INT;
    total INT;
BEGIN
    SELECT count(*) INTO total FROM status_transition_policy;
    SELECT count(*) INTO a_count FROM status_transition_policy WHERE trigger_type = 'A';
    SELECT count(*) INTO b_count FROM status_transition_policy WHERE trigger_type = 'B';
    SELECT count(*) INTO c_count FROM status_transition_policy WHERE trigger_type = 'C';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 018 完成';
    RAISE NOTICE '========================================';
    RAISE NOTICE '总策略: %, A(自动)=%, B(待确认)=%, C(禁止AI)=%', total, a_count, b_count, c_count;
    RAISE NOTICE '========================================';
END
$$;
