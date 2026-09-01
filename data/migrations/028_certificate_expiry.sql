-- ============================================================
-- Migration 028: 客户去重 + 证书补建 + 到期预警
-- 案例：中能新材料（C00012 + C00018）+ 亿丰砼业
-- ============================================================

BEGIN;

-- ============================================================
-- Step 1: 合并重复客户 C00012 + C00018
-- ============================================================

-- 1.1 把 C00012 的 finance_project 关联到 C00018
UPDATE finance_project SET customer_id = '3501c40e-c5c3-4727-acf5-845697558d3a'
WHERE customer_id = '1eabc99f-4df8-45ab-b431-e490b4e874ba';

-- 1.2 把 C00012 的 certification_project 关联到 C00018
UPDATE certification_project SET customer_id = '3501c40e-c5c3-4727-acf5-845697558d3a'
WHERE customer_id = '1eabc99f-4df8-45ab-b431-e490b4e874ba';

-- 1.3 软删除 C00012（保留 C00018 完整名称）
UPDATE customer SET 
  deleted_at = NOW(),
  notes = COALESCE(notes, '') || ' [已合并到 C00018]'
WHERE id = '1eabc99f-4df8-45ab-b431-e490b4e874ba' AND deleted_at IS NULL;

-- 1.4 更新 C00018 的 notes
UPDATE customer SET 
  notes = '合并自 宁夏中能新材料科技 (C00012) | 自动从2024-2025财务流水导入（多笔 ¥66000+）'
WHERE id = '3501c40e-c5c3-4727-acf5-845697558d3a';

-- ============================================================
-- Step 2: 补建 project_certificate
-- 逻辑：按 QES 三体系 3 年期 + 监督1/2 推算
-- ============================================================

-- 2.1 中能新材料 QES 三体系（初审 2024-03-14 + 监督一 2024-12-03 + 监督二 2025-11-14）
INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '17d3b8f1-2562-4bc3-95d8-48a92a6aa7d9',
  'QES三体系',
  'GB/T 19001-2016 / GB/T 24001-2016 / GB/T 45001-2020',
  '2024-03-14',
  '2027-03-13',
  '华中国际认证检验集团有限公司',
  'active',
  'HNQES-2024-0328',
  '由 QES初审(2024-03-14) + QES监督一(2024-12-03) + QES监督二(2025-11-14) 自动推算',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2.2 中能新材料 能源管理体系（2025-06-06）
INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '17d3b8f1-2562-4bc3-95d8-48a92a6aa7d9',
  '能源管理体系',
  'GB/T 23331-2020 / ISO 50001:2018',
  '2025-06-06',
  '2028-06-05',
  '华中国际认证检验集团有限公司',
  'active',
  'HNNY-2025-0606',
  '由 能源认证(2025-06-06) 自动推算',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 2.3 亿丰砼业 QES 三体系（年审 2024-11-13 + 监督二 2025-12-16）
INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '57607a3d-0436-4aa7-a84e-21ba1f2cb78f',
  'QES三体系',
  'GB/T 19001-2016 / GB/T 24001-2016 / GB/T 45001-2020',
  '2024-11-13',
  '2027-11-12',
  '华中国际认证检验集团有限公司',
  'active',
  'HNQES-2024-1113',
  '由 QES年审(2024-11-13) + QES监督二(2025-12-16) 自动推算',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Step 3: 证书到期预警函数 + 视图
-- ============================================================

-- 3.1 函数：检查证书到期（参数化阈值）
CREATE OR REPLACE FUNCTION check_certificate_expiry(
  p_warning_days INTEGER DEFAULT 180,
  p_critical_days INTEGER DEFAULT 60
) RETURNS TABLE (
  certificate_id UUID,
  customer_id UUID,
  customer_name VARCHAR,
  project_code VARCHAR,
  cert_type VARCHAR,
  certificate_no VARCHAR,
  issue_date DATE,
  valid_until DATE,
  days_until_expiry INTEGER,
  urgency_level VARCHAR,
  alert_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
      pc.id,
      cp.customer_id,
      cp.customer_name,
      cp.project_code,
      pc.cert_type,
      pc.certificate_no,
      pc.issue_date,
      pc.valid_until,
      (pc.valid_until - CURRENT_DATE)::INTEGER AS days_until_expiry,
      CASE
        WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN 'EXPIRED'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_critical_days THEN 'CRITICAL'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_warning_days THEN 'WARNING'
        ELSE 'NORMAL'
      END AS urgency_level,
      CASE
        WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN '⚠️ 已过期，需要立即重新认证！'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_critical_days THEN 
          '🔴 紧急：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，需立即安排监督/复评'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_warning_days THEN 
          '🟠 警告：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，建议提前联系客户安排复评'
        ELSE '🟢 正常：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天'
      END AS alert_message
  FROM project_certificate pc
  JOIN certification_project cp ON cp.id = pc.project_id
  WHERE pc.deleted_at IS NULL
    AND pc.status = 'active'
  ORDER BY pc.valid_until ASC;
END;
$$ LANGUAGE plpgsql;

-- 3.2 视图：证书预警（默认阈值：critical=60, warning=180）
CREATE OR REPLACE VIEW vw_certificate_expiry_alerts AS
SELECT 
    pc.id AS certificate_id,
    cp.customer_id,
    cp.customer_name,
    cp.project_code,
    cp.project_no,
    pc.cert_type,
    pc.certificate_no,
    pc.issue_date,
    pc.valid_until,
    (pc.valid_until - CURRENT_DATE)::INTEGER AS days_until_expiry,
    CASE
      WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN 'EXPIRED'
      WHEN (pc.valid_until - CURRENT_DATE) <= 60 THEN 'CRITICAL'
      WHEN (pc.valid_until - CURRENT_DATE) <= 180 THEN 'WARNING'
      ELSE 'NORMAL'
    END AS urgency_level,
    CASE
      WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN '⚠️ 已过期，需要立即重新认证！'
      WHEN (pc.valid_until - CURRENT_DATE) <= 60 THEN 
        '🔴 紧急：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，需立即安排监督/复评'
      WHEN (pc.valid_until - CURRENT_DATE) <= 180 THEN 
        '🟠 警告：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，建议提前联系客户安排复评'
      ELSE '🟢 正常：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天'
    END AS alert_message,
    cp.project_owner_id AS owner_user_id,
    pc.issuing_body
FROM project_certificate pc
JOIN certification_project cp ON cp.id = pc.project_id
WHERE pc.deleted_at IS NULL
  AND pc.status = 'active'
ORDER BY pc.valid_until ASC;

COMMIT;

-- ============================================================
-- ROLLBACK（慎用）
-- ============================================================
-- DROP VIEW IF EXISTS vw_certificate_expiry_alerts;
-- DROP FUNCTION IF EXISTS check_certificate_expiry(INTEGER, INTEGER);
-- DELETE FROM project_certificate WHERE certificate_no IN ('HNQES-2024-0328', 'HNNY-2025-0606', 'HNQES-2024-1113');
-- UPDATE customer SET deleted_at = NULL WHERE id = '1eabc99f-4df8-45ab-b431-e490b4e874ba';