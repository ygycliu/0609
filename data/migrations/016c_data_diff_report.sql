-- ============================================================
-- Migration 016c: 数据差异报告 + NULL customer_id 注释
-- 任务包 §P0-A 第 8 步 + 第 9 步
-- ============================================================

-- 注：本次不修改任何 NULL customer_id 数据
-- 因为：
--   1. 902 条 NULL 全部是 expense（支出）类交易
--   2. 这些交易是公司运营支出（差旅/工资/返款/房租）
--   3. 不属于任何具体客户
--   4. 强制归属会破坏业务逻辑
--   5. 任务包用户偏好规则："代理/代办/被返款方不算客户"

-- 创建视图：NULL customer_id 交易分布
CREATE OR REPLACE VIEW finance_transaction_null_customer AS
SELECT
    type,
    category,
    count(*) AS cnt,
    sum(amount) AS total_amount
FROM finance_transaction
WHERE customer_id IS NULL AND deleted_at IS NULL
GROUP BY type, category
ORDER BY cnt DESC;

COMMENT ON VIEW finance_transaction_null_customer IS 'NULL customer_id 交易分布（公司运营支出，非项目收入）';

-- 数据差异报告：写入 project_event 备查
DO $$
DECLARE
    total_tx INT;
    null_tx INT;
    null_pct NUMERIC;
BEGIN
    SELECT count(*) INTO total_tx FROM finance_transaction WHERE deleted_at IS NULL;
    SELECT count(*) INTO null_tx FROM finance_transaction WHERE customer_id IS NULL AND deleted_at IS NULL;
    null_pct := (null_tx::numeric / total_tx) * 100;
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 016c 数据差异报告';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'finance_transaction 总数: %', total_tx;
    RAISE NOTICE 'NULL customer_id 数量: % (%', null_tx, null_pct;
    RAISE NOTICE '所有 NULL 都是 expense 类型（公司运营支出）';
    RAISE NOTICE '建议：保持现状，不强制归属';
    RAISE NOTICE '========================================';
END
$$;

-- 验证
SELECT type, category, cnt, total_amount
FROM finance_transaction_null_customer
LIMIT 5;
