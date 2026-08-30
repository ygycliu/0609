-- Migration 020 ROLLBACK
ALTER TABLE project_event DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE project_event DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE project_event DROP COLUMN IF EXISTS parent_event_id;
ALTER TABLE project_event DROP COLUMN IF EXISTS trace_id;
ALTER TABLE project_event DROP COLUMN IF EXISTS aggregate_version;
ALTER TABLE project_event DROP COLUMN IF EXISTS event_id;
DROP INDEX IF EXISTS idx_project_event_correlation;
DROP INDEX IF EXISTS idx_project_event_idempotency;
DROP INDEX IF EXISTS idx_project_event_trace;
DROP INDEX IF EXISTS idx_project_event_aggregate;
DROP INDEX IF EXISTS uq_project_event_event_id;
