-- ============================================================
-- Migration 021: projection_sync_status 表
-- 任务包：§4.2 + §P0-C 第 4-6 步
-- ============================================================

CREATE TABLE IF NOT EXISTS projection_sync_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE RESTRICT,

    -- 投影标识
    projection_name VARCHAR(100) NOT NULL,             -- project_workspace / funnel / finance_summary / etc.
    aggregate_type VARCHAR(50) NOT NULL,              -- certification_project / customer / follow_up / etc.
    aggregate_id UUID NOT NULL,                       -- 聚合根 ID

    -- 同步状态
    last_event_id UUID,                               -- 最后处理的事件 ID
    last_event_version INTEGER,                        -- 最后处理的版本
    last_synced_at TIMESTAMP WITH TIME ZONE,

    -- 状态机
    status VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending / syncing / synced / failed / disabled
    failure_count INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    next_retry_at TIMESTAMP WITH TIME ZONE,

    -- 元信息
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    UNIQUE(company_id, projection_name, aggregate_type, aggregate_id)
);

CREATE INDEX idx_pss_company_status ON projection_sync_status(company_id, status);
CREATE INDEX idx_pss_aggregate ON projection_sync_status(aggregate_type, aggregate_id);
CREATE INDEX idx_pss_retry ON projection_sync_status(next_retry_at) WHERE status = 'failed';

COMMENT ON TABLE projection_sync_status IS '事件投影同步状态（任务包 §4.2 P0 AI）';

-- 验证
DO $$
DECLARE cnt INT;
BEGIN
    SELECT count(*) INTO cnt FROM projection_sync_status;
    RAISE NOTICE 'Migration 021 完成: projection_sync_status 表已创建（当前 % 条）', cnt;
END
$$;
