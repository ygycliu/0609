-- ============================================================
-- 财务管理模块数据库迁移
-- 文件：005_finance_module.sql
-- 说明：财务项目 + 交易流水 + 客户关联
-- ============================================================

-- 1. 财务项目表
CREATE TABLE IF NOT EXISTS finance_project (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL,
  customer_id        UUID,                                  -- 关联客户（FK customer.id）
  project_code       VARCHAR(50) NOT NULL,                  -- 项目编号，如 PRJ-2025-001
  name               VARCHAR(200) NOT NULL,                  -- 项目名称
  certification_type VARCHAR(50),                           -- QES / Q / QE / 27001 / 22000 等
  service_type       VARCHAR(50),                           -- 初审 / 监一 / 监二 / 再认证 / 咨询费 / 资质代办
  contract_amount    NUMERIC(12, 2) DEFAULT 0,              -- 合同总金额
  received_amount    NUMERIC(12, 2) DEFAULT 0,              -- 已收款（实时计算冗余，便于查询）
  paid_amount        NUMERIC(12, 2) DEFAULT 0,              -- 已付款（实时计算冗余）
  status             VARCHAR(30) DEFAULT 'draft',          -- draft / signed / in_progress / completed / archived
  signed_at          TIMESTAMPTZ,                            -- 签约日期
  started_at         TIMESTAMPTZ,                            -- 开始日期
  completed_at       TIMESTAMPTZ,                            -- 完成日期
  deadline_at        TIMESTAMPTZ,                            -- 截止日期
  notes              TEXT,                                   -- 备注
  owner_user_id      UUID,                                   -- 负责人
  tags               TEXT[],                                 -- 标签
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  UNIQUE(company_id, project_code)
);

-- 2. 财务交易流水表（收入/支出）
CREATE TABLE IF NOT EXISTS finance_transaction (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  project_id      UUID,                                  -- 关联项目（可空，支持公司层面收支）
  customer_id     UUID,                                  -- 关联客户（可空，支持非客户收支）
  type            VARCHAR(10) NOT NULL,                   -- income / expense
  category        VARCHAR(50) NOT NULL,                   -- 分类
  amount          NUMERIC(12, 2) NOT NULL,                  -- 金额
  trans_date      TIMESTAMPTZ NOT NULL,                     -- 收支日期
  description     VARCHAR(500),                            -- 描述
  payment_method  VARCHAR(30),                             -- 收款方式（银行转账 / 现金 / 微信）
  reference       VARCHAR(100),                             -- 凭证号 / 银行流水号
  ps              VARCHAR(200),                            -- 备注 / 经办人
  invoice_no      VARCHAR(50),                              -- 发票号
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_fin_proj_company  ON finance_project(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fin_proj_customer ON finance_project(customer_id);
CREATE INDEX IF NOT EXISTS idx_fin_proj_status   ON finance_project(status);
CREATE INDEX IF NOT EXISTS idx_fin_proj_signed   ON finance_project(signed_at);
CREATE INDEX IF NOT EXISTS idx_fin_proj_name_trgm ON finance_project USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_fin_tx_company    ON finance_transaction(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fin_tx_project    ON finance_transaction(project_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_customer   ON finance_transaction(customer_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_date      ON finance_transaction(trans_date);
CREATE INDEX IF NOT EXISTS idx_fin_tx_type      ON finance_transaction(type);
CREATE INDEX IF NOT EXISTS idx_fin_tx_category  ON finance_transaction(category);

-- 外键约束（不强制 ON DELETE，保留历史）
-- customer 表已有 deleted_at 字段，软删不影响 FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fin_proj_customer'
  ) THEN
    ALTER TABLE finance_project
      ADD CONSTRAINT fk_fin_proj_customer
      FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fin_tx_project'
  ) THEN
    ALTER TABLE finance_transaction
      ADD CONSTRAINT fk_fin_tx_project
      FOREIGN KEY (project_id) REFERENCES finance_project(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fin_tx_customer'
  ) THEN
    ALTER TABLE finance_transaction
      ADD CONSTRAINT fk_fin_tx_customer
      FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL;
  END IF;
END$$;
