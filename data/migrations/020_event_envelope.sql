-- ============================================================
-- Migration 020: 事件信封（event_id / aggregate_version / trace_id）
-- 任务包：§P0-C 第 1-3 步 + §5.4
-- ============================================================

-- ============================================================
-- 1. 给 project_event 增加事件信封字段
-- ============================================================
DO $$
BEGIN
    -- event_id（业务事件 ID，独立于物理主键 id）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'event_id') THEN
        ALTER TABLE project_event ADD COLUMN event_id UUID;
    END IF;

    -- aggregate_version（聚合版本号，递增）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'aggregate_version') THEN
        ALTER TABLE project_event ADD COLUMN aggregate_version INTEGER NOT NULL DEFAULT 1;
    END IF;

    -- trace_id（跨服务追踪 ID）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'trace_id') THEN
        ALTER TABLE project_event ADD COLUMN trace_id UUID;
    END IF;

    -- parent_event_id（事件因果链）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'parent_event_id') THEN
        ALTER TABLE project_event ADD COLUMN parent_event_id UUID;
    END IF;

    -- idempotency_key（事件幂等键）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'idempotency_key') THEN
        ALTER TABLE project_event ADD COLUMN idempotency_key VARCHAR(200);
    END IF;

    -- correlation_id（事件关联 ID，用于追踪链）
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'project_event' AND column_name = 'correlation_id') THEN
        ALTER TABLE project_event ADD COLUMN correlation_id VARCHAR(200);
    END IF;
END
$$;

-- ============================================================
-- 2. 回填 event_id（已有事件用 id 替代）
-- ============================================================
UPDATE project_event
SET event_id = id
WHERE event_id IS NULL;

-- ============================================================
-- 3. 索引
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_event_event_id ON project_event(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_event_aggregate ON project_event(project_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_project_event_trace ON project_event(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_event_idempotency ON project_event(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_event_correlation ON project_event(correlation_id) WHERE correlation_id IS NOT NULL;

-- ============================================================
-- 4. 验证
-- ============================================================
DO $$
DECLARE
    total_count INT;
    with_event_id INT;
BEGIN
    SELECT count(*) INTO total_count FROM project_event;
    SELECT count(*) INTO with_event_id FROM project_event WHERE event_id IS NOT NULL;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 020 完成';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'project_event 总数: %', total_count;
    RAISE NOTICE '已有 event_id: %', with_event_id;
    RAISE NOTICE '新增字段: aggregate_version / trace_id / parent_event_id / idempotency_key / correlation_id';
    RAISE NOTICE '========================================';
END
$$;
