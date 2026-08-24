-- ============================================================
-- 待办事项表
-- 文件：009_todo.sql
-- 创建时间：2026-08-24
-- ============================================================

CREATE TABLE IF NOT EXISTS todo (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  owner_user_id UUID,                                          -- 谁创建的（系统/AI/用户）
  assigned_to   UUID,                                          -- 指派给谁

  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  category      VARCHAR(30) DEFAULT 'general',                -- general / follow_up / admin / learning

  -- 来源
  source        VARCHAR(30) DEFAULT 'manual',                  -- manual / yoooclaw_recording / notification
  source_ref    TEXT,                                          -- 来源标识（如录音 ID / 通知 ID）
  recording_id  VARCHAR(100),                                  -- 关联录音 ID（如果是录音转写）

  -- 时间
  due_at        TIMESTAMPTZ,
  remind_at     TIMESTAMPTZ,

  -- 状态
  status        VARCHAR(20) DEFAULT 'pending',                  -- pending / in_progress / done / cancelled
  priority      VARCHAR(10) DEFAULT 'normal',                  -- low / normal / high / urgent

  -- 完成
  completed_at  TIMESTAMPTZ,
  completed_by  UUID,

  -- 关联（可选）
  customer_id   UUID,                                          -- 关联客户
  follow_up_id  UUID,                                          -- 关联跟进

  -- 元数据
  tags          JSONB,
  metadata      JSONB,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_todo_company  ON todo(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_owner    ON todo(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_assigned ON todo(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_status   ON todo(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_due      ON todo(due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_todo_source   ON todo(source, source_ref) WHERE deleted_at IS NULL;

-- 外键
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_todo_customer') THEN
    ALTER TABLE todo ADD CONSTRAINT fk_todo_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_todo_follow_up') THEN
    ALTER TABLE todo ADD CONSTRAINT fk_todo_follow_up FOREIGN KEY (follow_up_id) REFERENCES customer_follow_up(id) ON DELETE SET NULL;
  END IF;
END$$;

-- 录音转写持久化
CREATE TABLE IF NOT EXISTS yoooclaw_recording_import (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  recording_id  VARCHAR(100) NOT NULL,
  recording_name VARCHAR(200),
  transcript    TEXT NOT NULL,
  summary       TEXT,
  duration_sec  INT,
  imported_at   TIMESTAMPTZ DEFAULT NOW(),
  routes        JSONB,                                          -- { knowledge: [], todo: [], follow_up: [] }
  status        VARCHAR(20) DEFAULT 'processed',               -- processed / failed
  error         TEXT,
  UNIQUE(company_id, recording_id)
);

CREATE INDEX IF NOT EXISTS idx_yri_recording ON yoooclaw_recording_import(recording_id);