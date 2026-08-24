-- ============================================================
-- 客户跟进模块
-- 文件：007_customer_follow_up.sql
-- 说明：客户日常跟进 + 阶段推进 + 年度归档
-- ============================================================

-- 1. 跟进主表
CREATE TABLE IF NOT EXISTS customer_follow_up (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL,
  customer_id         UUID NOT NULL,                       -- 关联客户
  project_id          UUID,                                -- 关联项目（可选）
  certification_type  VARCHAR(50),                        -- QES / Q / 27001 等

  -- 当前阶段（7 阶段）
  -- expired（到期）→ quoted（已报价）→ contract_review（合同评审）→ contract_signed（合同签订）→ implementing（项目实施）→ certified（出证）→ completed（完成）
  stage               VARCHAR(30) DEFAULT 'expired',
  year                INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INT,

  -- 关键日期
  expected_date       TIMESTAMPTZ,                          -- 预计完成日期（如到期日、合同签约日、出证日）
  completed_at        TIMESTAMPTZ,                          -- 当前阶段完成时间

  -- 金额（从报价/合同过来）
  expected_amount     NUMERIC(12, 2),                      -- 预计金额
  contract_amount     NUMERIC(12, 2),                      -- 合同金额

  -- 客户动态（JSON 自由文本）
  notes               TEXT,
  metadata            JSONB,                                -- 灵活扩展字段

  -- 负责人
  owner_user_id       UUID,

  -- 归档
  is_archived         BOOLEAN DEFAULT FALSE,
  archived_at         TIMESTAMPTZ,
  archived_year       INT,

  -- 时间
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_cfu_company  ON customer_follow_up(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cfu_customer ON customer_follow_up(customer_id);
CREATE INDEX IF NOT EXISTS idx_cfu_stage    ON customer_follow_up(stage);
CREATE INDEX IF NOT EXISTS idx_cfu_year     ON customer_follow_up(year);
CREATE INDEX IF NOT EXISTS idx_cfu_archived ON customer_follow_up(is_archived);
CREATE INDEX IF NOT EXISTS idx_cfu_proj     ON customer_follow_up(project_id);

-- 2. 跟进日志（每次阶段推进记录）
CREATE TABLE IF NOT EXISTS customer_follow_up_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  follow_up_id    UUID NOT NULL,
  from_stage      VARCHAR(30),
  to_stage        VARCHAR(30) NOT NULL,
  notes           TEXT,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cful_fup ON customer_follow_up_log(follow_up_id);

-- 外键
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cfu_customer'
  ) THEN
    ALTER TABLE customer_follow_up
      ADD CONSTRAINT fk_cfu_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cfu_project'
  ) THEN
    ALTER TABLE customer_follow_up
      ADD CONSTRAINT fk_cfu_project FOREIGN KEY (project_id) REFERENCES finance_project(id) ON DELETE SET NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cful_fup'
  ) THEN
    ALTER TABLE customer_follow_up_log
      ADD CONSTRAINT fk_cful_fup FOREIGN KEY (follow_up_id) REFERENCES customer_follow_up(id) ON DELETE CASCADE;
  END IF;
END$$;