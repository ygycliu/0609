-- ============================================================
-- 客户跟进：添加出证机构字段
-- 文件：008_follow_up_issuing_body.sql
-- ============================================================

-- 添加 issuing_body 列
ALTER TABLE customer_follow_up
  ADD COLUMN IF NOT EXISTS issuing_body VARCHAR(50) DEFAULT 'zhongren';

-- 索引
CREATE INDEX IF NOT EXISTS idx_cfu_issuing_body
  ON customer_follow_up(company_id, issuing_body, year)
  WHERE deleted_at IS NULL;

-- 注释说明（3 类）：
--   zhongren   = 中认认证有限公司
--   huazhong   = 华中检测
--   other      = 其他