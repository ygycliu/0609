-- ============================================================
-- Migration 025: 审核员档案 - 证书 JSON 存储
-- 用途：同一审核员多张证书图片统一管理
-- 案例：崔荣 持 QMS/EMS/OHSMS 三张证书
-- ============================================================

ALTER TABLE auditor_profile
  ADD COLUMN IF NOT EXISTS certificates JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN auditor_profile.certificates IS '证书列表 JSON: [{code, type, name, file, issuedAt, expiresAt, status, note}]';
COMMENT ON COLUMN auditor_profile.attachments IS '附件列表 JSON: [{name, path, type, size, uploadedAt}]';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE auditor_profile DROP COLUMN IF EXISTS certificates, DROP COLUMN IF EXISTS attachments;
