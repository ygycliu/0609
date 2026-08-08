
-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 全文搜索 + trigram

-- ==============================
-- 1. 公司 (company) - 多租户
-- ==============================
CREATE TABLE IF NOT EXISTS company (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    short_name VARCHAR(50),
    unified_credit_code VARCHAR(50),
    industry VARCHAR(100),
    address TEXT,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(200),
    certification_body VARCHAR(200),  -- 关联发证机构
    status VARCHAR(20) DEFAULT 'active', -- active / suspended / closed
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_company_status ON company(status);

-- ==============================
-- 2. 用户 (user) - 关联公司
-- ==============================
CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'regular',  -- admin / regular
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(company_id, username)
);

CREATE INDEX IF NOT EXISTS idx_user_company ON app_user(company_id);
CREATE INDEX IF NOT EXISTS idx_user_email ON app_user(email);

-- ==============================
-- 3. 客户档案 (customer)
-- ==============================
CREATE TABLE IF NOT EXISTS customer (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    customer_code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    industry VARCHAR(100),
    employee_count INT,
    region VARCHAR(100),
    address TEXT,
    contact_person VARCHAR(100),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(200),
    source VARCHAR(50),  -- 线索来源
    owner_user_id UUID REFERENCES app_user(id),
    status VARCHAR(20) DEFAULT 'active',  -- active / lost / closed
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(company_id, customer_code)
);

