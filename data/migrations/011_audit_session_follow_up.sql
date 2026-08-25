-- ============================================================
-- 关联跟进 ↔ 审核计划（011_follow_up_audit_session.sql）
-- 创建时间：2026-08-25
-- ============================================================

ALTER TABLE audit_session
  ADD COLUMN IF NOT EXISTS follow_up_id UUID,
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN audit_session.follow_up_id IS '关联的跟进 ID（customer_follow_up.id）';
COMMENT ON COLUMN audit_session.auto_generated IS '是否由跟进模块自动生成';

-- 外键约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_audit_session_follow_up'
  ) THEN
    ALTER TABLE audit_session
      ADD CONSTRAINT fk_audit_session_follow_up
      FOREIGN KEY (follow_up_id) REFERENCES customer_follow_up(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_audit_session_follow_up
  ON audit_session(follow_up_id) WHERE follow_up_id IS NOT NULL;