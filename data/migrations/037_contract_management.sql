-- V2.2 合同管理模块 - 数据库迁移
-- 包含 4 张主表 + 2 张辅助表 + 索引 + 注释

BEGIN;

-- ============================================================
-- 1. contract - 合同主表
-- ============================================================
CREATE TABLE contract (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL,
  customer_id         UUID NOT NULL REFERENCES customer(id),
  contract_no         VARCHAR(200) NOT NULL,
  contract_type       VARCHAR(20) NOT NULL DEFAULT 'main',
  parent_contract_id  UUID,
  signing_entity_id   UUID NOT NULL REFERENCES signing_entity(id),
  title               VARCHAR(300),
  contract_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  certification_types TEXT[] DEFAULT ARRAY[]::TEXT[],
  signed_at           DATE,
  effective_at        DATE,
  expire_at           DATE,
  bank_name           VARCHAR(100),
  bank_account        VARCHAR(50),
  bank_holder         VARCHAR(100),
  contact_person      VARCHAR(50),
  contact_phone       VARCHAR(30),
  service_type        VARCHAR(50),
  status              VARCHAR(20) NOT NULL DEFAULT 'draft',
  raw_extracted       JSONB,
  extraction_confidence NUMERIC(3,2),
  source              VARCHAR(20) NOT NULL DEFAULT 'pdf_import',
  notes               TEXT,
  file_id             UUID,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE contract IS 'V2.2：合同主表';
COMMENT ON COLUMN contract.contract_no IS '合同编号（支持多编号用 | 分隔）';
COMMENT ON COLUMN contract.contract_type IS 'main 主合同 / supplement 补充协议 / change 合同变更 / terminate 终止协议';
COMMENT ON COLUMN contract.parent_contract_id IS '补充协议/合同变更指向主合同';
COMMENT ON COLUMN contract.certification_types IS '认证体系数组，如 {QMS,EMS,OHSMS}';
COMMENT ON COLUMN contract.raw_extracted IS 'V2.2：AI 抽取的原始结构化 JSON';
COMMENT ON COLUMN contract.extraction_confidence IS 'V2.2：AI 抽取的整体置信度 0-1';
COMMENT ON COLUMN contract.source IS 'pdf_import PDF 导入 / manual 手动 / api 外部 API';

CREATE INDEX idx_contract_customer ON contract(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_signing ON contract(signing_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_status ON contract(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_no ON contract(contract_no);
CREATE INDEX idx_contract_amount ON contract(contract_amount) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_signed_at ON contract(signed_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_contract_parent ON contract(parent_contract_id) WHERE deleted_at IS NULL;

-- 加 self-FK（parent_contract_id 指向 contract.id）
ALTER TABLE contract
ADD CONSTRAINT fk_contract_parent
FOREIGN KEY (parent_contract_id) REFERENCES contract(id);

-- ============================================================
-- 2. contract_file - 合同文件
-- ============================================================
CREATE TABLE contract_file (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  file_name     VARCHAR(300) NOT NULL,
  file_type     VARCHAR(20) NOT NULL,
  file_size     BIGINT NOT NULL,
  storage_path  TEXT NOT NULL,
  sha256        VARCHAR(64),
  ocr_status    VARCHAR(20) NOT NULL DEFAULT 'pending',
  ocr_text      TEXT,
  ocr_extracted JSONB,
  version       INTEGER NOT NULL DEFAULT 1,
  is_primary    BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE contract_file IS 'V2.2：合同文件（支持多版本/补充协议）';
COMMENT ON COLUMN contract_file.ocr_status IS 'pending/processing/done/failed/skipped';
COMMENT ON COLUMN contract_file.ocr_extracted IS 'V2.2：AI 二次结构化结果';

CREATE INDEX idx_cfile_contract ON contract_file(contract_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cfile_sha ON contract_file(sha256);
CREATE INDEX idx_cfile_ocr_status ON contract_file(ocr_status) WHERE deleted_at IS NULL AND ocr_status = 'pending';

-- 加 contract.file_id 外键（虽然 contract 已有，但 file 引用是循环）
-- 跳过此 FK（应用层维护），避免循环依赖

-- ============================================================
-- 3. contract_project - 合同↔项目关联
-- ============================================================
CREATE TABLE contract_project (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  certification_project_id UUID NOT NULL REFERENCES certification_project(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(12,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contract_project UNIQUE(contract_id, certification_project_id)
);

COMMENT ON TABLE contract_project IS 'V2.2：合同与认证项目 M:N 关联';
COMMENT ON COLUMN contract_project.allocated_amount IS '该合同在此项目的分摊金额';

CREATE INDEX idx_cp_contract ON contract_project(contract_id);
CREATE INDEX idx_cp_cert ON contract_project(certification_project_id);

-- ============================================================
-- 4. contract_event - 合同事件流
-- ============================================================
CREATE TABLE contract_event (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  contract_id   UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  event_type    VARCHAR(30) NOT NULL,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20),
  payload       JSONB,
  operator_id   UUID,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_event IS 'V2.2：合同状态事件流（追溯用）';
COMMENT ON COLUMN contract_event.event_type IS 'created/signed/amended/terminated/renewed/file_uploaded';

CREATE INDEX idx_cevent_contract ON contract_event(contract_id);
CREATE INDEX idx_cevent_type ON contract_event(event_type);

-- ============================================================
-- 5. customer_alias - 客户别名（V2.2 反向补全关键）
-- ============================================================
CREATE TABLE customer_alias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  customer_id   UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  alias_name    VARCHAR(200) NOT NULL,
  source        VARCHAR(50),
  match_count   INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customer_alias UNIQUE(company_id, alias_name)
);

COMMENT ON TABLE customer_alias IS 'V2.2：客户别名（合同/发票上可能写法不同）';
COMMENT ON COLUMN customer_alias.match_count IS '匹配次数，用于智能推荐';

CREATE INDEX idx_alias_name ON customer_alias(alias_name);
CREATE INDEX idx_alias_customer ON customer_alias(customer_id);

-- ============================================================
-- 6. contract_import_batch - 批量导入批次（V2.2 关键）
-- ============================================================
CREATE TABLE contract_import_batch (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  batch_name    VARCHAR(200),
  source_path   VARCHAR(500),
  total_files   INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'processing',
  operator_id   UUID,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

COMMENT ON TABLE contract_import_batch IS 'V2.2：批量导入批次（PDF 扫描 /mnt/renz/...）';
COMMENT ON COLUMN contract_import_batch.status IS 'processing/awaiting_review/completed/failed';

CREATE INDEX idx_cbatch_status ON contract_import_batch(status) WHERE status IN ('processing', 'awaiting_review');

-- ============================================================
-- 7. 验证：表都创建成功
-- ============================================================
DO $$
DECLARE
  t TEXT;
  expected TEXT[] := ARRAY['contract', 'contract_file', 'contract_project', 'contract_event', 'customer_alias', 'contract_import_batch'];
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOREACH t IN ARRAY expected LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      missing := array_append(missing, t);
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION '缺失表: %', missing;
  ELSE
    RAISE NOTICE '✅ V2.2 合同管理迁移完成：创建 6 张表';
  END IF;
END $$;

COMMIT;