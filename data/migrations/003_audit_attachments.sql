-- 003_audit_attachments.sql
-- 数字审核员：报告级附件 + YoooClaw 录音关联

-- 1. 报告级附件表（每个审核会话的报告附件）
CREATE TABLE IF NOT EXISTS audit_report_attachment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES audit_session(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES company(id),
  -- 来源区分
  source TEXT NOT NULL DEFAULT 'manual_upload'
    CHECK (source IN ('manual_upload', 'yoooclaw_recording', 'yoooclaw_image')),
  -- 文件信息
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,                     -- 服务器存储路径
  file_type TEXT NOT NULL,                     -- 扩展名（无点）
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  -- YoooClaw 录音专用字段
  yoooclaw_recording_id TEXT,                  -- YoooClaw 录音 ID
  duration_seconds INT,                        -- 录音时长
  transcription_id TEXT,                       -- 转写 ID（如有）
  -- 分类（照片 / 录音 / 文档 / 其他）
  category TEXT NOT NULL DEFAULT 'document'
    CHECK (category IN ('photo', 'recording', 'document', 'video', 'other')),
  -- 元数据
  caption TEXT,                                -- 用户备注
  uploaded_by_user_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_attach_session
  ON audit_report_attachment(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_attach_company
  ON audit_report_attachment(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_attach_source
  ON audit_report_attachment(source, created_at DESC);

-- 2. YoooClaw 录音同步日志（避免重复拉取）
CREATE TABLE IF NOT EXISTS yoooclaw_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recording_id TEXT NOT NULL UNIQUE,            -- YoooClaw 录音 ID
  file_path TEXT,                                -- 下载后本地路径
  status TEXT DEFAULT 'downloaded'
    CHECK (status IN ('downloaded', 'matched', 'failed')),
  matched_session_id UUID REFERENCES audit_session(id),
  matched_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_yoooclaw_status ON yoooclaw_sync_log(status, created_at DESC);

-- 3. 给 audit_session 加字段：report 状态 + 出报告前附件确认
ALTER TABLE audit_session ADD COLUMN IF NOT EXISTS
  attachments_ready BOOLEAN DEFAULT false;       -- 出报告前附件是否就绪

COMMENT ON TABLE audit_report_attachment IS
  '数字审核员：报告级附件（现场照片、YoooClaw 录音、文档等）';
COMMENT ON TABLE yoooclaw_sync_log IS
  'YoooClaw 录音同步日志 - 防止重复拉取';
COMMENT ON COLUMN audit_session.attachments_ready IS
  '出报告前附件是否就绪（false 阻止出报告）';