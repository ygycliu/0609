-- V2.3 合同模板引擎 - 数据库迁移（038）
-- 4 张新表 + 1 张关联（contract 加 2 字段）

BEGIN;

-- ============================================================
-- 1. contract_template - 模板主表
-- ============================================================
CREATE TABLE contract_template (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  code            VARCHAR(50) NOT NULL,
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  signing_entity_id UUID NOT NULL REFERENCES signing_entity(id),
  template_category VARCHAR(50) NOT NULL,
  contract_type    VARCHAR(50),
  chapter_count    INTEGER NOT NULL DEFAULT 0,
  file_format      VARCHAR(20) DEFAULT 'docx',
  template_path    TEXT NOT NULL,
  field_schema     JSONB NOT NULL DEFAULT '{}'::jsonb,
  chapter_schema   JSONB NOT NULL DEFAULT '{}'::jsonb,
  accent_colors    VARCHAR(20),
  status           VARCHAR(20) NOT NULL DEFAULT 'active',
  version          INTEGER NOT NULL DEFAULT 1,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT uq_contract_template UNIQUE(company_id, code, version)
);

COMMENT ON TABLE contract_template IS 'V2.3 逆向：合同模板库';
COMMENT ON COLUMN contract_template.code IS '模板编号，如 HZCX-01-3-D2 / ZRC-B104-D';
COMMENT ON COLUMN contract_template.contract_type IS 'HZCX 华中版 / ZRC 中认版 / EXTERNAL 外协版';
COMMENT ON COLUMN contract_template.chapter_count IS '章节数（华中 20 / 中认 9）';
COMMENT ON COLUMN contract_template.field_schema IS '字段定义（JSON Schema）';
COMMENT ON COLUMN contract_template.chapter_schema IS '章节结构 + 模板变量识别';

CREATE INDEX idx_ctemp_signing ON contract_template(signing_entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ctemp_category ON contract_template(template_category) WHERE deleted_at IS NULL;
CREATE INDEX idx_ctemp_type ON contract_template(contract_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_ctemp_status ON contract_template(status) WHERE deleted_at IS NULL;

-- ============================================================
-- 2. contract_template_version - 模板版本历史
-- ============================================================
CREATE TABLE contract_template_version (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES contract_template(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  file_path       TEXT NOT NULL,
  field_schema    JSONB NOT NULL DEFAULT '{}'::jsonb,
  chapter_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_note     TEXT,
  extracted_from_contract_id UUID,
  extraction_confidence NUMERIC(3,2),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contract_template_version UNIQUE(template_id, version)
);

COMMENT ON TABLE contract_template_version IS 'V2.3 逆向：版本历史 + 抽取来源追溯';
COMMENT ON COLUMN contract_template_version.extracted_from_contract_id IS '逆向抽取自哪个历史合同（用于反向追溯）';

CREATE INDEX idx_ctv_template ON contract_template_version(template_id);
CREATE INDEX idx_ctv_extracted ON contract_template_version(extracted_from_contract_id) WHERE extracted_from_contract_id IS NOT NULL;

-- ============================================================
-- 3. contract_field_dictionary - 字段字典
-- ============================================================
CREATE TABLE contract_field_dictionary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_code      VARCHAR(100) NOT NULL UNIQUE,
  field_label     VARCHAR(200) NOT NULL,
  field_category  VARCHAR(50) NOT NULL,
  data_type       VARCHAR(20) DEFAULT 'string',
  enum_options    JSONB,
  required        BOOLEAN DEFAULT FALSE,
  applies_to      TEXT[] DEFAULT ARRAY[]::TEXT[],
  description     TEXT,
  example_value   TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_field_dictionary IS 'V2.3：字段字典（30 个字段统一）';
COMMENT ON COLUMN contract_field_dictionary.field_code IS '字段名（camelCase，如 customer_name）';
COMMENT ON COLUMN contract_field_dictionary.field_category IS 'basic/cert/amount/bank/contact/date/system';
COMMENT ON COLUMN contract_field_dictionary.applies_to IS '适用于哪些模板类型（HZCX/ZRC/EXTERNAL）';

CREATE INDEX idx_field_category ON contract_field_dictionary(field_category);
CREATE INDEX idx_field_sort ON contract_field_dictionary(sort_order);

-- ============================================================
-- 4. contract_generation - 合同生成审计
-- ============================================================
CREATE TABLE contract_generation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL,
  template_id     UUID NOT NULL REFERENCES contract_template(id),
  template_version INTEGER NOT NULL,
  contract_id     UUID,
  customer_id     UUID NOT NULL REFERENCES customer(id),
  certification_project_id UUID,
  field_values    JSONB NOT NULL,
  output_format   VARCHAR(20) NOT NULL DEFAULT 'pdf',
  generated_file_path TEXT,
  pdf_file_id     UUID,
  generation_time_ms INTEGER,
  file_size       INTEGER,
  status          VARCHAR(20) NOT NULL DEFAULT 'success',
  error_message   TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contract_generation IS 'V2.3：合同生成历史（审计+追溯）';
COMMENT ON COLUMN contract_generation.template_version IS '生成时使用的模板版本';
COMMENT ON COLUMN contract_generation.field_values IS '实际填充的字段值';

CREATE INDEX idx_cgen_template ON contract_generation(template_id);
CREATE INDEX idx_cgen_contract ON contract_generation(contract_id);
CREATE INDEX idx_cgen_customer ON contract_generation(customer_id);
CREATE INDEX idx_cgen_created_at ON contract_generation(created_at);
CREATE INDEX idx_cgen_status ON contract_generation(status);

-- ============================================================
-- 5. 关联：contract 加 2 字段（V2.3 增强）
-- ============================================================
ALTER TABLE contract
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS generation_id UUID;

-- 加 FK（分别引用 contract_template 和 contract_generation）
-- contract_file_id 已有但表名在 contract_file，FK 加以下
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_contract_template'
                   AND table_name = 'contract') THEN
    ALTER TABLE contract
      ADD CONSTRAINT fk_contract_template
      FOREIGN KEY (template_id) REFERENCES contract_template(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'fk_contract_generation'
                   AND table_name = 'contract') THEN
    ALTER TABLE contract
      ADD CONSTRAINT fk_contract_generation
      FOREIGN KEY (generation_id) REFERENCES contract_generation(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_template ON contract(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_generation ON contract(generation_id) WHERE generation_id IS NOT NULL;

COMMENT ON COLUMN contract.template_id IS 'V2.3：生成此合同的模板';
COMMENT ON COLUMN contract.generation_id IS 'V2.3：生成审计记录';

-- ============================================================
-- 验证：表都创建成功
-- ============================================================
DO $$
DECLARE
  t TEXT;
  expected TEXT[] := ARRAY['contract_template', 'contract_template_version', 'contract_field_dictionary', 'contract_generation'];
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
    RAISE NOTICE '✅ V2.3 合同模板引擎迁移完成：创建 4 张表 + 关联 2 字段';
  END IF;
END $$;

COMMIT;