-- ============================================================
-- Migration 029: 批量补建认证证书（从 finance_project 自动推断）
-- 规则：
-- - name 格式：'客户名 | 类型'（注意：历史数据只有 2 段）
-- - 类型含'初审/再认证/初次'：新建证书（3 年期）
-- - 按客户 + 体系 唯一
-- ============================================================

BEGIN;

-- ============================================================
-- 步骤 1：推断证书类型名称（基于名称模式）
-- ============================================================

CREATE OR REPLACE FUNCTION infer_cert_type_name(cert_type TEXT) RETURNS TEXT AS $$
DECLARE
  base TEXT;
BEGIN
  base := trim(cert_type);
  -- 移除阶段词
  base := REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(base, '初审.*$', ''), '再认证.*$', ''), '监督[一二三]?.*$', ''), '年审.*$', '');
  base := trim(base);

  IF base ~ 'QESJ' OR base ~ '^QES$' THEN
    RETURN 'QES三体系';
  ELSIF base ~ 'QE' AND base !~ 'QES' THEN
    RETURN 'QE两体系（Q+E）';
  ELSIF base ~ 'QJES' THEN
    RETURN 'QMS质量管理体系';
  ELSIF base ~ '27001' THEN
    RETURN 'ISMS信息安全管理体系';
  ELSIF base ~ '20000' THEN
    RETURN 'ITSMS IT服务管理体系';
  ELSIF base ~ '22301' OR base ~ '业务连续性' THEN
    RETURN 'BCMS业务连续性管理体系';
  ELSIF base ~ '能源' THEN
    RETURN '能源管理体系';
  ELSIF base ~ 'AAA' THEN
    RETURN '企业信用AAA';
  ELSIF base ~ 'HSE' OR base ~ 'OHS' OR base ~ '职业健康' THEN
    RETURN 'OHSMS职业健康安全';
  ELSIF base ~ 'FS' OR base ~ '食品' THEN
    RETURN 'FSMS食品安全';
  ELSIF base ~ 'CCRC' THEN
    RETURN 'CCRC信息安全服务';
  ELSIF base ~ '绿色' THEN
    RETURN '绿色管理体系';
  ELSIF base ~ 'ITSS' THEN
    RETURN 'ITSS信息技术服务';
  ELSIF base ~ 'CMMI' THEN
    RETURN 'CMMI软件能力成熟度';
  ELSIF base ~ 'SC' OR base ~ '供应链' THEN
    RETURN 'SC供应链管理';
  ELSIF base ~ 'ES' AND base !~ 'E$' THEN
    RETURN 'EMS+OHSMS两体系';
  ELSIF base ~ 'FSHA' THEN
    RETURN 'FSMS食品安全+HACCP';
  ELSIF base ~ 'QS' THEN
    RETURN 'QMS+EMS两体系';
  ELSIF base ~ 'S' AND base !~ 'SC' THEN
    RETURN 'OHSMS职业健康安全';
  ELSIF base ~ 'E' AND base !~ 'ES' THEN
    RETURN 'EMS环境管理';
  ELSIF base ~ '^Q$' THEN
    RETURN 'QMS质量管理体系';
  ELSE
    RETURN base;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 步骤 2：推断标准代码
-- ============================================================

CREATE OR REPLACE FUNCTION infer_cert_standard(cert_type TEXT) RETURNS TEXT AS $$
DECLARE
  base TEXT := upper(trim(cert_type));
  stds TEXT := '';
