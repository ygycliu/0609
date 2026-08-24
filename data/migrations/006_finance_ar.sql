-- ============================================================
-- 应收账款表（finance_ar）
-- 说明：记录客户欠款（合同/项目应收款）
-- 创建时间：2026-08-24
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_ar (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL,
  customer_id        UUID NOT NULL,                          -- 关联客户（FK customer.id）
  project_id         UUID,                                  -- 关联项目（FK finance_project.id，可选）

  -- 账单信息
  ar_no              VARCHAR(50) NOT NULL,                   -- 应收单号（如 AR-2025-001）
  title              VARCHAR(200) NOT NULL,                  -- 应收标题（如 "QES初次认证尾款"）
  description        TEXT,                                   -- 备注

  -- 金额
  total_amount       NUMERIC(12, 2) NOT NULL,                 -- 应收总额
  paid_amount        NUMERIC(12, 2) DEFAULT 0,                -- 已收金额
  remaining_amount   NUMERIC(12, 2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,

  -- 时间
  issue_date         TIMESTAMPTZ NOT NULL,                    -- 开票/账单日期
  due_date           TIMESTAMPTZ NOT NULL,                    -- 到期日
  paid_at            TIMESTAMPTZ,                            -- 最后收款时间

  -- 状态
  status             VARCHAR(20) DEFAULT 'pending',          -- pending / partial / paid / overdue / cancelled
  overdue_days       INT DEFAULT 0,

  -- 跟进
  last_remind_at     TIMESTAMPTZ,
  remind_count       INT DEFAULT 0,
  owner_user_id      UUID,

  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_fin_ar_company  ON finance_ar(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fin_ar_customer ON finance_ar(customer_id);
CREATE INDEX IF NOT EXISTS idx_fin_ar_project  ON finance_ar(project_id);
CREATE INDEX IF NOT EXISTS idx_fin_ar_status   ON finance_ar(status);
CREATE INDEX IF NOT EXISTS idx_fin_ar_due      ON finance_ar(due_date);
CREATE INDEX IF NOT EXISTS idx_fin_ar_ar_no    ON finance_ar(company_id, ar_no);

-- 外键
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_fin_ar_customer') THEN
    ALTER TABLE finance_ar ADD CONSTRAINT fk_fin_ar_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_fin_ar_project') THEN
    ALTER TABLE finance_ar ADD CONSTRAINT fk_fin_ar_project FOREIGN KEY (project_id) REFERENCES finance_project(id) ON DELETE SET NULL;
  END IF;
END$$;

-- AR 收款流水（多笔收款）
CREATE TABLE IF NOT EXISTS finance_ar_payment (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  ar_id         UUID NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL,
  payment_date  TIMESTAMPTZ NOT NULL,
  payment_method VARCHAR(30),
  reference          VARCHAR(100),
  notes          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fin_ar_pay_ar ON finance_ar_payment(ar_id) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_fin_ar_pay_ar') THEN
    ALTER TABLE finance_ar_payment ADD CONSTRAINT fk_fin_ar_pay_ar FOREIGN KEY (ar_id) REFERENCES finance_ar(id) ON DELETE CASCADE;
  END IF;
END$$;