-- ============================================================
-- Migration 031: 修正 check_certificate_expiry 函数类型
-- 修复 text vs character varying 类型不匹配
-- ============================================================

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
      (CASE
        WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN 'EXPIRED'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_critical_days THEN 'CRITICAL'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_warning_days THEN 'WARNING'
        ELSE 'NORMAL'
      END)::VARCHAR AS urgency_level,
      (CASE
        WHEN (pc.valid_until - CURRENT_DATE) <= 0 THEN '⚠️ 已过期，需要立即重新认证！'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_critical_days THEN 
          '🔴 紧急：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，需立即安排监督/复评'
        WHEN (pc.valid_until - CURRENT_DATE) <= p_warning_days THEN 
          '🟠 警告：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天，建议提前联系客户安排复评'
        ELSE '🟢 正常：剩余 ' || (pc.valid_until - CURRENT_DATE) || ' 天'
      END)::TEXT AS alert_message
  FROM project_certificate pc
  JOIN certification_project cp ON cp.id = pc.project_id
  WHERE pc.deleted_at IS NULL
    AND pc.status = 'active'
  ORDER BY pc.valid_until ASC;
END;
$$ LANGUAGE plpgsql;