CREATE INDEX IF NOT EXISTS idx_customer_company ON customer(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_name_trgm ON customer USING gin(name gin_trgm_ops);

-- ==============================
-- 4. 认证产品 (certification_product)
-- ==============================
CREATE TABLE IF NOT EXISTS certification_product (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,  -- 如 ISO 9001, ISO 14001
    standard_code VARCHAR(50),  -- 如 GB/T 19001
    category VARCHAR(50),  -- Q (质量) / E (环境) / S (职业健康) / I (信息安全) / F (食品)
    level VARCHAR(20),  -- basic / high
    base_price DECIMAL(10,2),  -- 基础人日单价
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_product_company ON certification_product(company_id);

-- ==============================
-- 5. 价格规则 (pricing_rule) - 配置化
-- ==============================
CREATE TABLE IF NOT EXISTS pricing_rule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES certification_product(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    rule_type VARCHAR(50) NOT NULL,  -- base / employee_count / industry / risk_level / multi_cert / custom_discount
    condition JSONB NOT NULL,  -- 触发条件
    formula VARCHAR(500) NOT NULL,  -- 计算公式
    priority INT DEFAULT 0,  -- 优先级
    is_active BOOLEAN DEFAULT TRUE,
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_company ON pricing_rule(company_id);
CREATE INDEX IF NOT EXISTS idx_pricing_product ON pricing_rule(product_id);

-- ==============================
-- 6. 报价 (quote)
-- ==============================
CREATE TABLE IF NOT EXISTS quote (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    quote_code VARCHAR(50) NOT NULL,  -- QT-2026-001
    customer_id UUID NOT NULL REFERENCES customer(id),
    owner_user_id UUID REFERENCES app_user(id),
    industry VARCHAR(100),
    employee_count INT,
    risk_level VARCHAR(20),  -- low / medium / high
    product_ids UUID[] NOT NULL,
    items JSONB NOT NULL,  -- 明细
    subtotal DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'CNY',
    valid_until DATE,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'draft',  -- draft / pending_review / pending_approval / approved / sent / archived
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(company_id, quote_code)
);

CREATE INDEX IF NOT EXISTS idx_quote_customer ON quote(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_status ON quote(status);

-- ==============================
-- 7. 咨询项目 (consultation_project)
-- ==============================
CREATE TABLE IF NOT EXISTS consultation_project (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    project_code VARCHAR(50) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customer(id),
    owner_user_id UUID REFERENCES app_user(id),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'active',  -- active / completed / archived
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(company_id, project_code)
);

CREATE INDEX IF NOT EXISTS idx_project_customer ON consultation_project(customer_id);
CREATE INDEX IF NOT EXISTS idx_project_status ON consultation_project(status);

-- ==============================
-- 8. 成果物 (deliverable) - 5 种之一
-- ==============================
CREATE TABLE IF NOT EXISTS deliverable (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES consultation_project(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,  -- selection_diagnosis / implementation_plan / quote / audit_checklist / supervision_plan
    title VARCHAR(200) NOT NULL,
    content JSONB,  -- AI 生成的 markdown / json 内容
    file_path TEXT,  -- 导出文件路径
    version INT DEFAULT 1,
    status VARCHAR(20) DEFAULT 'draft',  -- draft / pending_review / pending_approval / approved / sent / archived
    reviewed_by UUID REFERENCES app_user(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    approved_by UUID REFERENCES app_user(id),
    approved_at TIMESTAMPTZ,
    approval_notes TEXT,
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deliverable_project ON deliverable(project_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_status ON deliverable(status);
CREATE INDEX IF NOT EXISTS idx_deliverable_type ON deliverable(type);

-- ==============================
-- 9. 审核记录 (review)
-- ==============================
CREATE TABLE IF NOT EXISTS deliverable_review (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deliverable_id UUID NOT NULL REFERENCES deliverable(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES app_user(id),
    action VARCHAR(20) NOT NULL,  -- review / approve / reject / comment
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_deliverable ON deliverable_review(deliverable_id);

-- ==============================
-- 10. 知识文档 (knowledge_document) + 知识分块 (knowledge_chunk) + 版本
-- ==============================
CREATE TABLE IF NOT EXISTS knowledge_document (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    doc_code VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    category VARCHAR(50),  -- 01-认证体系 / 02-客户合同 / 04-认证标准 ...
    subcategory VARCHAR(100),
    file_path TEXT,  -- 原始文件
    file_type VARCHAR(20),  -- md / pdf / docx
    file_size BIGINT,
    content_text TEXT,  -- 解析后的纯文本
    confidentiality VARCHAR(20) DEFAULT 'internal',  -- public / internal / confidential
    business_value VARCHAR(20) DEFAULT 'medium',  -- high / medium / low
    source VARCHAR(200),  -- 来源
    status VARCHAR(20) DEFAULT 'active',  -- active / archived / deprecated
    current_version INT DEFAULT 1,
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(company_id, doc_code)
);

CREATE INDEX IF NOT EXISTS idx_kdoc_company ON knowledge_document(company_id);
CREATE INDEX IF NOT EXISTS idx_kdoc_category ON knowledge_document(category);
CREATE INDEX IF NOT EXISTS idx_kdoc_title_trgm ON knowledge_document USING gin(title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),  -- 默认 1024 维，可改
    metadata JSONB,  -- 位置、章节、页码等
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunk_document ON knowledge_chunk(document_id);
-- pgvector HNSW 索引（快速近似最近邻）
CREATE INDEX IF NOT EXISTS idx_chunk_embedding ON knowledge_chunk USING hnsw (embedding vector_cosine_ops);
-- pgvector IVFFlat 索引（备选）
CREATE INDEX IF NOT EXISTS idx_chunk_embedding_ivf ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS knowledge_version (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    version INT NOT NULL,
    file_path TEXT,
    content_text TEXT,
    change_summary TEXT,
    created_by UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_kversion_doc ON knowledge_version(document_id);

-- ==============================
-- 11. 审计日志 (audit_log)
-- ==============================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES company(id),
    user_id UUID REFERENCES app_user(id),
    action VARCHAR(50) NOT NULL,  -- login / create / update / delete / approve / reject
    resource_type VARCHAR(50),  -- quote / customer / project / deliverable / user
    resource_id UUID,
    method VARCHAR(10),  -- GET / POST / PUT / DELETE
    path TEXT,
    ip INET,
    user_agent TEXT,
    request_body JSONB,
    response_status INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- 初始化默认公司（你的中认认证宁夏分公司）
INSERT INTO company (id, name, short_name, industry, status)
VALUES ('00000000-0000-0000-0000-000000000001', '中认认证宁夏分公司', '中认宁夏', '认证', 'active')
ON CONFLICT (id) DO NOTHING;

-- 初始化默认管理员用户。占位哈希不可用于登录，部署时必须生成一次性临时密码。
INSERT INTO app_user (id, company_id, username, email, password_hash, display_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'admin',
    'admin@zhongrennx.local',
    '$2b$10$PLACEHOLDER_REPLACE_AFTER_FIRST_RUN',
    '系统管理员',
    'admin'
)
ON CONFLICT (id) DO NOTHING;

-- 初始化 5 个核心产品（你的认证体系）
INSERT INTO certification_product (company_id, code, name, category, level, base_price, description) VALUES
    ('00000000-0000-0000-0000-000000000001', 'ISO9001', 'ISO 9001 质量管理体系', 'Q', 'basic', 5000, 'GB/T 19001 质量管理体系'),
    ('00000000-0000-0000-0000-000000000001', 'ISO14001', 'ISO 14001 环境管理体系', 'E', 'basic', 5000, 'GB/T 24001 环境管理体系'),
    ('00000000-0000-0000-0000-000000000001', 'ISO45001', 'ISO 45001 职业健康安全', 'S', 'basic', 5000, 'GB/T 45001 职业健康安全管理体系'),
    ('00000000-0000-0000-0000-000000000001', 'ISO27001', 'ISO 27001 信息安全', 'I', 'high', 13000, 'GB/T 22080 信息安全管理体系'),
    ('00000000-0000-0000-0000-000000000001', 'HACCP', 'HACCP 食品安全', 'F', 'basic', 8000, 'HACCP 危害分析与关键控制点')
ON CONFLICT (company_id, code) DO NOTHING;

-- 初始化价格规则（按你 DLE 里的 audit_days）
INSERT INTO pricing_rule (company_id, product_id, name, rule_type, condition, formula, priority)
SELECT '00000000-0000-0000-0000-000000000001', cp.id, '人日基础', 'base', '{"unit":"man_day"}', 'base_price * 1.0', 100
FROM certification_product cp WHERE cp.code = 'ISO9001'
ON CONFLICT DO NOTHING;

INSERT INTO pricing_rule (company_id, product_id, name, rule_type, condition, formula, priority)
SELECT '00000000-0000-0000-0000-000000000001', cp.id, '100人以下系数', 'employee_count', '{"min":0,"max":100}', '1.0', 50
FROM certification_product cp WHERE cp.code = 'ISO9001'
ON CONFLICT DO NOTHING;

INSERT INTO pricing_rule (company_id, product_id, name, rule_type, condition, formula, priority)
SELECT '00000000-0000-0000-0000-000000000001', cp.id, '100-300人系数', 'employee_count', '{"min":100,"max":300}', '1.15', 50
FROM certification_product cp WHERE cp.code = 'ISO9001'
ON CONFLICT DO NOTHING;