BEGIN
  IF base ~ 'QES' AND base !~ 'QESJ' THEN
    stds := 'GB/T 19001-2016 + GB/T 24001-2016 + GB/T 45001-2020';
  ELSIF base ~ 'QE' AND base !~ 'QES' THEN
    stds := 'GB/T 19001-2016 + GB/T 24001-2016';
  ELSIF base ~ '27001' THEN
    stds := 'GB/T 22080-2024 + ISO/IEC 27001:2022';
  ELSIF base ~ '20000' THEN
    stds := 'GB/T 24405.1-2009 + ISO/IEC 20000-1:2018';
  ELSIF base ~ '22301' OR base ~ '业务连续性' THEN
    stds := 'GB/T 33477-2024 + ISO 22301:2019';
  ELSIF base ~ '能源' THEN
    stds := 'GB/T 23331-2020 + ISO 50001:2018';
  ELSIF base ~ 'AAA' THEN
    stds := 'GB/T 31950-2015';
  ELSIF base ~ 'HSE' THEN
    stds := 'GB/T 45001-2020';
  ELSIF base ~ 'FS' OR base ~ '食品' OR base ~ 'FSHA' THEN
    stds := 'GB/T 22000-2006 + ISO 22000:2018';
  ELSIF base ~ 'CCRC' THEN
    stds := 'CCRC-ISV-C01:2018';
  ELSIF base ~ 'SC' OR base ~ '供应链' THEN
    stds := 'GB/T 38760-2020';
  ELSIF base ~ '绿色' THEN
    stds := 'GB/T 36101-2018';
  ELSIF base ~ 'ITSS' THEN
    stds := 'ITSS.1-2015';
  ELSIF base ~ 'CMMI' THEN
    stds := 'CMMI v2.0';
  ELSIF base ~ 'S' AND base !~ 'SC' THEN
    stds := 'GB/T 45001-2020';
  ELSIF base ~ 'ES' THEN
    stds := 'GB/T 24001-2016 + GB/T 45001-2020';
  ELSIF base ~ 'QS' THEN
    stds := 'GB/T 19001-2016 + GB/T 24001-2016';
  ELSIF base ~ 'E' THEN
    stds := 'GB/T 24001-2016';
  ELSIF base ~ 'Q' THEN
    stds := 'GB/T 19001-2016';
  ELSE
    stds := '通用';
  END IF;
  RETURN stds;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 步骤 3a：为缺失 certification_project 的客户自动建立空记录
-- ============================================================

-- 用 COPY 模式：拷贝第一行 + 替换关键字段
INSERT INTO certification_project (
  company_id, project_code, customer_id, customer_name,
  service_type_id, service_type_code, service_type_name,
  signing_entity_id, signing_entity_name,
  status, created_by, created_at, updated_at, project_owner_id, project_owner_name
)
SELECT DISTINCT
  fp.company_id,
  'AUTO-' || c.customer_code || '-' || to_char(fp.started_at, 'YYYYMM'),
  c.id,
  c.name,
  (SELECT id FROM service_type LIMIT 1),
  'certification',
  '认证服务（自动建）',
  (SELECT id FROM signing_entity LIMIT 1),
  '华中国际认证检验集团有限公司',
  'project_archived',
  '00000000-0000-0000-0000-000000000099'::uuid,  -- 系统用户
  NOW(), NOW(),
  NULL::uuid,
  '系统'
FROM finance_project fp
JOIN customer c ON c.id = fp.customer_id
WHERE fp.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND fp.customer_id NOT IN (SELECT customer_id FROM certification_project WHERE deleted_at IS NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 步骤 3b：批量 INSERT 证书（每个客户 + 类型 1 张）
-- 取最早"初次/再认证/初审"作为 issue_date，3 年有效期
-- ============================================================

INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at
)
SELECT DISTINCT ON (fp.customer_id, infer_cert_type_name(trim(split_part(fp.name, '|', 2))))
  fp.company_id,
  -- 关联 certification_project（按 customer_id 取最早）
  COALESCE(
    (SELECT id FROM certification_project 
     WHERE customer_id = fp.customer_id 
     ORDER BY created_at ASC LIMIT 1),
    (SELECT id FROM certification_project 
     WHERE customer_id = fp.customer_id 
     LIMIT 1)
  ),
  infer_cert_type_name(trim(split_part(fp.name, '|', 2))),
  infer_cert_standard(trim(split_part(fp.name, '|', 2))),
  fp.started_at::date,
  (fp.started_at + interval '3 years')::date,
  '华中国际认证检验集团有限公司',
  'active',
  -- 证书号：HN + 月份 + 类型首字母
  'HN-' || to_char(fp.started_at, 'YYYYMM') || '-' || upper(replace(replace(replace(trim(split_part(fp.name, '|', 2)), ' ', ''), '初审', 'I'), '再认证', 'R')) AS cert_no,
  -- 备注：包含原始名
  '从 finance_project 批量补建：' || fp.name,
  NOW()
FROM finance_project fp
WHERE fp.deleted_at IS NULL
  AND fp.customer_id IS NOT NULL
  AND fp.started_at IS NOT NULL
  AND split_part(fp.name, '|', 2) ~* '初审|再认证|初次'
ORDER BY fp.customer_id, infer_cert_type_name(trim(split_part(fp.name, '|', 2))), fp.started_at ASC
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 步骤 4：查看结果统计
-- =========================================================

SELECT COUNT(*) AS total_certificates FROM project_certificate WHERE deleted_at IS NULL;

COMMIT;

-- ============================================================
-- ROLLBACK（慎用）
-- ============================================================
-- DROP FUNCTION IF EXISTS infer_cert_standard(TEXT);
-- DROP FUNCTION IF EXISTS infer_cert_type_name(TEXT);
-- DELETE FROM project_certificate WHERE notes LIKE '从 finance_project 批量补建%';