-- ============================================================
-- Migration 019: action_proposal 表（P0 AI 就绪）
-- 任务包：§4.2 P0 AI 就绪表 + §P0-B 第 7 步
-- ============================================================

CREATE TABLE IF NOT EXISTS action_proposal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT,

    -- 来源
    source_type VARCHAR(50) NOT NULL,                 -- project_payment / ai_extraction / follow_up / manual
    source_id UUID,                                    -- 关联源记录 ID

    -- 提案类型
    proposal_type VARCHAR(50) NOT NULL,               -- status_change / create_project / update_field / send_message / etc.

    -- 目标
    target_entity VARCHAR(100) NOT NULL,              -- certification_project / follow_up / customer / etc.
    target_id UUID,                                    -- 目标记录 ID

    -- 变更内容
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,       -- 详细变更内容

    -- 置信度
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',  -- low / medium / high / very_high

    -- 状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending / approved / rejected / expired / cancelled
    approved_by UUID REFERENCES app_user(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    reject_reason TEXT,

    -- 有效期
    expires_at TIMESTAMP WITH TIME ZONE,

    -- 元信息
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ap_company_status ON action_proposal(company_id, status, created_at DESC);
CREATE INDEX idx_ap_target ON action_proposal(company_id, target_entity, target_id);
CREATE INDEX idx_ap_source ON action_proposal(company_id, source_type, source_id);
CREATE INDEX idx_ap_expires ON action_proposal(expires_at) WHERE status = 'pending';

COMMENT ON TABLE action_proposal IS 'AI/系统建议的待确认操作提案（任务包 §4.2）';

-- 验证
DO $$
DECLARE
    cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM action_proposal;
    RAISE NOTICE 'Migration 019 完成: action_proposal 表已创建（当前 % 条记录）', cnt;
END
$$;
