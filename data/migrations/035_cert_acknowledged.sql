-- ============================================
-- Migration 035: 证书"已确认"功能（不再显示 + 推送代办）
-- ============================================

ALTER TABLE project_certificate
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID,
  ADD COLUMN IF NOT EXISTS acknowledged_note TEXT;

-- 索引：过滤未确认的证书
CREATE INDEX IF NOT EXISTS idx_pc_acknowledged
  ON project_certificate(acknowledged_at)
  WHERE deleted_at IS NULL AND acknowledged_at IS NULL;

-- 注释
COMMENT ON COLUMN project_certificate.acknowledged_at IS '已确认时间（NULL=未确认）';
COMMENT ON COLUMN project_certificate.acknowledged_by IS '确认人 user_id';
COMMENT ON COLUMN project_certificate.acknowledged_note IS '确认备注';

-- ============================================
-- 视图更新：过滤已确认（默认隐藏）
-- ============================================
DROP VIEW IF EXISTS vw_certificate_expiry_alerts CASCADE;
CREATE VIEW vw_certificate_expiry_alerts AS
SELECT 
    certificate_id,
    customer_id,
    customer_name,
    project_code,
    project_no,
    cert_type,
    certificate_no,
    issue_date,
    valid_until,
    current_stage,
    next_stage,
    next_stage_date,
    days_until_next,
    (CASE
      WHEN urgency_level = 'RENEW' THEN '已过期'
      WHEN urgency_level = 'CRITICAL' AND next_stage = '再认证' THEN '再认证紧急'
      WHEN urgency_level = 'CRITICAL' THEN '即将到期'
      WHEN urgency_level = 'WARNING' AND next_stage = '再认证' THEN '再认证预警'
      WHEN urgency_level = 'WARNING' THEN '即将到期'
      ELSE '正常'
    END)::VARCHAR AS urgency_level,
    (CASE
      WHEN urgency_level = 'RENEW' THEN '⚫ 已过期 ' || -days_until_next || ' 天，需立即重新认证'
      WHEN urgency_level = 'CRITICAL' AND next_stage = '再认证' THEN '🚨 再认证剩 ' || days_until_next || ' 天，3 个月内完成'
      WHEN urgency_level = 'CRITICAL' THEN '🔴 紧急：' || next_stage || ' 剩 ' || days_until_next || ' 天'
      WHEN urgency_level = 'WARNING' AND next_stage = '再认证' THEN '🟠 再认证剩 ' || days_until_next || ' 天'
      WHEN urgency_level = 'WARNING' THEN '🟡 ' || next_stage || ' 剩 ' || days_until_next || ' 天'
      ELSE '🟢 正常：' || next_stage || ' 剩 ' || days_until_next || ' 天'
    END)::TEXT AS alert_message,
    owner_user_id,
    issuing_body
FROM (
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
      ns.current_stage,
      ns.next_stage,
      ns.next_stage_date,
      ns.days_until_next,
      ns.urgency_level,
      cp.project_owner_id AS owner_user_id,
      pc.issuing_body
  FROM project_certificate pc
  JOIN certification_project cp ON cp.id = pc.project_id
  CROSS JOIN LATERAL certificate_next_stage(pc.issue_date, pc.valid_until, pc.cert_type) ns
  WHERE pc.deleted_at IS NULL
    AND cp.deleted_at IS NULL
    AND pc.status = 'active'
    AND pc.acknowledged_at IS NULL  -- ★ 关键：过滤已确认
) base
ORDER BY 
  CASE urgency_level
    WHEN 'RENEW' THEN 1
    WHEN 'CRITICAL' THEN 2
    WHEN 'WARNING' THEN 3
    ELSE 4
  END,
  next_stage_date ASC;

-- 重建阶段统计视图
DROP VIEW IF EXISTS vw_certificate_stage_stats;
CREATE VIEW vw_certificate_stage_stats AS
SELECT 
    urgency_level,
    next_stage,
    COUNT(*) AS cert_count
FROM vw_certificate_expiry_alerts
GROUP BY urgency_level, next_stage
ORDER BY 
  CASE urgency_level
    WHEN '已过期' THEN 1
    WHEN '再认证紧急' THEN 2
    WHEN '即将到期' THEN 3
    WHEN '再认证预警' THEN 4
    ELSE 5
  END;
