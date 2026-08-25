-- ============================================================
-- 跟进关闭字段（010_follow_up_close.sql）
-- 创建时间：2026-08-25
-- ============================================================

ALTER TABLE customer_follow_up
  ADD COLUMN IF NOT EXISTS close_reason VARCHAR(50),
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID;

COMMENT ON COLUMN customer_follow_up.close_reason IS
  '关闭原因枚举：certified_and_delivered=出证交付完成 / customer_declined=客户拒绝 / price_too_high=价格原因 / unable_to_contact=联系不上 / customer_lost=客户流失 / other=其他';
COMMENT ON COLUMN customer_follow_up.closed_at IS '关闭时间';
COMMENT ON COLUMN customer_follow_up.closed_by IS '关闭操作者';

CREATE INDEX IF NOT EXISTS idx_cfu_closed ON customer_follow_up(closed_at) WHERE deleted_at IS NULL;