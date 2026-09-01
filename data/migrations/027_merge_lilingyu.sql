-- ============================================================
-- Migration 027: 李玲玉档案合并
-- 用途：3 条重复记录合并为 1 条
-- 案例：李玲玉 + 李玲玉签字文件 + 李玲玉资格 → 1 条
-- ============================================================

BEGIN;

-- 1. 合并 3 条记录到主档案 (fab50f28)
UPDATE auditor_profile
SET 
  organization = '华中认证',
  specialties = ARRAY['BCMS', 'EMS', 'ISMS', 'ITSMS', 'OHSMS', 'QMS']::text[],
  certificates = '[
    {"code": "BCMS", "name": "业务连续性管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/BCMS.pdf", "source_name": "BCMS.pdf", "status": "active", "note": "由文件名 BCMS 推断"},
    {"code": "EMS", "name": "环境管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/EMS.pdf", "source_name": "EMS.pdf", "status": "active", "note": "由文件名 EMS 推断"},
    {"code": "ISMS", "name": "信息安全管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/ISMS-李玲玉.pdf", "source_name": "ISMS-李玲玉.pdf", "status": "active", "note": "由文件名 ISMS 推断"},
    {"code": "ITSMS", "name": "IT服务管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/ITSMS-李玲玉.pdf", "source_name": "ITSMS-李玲玉.pdf", "status": "active", "note": "由文件名 ITSMS 推断"},
    {"code": "OHSMS", "name": "职业健康安全管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/OHSMS.pdf", "source_name": "OHSMS.pdf", "status": "active", "note": "由文件名 OHSMS 推断"},
    {"code": "QMS", "name": "质量管理体系认证审核员", "type": "auditor_cert", "file": "/mnt/renz/09、审核员档案/所有审核老师资料/李玲玉资格证书/QMS.pdf", "source_name": "QMS.pdf", "status": "active", "note": "由文件名 QMS 推断"}
  ]'::jsonb,
  attachments = '[
    {"name": "保密及竞业禁止协议(3).pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/保密及竞业禁止协议(3).pdf", "type": "signing_doc"},
    {"name": "劳动合同(6).pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/劳动合同(6).pdf", "type": "signing_doc"},
    {"name": "培养协议.pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/培养协议.pdf", "type": "signing_doc"},
    {"name": "承诺书(1)(1).pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/承诺书(1)(1).pdf", "type": "signing_doc"},
    {"name": "申报表.pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/申报表.pdf", "type": "signing_doc"},
    {"name": "认证人员公正性及保密声明(1)(1).pdf", "path": "/mnt/renz/09、审核员档案/华中审核员/李玲玉签字文件/李玲玉签字文件/认证人员公正性及保密声明(1)(1).pdf", "type": "signing_doc"}
  ]'::jsonb,
  tags = ARRAY['档案导入', '宁夏分公司', '多体系审核员'],
  notes = '合并 3 条记录：主档案 + 签字文件 + 资格证书（含6张证书+6个签字文件）'
WHERE id = 'fab50f28-70a3-4afa-b7f1-04b9b297bacd';

-- 2. 软删除 2 条冗余
UPDATE auditor_profile SET deleted_at = NOW()
WHERE id IN (
  'cc1fddd9-1070-4208-adcd-d93239dc2943',  -- 李玲玉签字文件
  '11a2dc0a-a467-487b-beef-1de039fd2ad6'   -- 李玲玉资格
) AND deleted_at IS NULL;

COMMIT;

-- ============================================================
-- ROLLBACK（慎用）
-- ============================================================
-- DELETE FROM auditor_profile WHERE id = 'fab50f28-70a3-4afa-b7f1-04b9b297bacd' AND source = 'import' AND tags @> ARRAY['多体系审核员'];
-- UPDATE auditor_profile SET deleted_at = NULL, organization = '其他', specialties = '{}', certificates = '[]'::jsonb, attachments = '[]'::jsonb, tags = ARRAY['档案导入', '宁夏分公司'] WHERE id IN ('fab50f28-70a3-4afa-b7f1-04b9b297bacd');