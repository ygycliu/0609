-- V2.1 财务-认证项目关联迁移
-- 解决 finance_project/finance_transaction 无法追溯到具体认证项目的问题

BEGIN;

-- ============================================================
-- Step 1: 给 finance_project 加 certification_project_id
-- ============================================================
ALTER TABLE finance_project
ADD COLUMN IF NOT EXISTS certification_project_id UUID
REFERENCES certification_project(id);

COMMENT ON COLUMN finance_project.certification_project_id IS
  'V2.1：关联到具体认证项目（替代只关联 customer）';

CREATE INDEX IF NOT EXISTS idx_fin_project_cert_project
  ON finance_project(certification_project_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Step 2: 给 finance_transaction 加同样的字段
-- ============================================================
ALTER TABLE finance_transaction
ADD COLUMN IF NOT EXISTS certification_project_id UUID
REFERENCES certification_project(id);

COMMENT ON COLUMN finance_transaction.certification_project_id IS
  'V2.1：冗余字段，方便交易直接关联认证项目';

CREATE INDEX IF NOT EXISTS idx_fin_tx_cert_project
  ON finance_transaction(certification_project_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Step 3: 给 finance_ar 也加（虽然它一般按客户记）
-- ============================================================
ALTER TABLE finance_ar
ADD COLUMN IF NOT EXISTS certification_project_id UUID
REFERENCES certification_project(id);

COMMENT ON COLUMN finance_ar.certification_project_id IS
  'V2.1：可选关联到具体认证项目';

CREATE INDEX IF NOT EXISTS idx_fin_ar_cert_project
  ON finance_ar(certification_project_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Step 4: 自动迁移现有数据
-- 规则：
-- 1) 客户只有 1 个 cert_project → 直接关联
-- 2) 客户有 2+ 个 cert_project → 按认证类型关键字 + 时间最近匹配
-- ============================================================

-- 4.1 先给唯一 cert_project 的客户直接关联
UPDATE finance_project fp
SET certification_project_id = sc.id
FROM certification_project sc
WHERE fp.customer_id = sc.customer_id
  AND fp.deleted_at IS NULL
  AND sc.deleted_at IS NULL
  AND fp.certification_project_id IS NULL
  AND (
    SELECT COUNT(*)
    FROM certification_project sc2
    WHERE sc2.customer_id = fp.customer_id AND sc2.deleted_at IS NULL
  ) = 1;

-- 4.2 给有多个的客户，用时间最近匹配
-- （certification_type 字段不存在，scope 字段 98% 为空，所以直接用最近创建时间）
DO $$
DECLARE
  rec RECORD;
  matched_id UUID;
BEGIN
  FOR rec IN
    SELECT DISTINCT fp.id AS fin_id, fp.customer_id
    FROM finance_project fp
    WHERE fp.deleted_at IS NULL
      AND fp.customer_id IS NOT NULL
      AND fp.certification_project_id IS NULL
      AND (
        SELECT COUNT(*)
        FROM certification_project sc
        WHERE sc.customer_id = fp.customer_id AND sc.deleted_at IS NULL
      ) > 1
  LOOP
    -- 取最近创建的 cert_project
    SELECT sc.id INTO matched_id
    FROM certification_project sc
    WHERE sc.customer_id = rec.customer_id
      AND sc.deleted_at IS NULL
    ORDER BY sc.created_at DESC
    LIMIT 1;

    IF matched_id IS NOT NULL THEN
      UPDATE finance_project
      SET certification_project_id = matched_id
      WHERE id = rec.fin_id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Step 5: 同步 finance_transaction 的关联（冗余字段）
-- ============================================================
UPDATE finance_transaction ft
SET certification_project_id = fp.certification_project_id
FROM finance_project fp
WHERE ft.project_id = fp.id  -- 注意：transaction.project_id 可能指 finance_project 或别的
  AND ft.certification_project_id IS NULL
  AND fp.certification_project_id IS NOT NULL;

-- ============================================================
-- Step 6: 验证
-- ============================================================
DO $$
DECLARE
  total_count INT;
  linked_count INT;
  link_rate NUMERIC;
BEGIN
  SELECT COUNT(*) INTO total_count FROM finance_project WHERE deleted_at IS NULL;
  SELECT COUNT(*) INTO linked_count FROM finance_project WHERE deleted_at IS NULL AND certification_project_id IS NOT NULL;
  IF total_count > 0 THEN
    link_rate := (linked_count::numeric / total_count::numeric) * 100;
  ELSE
    link_rate := 0;
  END IF;
  RAISE NOTICE '关联迁移结果：总计 % 条，关联 % 条（%）', total_count, linked_count, link_rate;
END $$;

COMMIT;