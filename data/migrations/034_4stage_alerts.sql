-- ============================================================
-- Migration 034: 重新设计证书预警 - 4 阶段分类
--
-- 阶段（按 QES / QMS / EMS / 能源 等管理体系，3年周期）：
--   1. 初次认证（发证）: issue_date 当天
--   2. 监督一审核（1年后）: issue_date + 1年
--   3. 监督二审核（2年后）: issue_date + 2年
--   4. 再认证（到期）: valid_until
--
-- 预警逻辑（按"距下一阶段天数"分 4 级）：
--   - RENEW (已过期): 距到期 < 0
--   - CRITICAL (≤90天): 距到期 0-90 天 / 距监督二 ≤30天
--   - WARNING (≤180天): 距监督一/二 30-90 天
--   - NORMAL (>180天): 正常
-- ============================================================

-- ============================================================
-- 函数：计算单张证书的下一阶段
-- ============================================================
CREATE OR REPLACE FUNCTION certificate_next_stage(
  p_issue_date DATE,
  p_valid_until DATE,
  p_cert_type VARCHAR
) RETURNS TABLE (
  current_stage VARCHAR,    -- '初次认证' | '监督一' | '监督二' | '再认证'
  next_stage VARCHAR,        -- 下一阶段名称
  next_stage_date DATE,      -- 下一阶段日期
  days_until_next INTEGER,   -- 距下一阶段天数（负数=已过）
  urgency_level VARCHAR      -- 'RENEW' | 'CRITICAL' | 'WARNING' | 'NORMAL'
) AS $$
DECLARE
  v_sup1_date DATE;
  v_sup2_date DATE;
  v_now DATE := CURRENT_DATE;
  v_days INTEGER;
  v_stage VARCHAR;
  v_next VARCHAR;
  v_next_date DATE;
  v_level VARCHAR;
BEGIN
  -- 如果没有 issue_date（70张），默认 valid_until 为下一阶段
  IF p_issue_date IS NULL THEN
    v_next := '再认证';
    v_next_date := p_valid_until;
    v_days := p_valid_until - v_now;
  ELSE
    -- 计算监督一/二日期（按 3 年周期）
    v_sup1_date := p_issue_date + INTERVAL '1 year';
    v_sup2_date := p_issue_date + INTERVAL '2 year';

    -- 当前阶段判断（按时间）
    IF v_now < p_issue_date THEN
      v_stage := '待发证';
      v_next := '初次认证';
      v_next_date := p_issue_date;
    ELSIF v_now < v_sup1_date THEN
      v_stage := '初次认证';
      v_next := '监督一';
      v_next_date := v_sup1_date;
    ELSIF v_now < v_sup2_date THEN
      v_stage := '监督一';
      v_next := '监督二';
      v_next_date := v_sup2_date;
    ELSIF v_now < p_valid_until THEN
      v_stage := '监督二';
      v_next := '再认证';
      v_next_date := p_valid_until;
    ELSE
      v_stage := '已过期';
      v_next := '重新认证';
      v_next_date := p_valid_until;  -- 已过
    END IF;

    v_days := v_next_date - v_now;
  END IF;

  -- 预警级别
  IF v_days < 0 THEN
    v_level := 'RENEW';
  ELSIF v_next = '再认证' AND v_days <= 90 THEN
    v_level := 'CRITICAL';
  ELSIF v_days <= 30 THEN
    v_level := 'CRITICAL';
  ELSIF v_next = '再认证' AND v_days <= 180 THEN
    v_level := 'WARNING';
  ELSIF v_days <= 90 THEN
    v_level := 'WARNING';
  ELSE
    v_level := 'NORMAL';
  END IF;

  RETURN QUERY SELECT v_stage, v_next, v_next_date, v_days, v_level;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 函数：检查所有证书（带阶段信息）
-- ============================================================
CREATE OR REPLACE FUNCTION check_certificate_expiry(
  p_warning_days INTEGER DEFAULT 90,
  p_critical_days INTEGER DEFAULT 30
) RETURNS TABLE (
  certificate_id UUID,
  customer_id UUID,
  customer_name VARCHAR,
  project_code VARCHAR,
  cert_type VARCHAR,
  certificate_no VARCHAR,
  issue_date DATE,
  valid_until DATE,
  current_stage VARCHAR,
  next_stage VARCHAR,
  next_stage_date DATE,
  days_until_next INTEGER,
  urgency_level VARCHAR,
  alert_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH stages AS (
    SELECT 
      pc.id, cp.customer_id, cp.customer_name, cp.project_code,
      pc.cert_type, pc.certificate_no, pc.issue_date, pc.valid_until,
      ns.current_stage, ns.next_stage, ns.next_stage_date,
      ns.days_until_next, ns.urgency_level,
      -- 预警消息
      CASE
        WHEN ns.urgency_level = 'RENEW' THEN
          '⚫ 已过期：' || -ns.days_until_next || ' 天，需立即重新认证'
        WHEN ns.urgency_level = 'CRITICAL' AND ns.next_stage = '再认证' THEN
          '🚨 再认证：' || ns.days_until_next || ' 天，需立即准备复评材料'
        WHEN ns.urgency_level = 'CRITICAL' THEN
          '🔴 紧急：' || ns.next_stage || '（' || ns.days_until_next || ' 天后），立即安排'
        WHEN ns.urgency_level = 'WARNING' AND ns.next_stage = '再认证' THEN
          '🟠 警告：再认证剩 ' || ns.days_until_next || ' 天，3 个月内完成'
        WHEN ns.urgency_level = 'WARNING' THEN
          '🟡 提示：' || ns.next_stage || ' 剩 ' || ns.days_until_next || ' 天，提前准备'
        ELSE
          '🟢 正常：' || ns.next_stage || ' 剩 ' || ns.days_until_next || ' 天'
      END AS alert_msg
    FROM project_certificate pc
    JOIN certification_project cp ON cp.id = pc.project_id
    CROSS JOIN LATERAL certificate_next_stage(pc.issue_date, pc.valid_until, pc.cert_type) ns
    WHERE pc.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND pc.status = 'active'
  )
  SELECT * FROM stages
  ORDER BY 
    CASE urgency_level
      WHEN 'RENEW' THEN 1
      WHEN 'CRITICAL' THEN 2
      WHEN 'WARNING' THEN 3
      ELSE 4
    END,
    next_stage_date ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 视图：证书预警（含阶段信息）
-- ============================================================
DROP VIEW IF EXISTS vw_certificate_expiry_alerts;
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
) base
ORDER BY 
  CASE urgency_level
    WHEN 'RENEW' THEN 1
    WHEN 'CRITICAL' THEN 2
    WHEN 'WARNING' THEN 3
    ELSE 4
  END,
  next_stage_date ASC;

