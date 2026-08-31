-- ============================================================
-- Migration 023: 加 finance_transaction.trans_month 字段
-- 用途：业务归属月份（YYYY-MM-01），区别于制单日期 trans_date
-- ============================================================

-- 添加字段（可空，已有数据为 NULL）
ALTER TABLE finance_transaction
  ADD COLUMN IF NOT EXISTS trans_month DATE;

-- 添加索引（按月聚合加速）
CREATE INDEX IF NOT EXISTS idx_fin_tx_month ON finance_transaction(company_id, trans_month) WHERE deleted_at IS NULL;

-- 添加注释
COMMENT ON COLUMN finance_transaction.trans_month IS '业务归属月份（YYYY-MM-01），区别于制单日期 trans_date';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP INDEX IF EXISTS idx_fin_tx_month;
-- ALTER TABLE finance_transaction DROP COLUMN IF EXISTS trans_month;
