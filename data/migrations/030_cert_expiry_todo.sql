-- ============================================================
-- Migration 030: 证书到期自动提醒（90 天前创建 todo）
-- 规则：
-- - 到期 ≤ 90 天
-- - 同一证书 24 小时内不重复创建
-- ============================================================

-- ============================================================
-- 函数：自动为即将到期证书创建 todo
-- ============================================================

CREATE OR REPLACE FUNCTION auto_create_cert_expiry_todos(
  p_warning_days INTEGER DEFAULT 90,
  p_company_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
) RETURNS INTEGER AS $$
DECLARE
  cert_record RECORD;
  todo_title TEXT;
  due_date TIMESTAMP;
  todo_count INTEGER := 0;
BEGIN
  -- 遍历即将到期证书（≤90 天）
  FOR cert_record IN
    SELECT 
      pc.id AS cert_id,
      pc.cert_type,
      pc.certificate_no,
      pc.valid_until,
      cp.customer_id,
      cp.customer_name,
      cp.project_owner_id,
      (pc.valid_until - CURRENT_DATE)::INTEGER AS days_until_expiry
    FROM project_certificate pc
    JOIN certification_project cp ON cp.id = pc.project_id
    WHERE pc.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND pc.status = 'active'
      AND cp.company_id = p_company_id
      AND (pc.valid_until - CURRENT_DATE) BETWEEN 0 AND p_warning_days
      -- 24 小时内未创建过同类提醒
      AND NOT EXISTS (
        SELECT 1 FROM todo t
        WHERE t.source_ref = pc.id::text
          AND t.source = 'cert_expiry'
          AND t.deleted_at IS NULL
          AND t.created_at > NOW() - INTERVAL '24 hours'
      )
  LOOP
    todo_title := '🔔 证书即将到期：' || cert_record.customer_name || ' - ' || cert_record.cert_type;
    
    IF cert_record.days_until_expiry <= 0 THEN
      due_date := NOW();
    ELSE
      due_date := cert_record.valid_until::timestamp;
    END IF;
    
    INSERT INTO todo (
      company_id, owner_user_id, assigned_to, title, description,
      category, source, source_ref, due_at, remind_at,
      status, priority, customer_id, metadata, created_at, updated_at
    ) VALUES (
      p_company_id,
      cert_record.project_owner_id,
      cert_record.project_owner_id,
      todo_title,
      '客户【' || cert_record.customer_name || '】的【' || cert_record.cert_type || 
      '】证书（编号：' || cert_record.certificate_no || 
      '）将于 ' || cert_record.valid_until || ' 到期，剩余 ' || cert_record.days_until_expiry || ' 天。' ||
      E'\n\n请尽快安排监督审核或再认证。\n颁发机构：华中国际认证检验集团有限公司',
      'general',
      'cert_expiry',
      cert_record.cert_id::text,
      due_date,
      due_date - INTERVAL '7 days',  -- 到期前 7 天再提醒一次
      'pending',
      CASE 
        WHEN cert_record.days_until_expiry <= 30 THEN 'urgent'
        WHEN cert_record.days_until_expiry <= 60 THEN 'high'
        ELSE 'normal'
      END,
      cert_record.customer_id,
      jsonb_build_object(
        'cert_id', cert_record.cert_id,
        'cert_type', cert_record.cert_type,
        'certificate_no', cert_record.certificate_no,
        'valid_until', cert_record.valid_until,
        'days_until_expiry', cert_record.days_until_expiry,
        'issuing_body', '华中国际认证检验集团有限公司'
      ),
      NOW(), NOW()
    );
    
    todo_count := todo_count + 1;
  END LOOP;
  
  RETURN todo_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 注释：调用方式
-- ============================================================

-- 手动触发：
-- SELECT auto_create_cert_expiry_todos(90, '00000000-0000-0000-0000-000000000001'::uuid);

-- ============================================================
-- ROLLBACK（慎用）
-- ============================================================
-- DROP FUNCTION IF EXISTS auto_create_cert_expiry_todos(INTEGER, UUID);