-- ============================================================
-- 视图：按阶段统计
-- ============================================================
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

-- ============================================================
-- 统计自动提醒 todo 函数（按阶段）
-- ============================================================
CREATE OR REPLACE FUNCTION auto_create_cert_stage_todos(
  p_critical_days INTEGER DEFAULT 30,
  p_company_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
) RETURNS INTEGER AS $$
DECLARE
  cert_record RECORD;
  todo_title TEXT;
  due_date TIMESTAMP;
  todo_count INTEGER := 0;
  v_priority VARCHAR;
BEGIN
  FOR cert_record IN
    SELECT 
      pc.id AS cert_id,
      pc.cert_type,
      pc.certificate_no,
      pc.issue_date,
      pc.valid_until,
      cp.customer_id,
      cp.customer_name,
      v.current_stage,
      v.next_stage,
      v.next_stage_date,
      v.days_until_next,
      v.urgency_level
    FROM project_certificate pc
    JOIN certification_project cp ON cp.id = pc.project_id
    CROSS JOIN LATERAL certificate_next_stage(pc.issue_date, pc.valid_until, pc.cert_type) v
    WHERE pc.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND pc.status = 'active'
      AND cp.company_id = p_company_id
      AND v.urgency_level IN ('RENEW', 'CRITICAL')
      AND NOT EXISTS (
        SELECT 1 FROM todo t
        WHERE t.source = 'cert_stage'
          AND t.source_ref = pc.id::text
          AND t.deleted_at IS NULL
          AND t.created_at > NOW() - INTERVAL '24 hours'
      )
  LOOP
    todo_title := '🔔 证书' || cert_record.next_stage || '：' || 
                  cert_record.customer_name || ' - ' || cert_record.cert_type;
    
    IF cert_record.days_until_next < 0 THEN
      due_date := NOW();
    ELSE
      due_date := cert_record.next_stage_date::timestamp;
    END IF;
    
    IF cert_record.urgency_level = 'RENEW' THEN
      v_priority := 'urgent';
    ELSIF cert_record.urgency_level = 'CRITICAL' THEN
      v_priority := 'high';
    ELSE
      v_priority := 'normal';
    END IF;
    
    INSERT INTO todo (
      company_id, owner_user_id, assigned_to, title, description,
      category, source, source_ref, due_at, remind_at,
      status, priority, customer_id, metadata, created_at, updated_at
    ) VALUES (
      p_company_id,
      NULL::uuid,
      NULL::uuid,
      todo_title,
      '客户【' || cert_record.customer_name || '】\n' ||
      '当前阶段：' || cert_record.current_stage || '\n' ||
      '下一阶段：' || cert_record.next_stage || '\n' ||
      '预计日期：' || cert_record.next_stage_date || '\n' ||
      '剩余天数：' || cert_record.days_until_next || '\n' ||
      '证书号：' || cert_record.certificate_no || '\n' ||
      '证书类型：' || cert_record.cert_type || '\n\n' ||
      '请及时安排 ' || cert_record.next_stage || ' 工作。\n' ||
      '颁发机构：' || '华中国际认证检验集团有限公司',
      'general',
      'cert_stage',
      cert_record.cert_id::text,
      due_date,
      due_date - INTERVAL '7 days',
      'pending',
      v_priority,
      cert_record.customer_id,
      jsonb_build_object(
        'cert_id', cert_record.cert_id,
        'current_stage', cert_record.current_stage,
        'next_stage', cert_record.next_stage,
        'next_stage_date', cert_record.next_stage_date,
        'days_until_next', cert_record.days_until_next,
        'urgency_level', cert_record.urgency_level,
        'certificate_no', cert_record.certificate_no,
        'cert_type', cert_record.cert_type
      ),
      NOW(), NOW()
    );
    
    todo_count := todo_count + 1;
  END LOOP;
  
  RETURN todo_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 注释：自动 cron
-- ============================================================

-- 手动调用：
-- SELECT auto_create_cert_stage_todos(30, '00000000-0000-0000-0000-000000000001'::uuid);

-- ============================================================
-- ROLLBACK（慎用）
-- ============================================================
-- DROP VIEW IF EXISTS vw_certificate_expiry_alerts;
-- DROP VIEW IF EXISTS vw_certificate_stage_stats;
-- DROP FUNCTION IF EXISTS auto_create_cert_stage_todos(INTEGER, UUID);
-- DROP FUNCTION IF EXISTS check_certificate_expiry(INTEGER, INTEGER);
-- DROP FUNCTION IF EXISTS certificate_next_stage(DATE, DATE, VARCHAR);