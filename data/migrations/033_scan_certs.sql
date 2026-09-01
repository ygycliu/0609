-- ============================================
-- Migration 033: OCR 扫描件证书（17 PDF → 8 插入）
-- 来源：/mnt/renz/06、客户证书/ 扫描件 PDF
-- 工具：pdftoppm + tesseract（chi_sim+eng）
-- ============================================

BEGIN;

INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at, updated_at
)
  SELECT '278d1c61-6afe-4bd8-a78e-0ff2561c979d'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '278d1c61-6afe-4bd8-a78e-0ff2561c979d' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'FSMS / AAA / ISMS' AS cert_type,
  'ISO 22000:2018' AS standard,
  NULL::date AS issue_date,
  '2026-04-25'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'SCAN-宁夏供销集团有限公司宁夏供销电子商务产业发展有限公司 F 监' AS certificate_no,
  'OCR 扫描件导入：宁夏供销集团有限公司宁夏供销电子商务产业发展有限公司 F 监二 扫描件.pdf\n文件路径：宁夏供销集团有限公司宁夏供销电子商务产业发展有限公司 F 监二 扫描件.pdf\n体系：FSMS / AAA / ISMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'f5334437-ca95-4a2f-977a-e56008a60f28'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'f5334437-ca95-4a2f-977a-e56008a60f28' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'FSMS / AAA / ISMS' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2028-10-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'SCAN-春香优选（宁夏）科技有限公司，F+H，扫描件001.pdf' AS certificate_no,
  'OCR 扫描件导入：春香优选（宁夏）科技有限公司，F+H，扫描件001.pdf\n文件路径：春香优选（宁夏）科技有限公司，F+H，扫描件001.pdf\n体系：FSMS / AAA / ISMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '9c85f3f8-6af9-476a-8325-133604a864d8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '9c85f3f8-6af9-476a-8325-133604a864d8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  '温室气体 / AAA / ISMS / 能源' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2028-08-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '44325GHG0942ROM' AS certificate_no,
  'OCR 扫描件导入：温室气体-宁夏胜宝能源有限公司.pdf\n文件路径：温室气体-宁夏胜宝能源有限公司.pdf\n体系：温室气体 / AAA / ISMS / 能源\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'bc13bcad-25e9-4cdc-a683-9a6850a60de7'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'bc13bcad-25e9-4cdc-a683-9a6850a60de7' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS / ISMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2027-12-31'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '8512024Q0052ROM' AS certificate_no,
  'OCR 扫描件导入：天源石化(1).pdf\n文件路径：天源石化(1).pdf\n体系：AAA / QMS / ISMS\n备注：OCR 失败 - 证书编号含 2024，估算 3 年期' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'bc13bcad-25e9-4cdc-a683-9a6850a60de7'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'bc13bcad-25e9-4cdc-a683-9a6850a60de7' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'ISMS / AAA / EMS' AS cert_type,
  'GB/T 24001-2016' AS standard,
  NULL::date AS issue_date,
  '2027-07-01'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'SCAN-天源石化2(1).pdf' AS certificate_no,
  'OCR 扫描件导入：天源石化2(1).pdf\n文件路径：天源石化2(1).pdf\n体系：ISMS / AAA / EMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '2282c43d-521c-4a37-8484-8c8889ae1c5e'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '2282c43d-521c-4a37-8484-8c8889ae1c5e' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS / ISMS' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2029-04-09'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'SCAN-定边县恒均木业QES证书.pdf' AS certificate_no,
  'OCR 扫描件导入：定边县恒均木业QES证书.pdf\n文件路径：定边县恒均木业QES证书.pdf\n体系：AAA / QMS / ISMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '473a800e-80cf-4d55-aae2-101b0bd41838'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '473a800e-80cf-4d55-aae2-101b0bd41838' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'ISMS / AAA / EMS' AS cert_type,
  'GB/T 24001-2016' AS standard,
  NULL::date AS issue_date,
  '2029-06-17'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '02126E00492R001' AS certificate_no,
  'OCR 扫描件导入：宁夏新元丰油气技术服务有限公司20260618115241252.pdf\n文件路径：宁夏新元丰油气技术服务有限公司20260618115241252.pdf\n体系：ISMS / AAA / EMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'ba5ba536-c501-4b8b-944c-bff5ead3278a'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'ba5ba536-c501-4b8b-944c-bff5ead3278a' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / FSMS' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2029-02-10'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'SCAN-宁夏吴忠市红长青农副产品有限公司~食品安全认证证书.pdf' AS certificate_no,
  'OCR 扫描件导入：宁夏吴忠市红长青农副产品有限公司~食品安全认证证书.pdf\n文件路径：宁夏吴忠市红长青农副产品有限公司~食品安全认证证书.pdf\n体系：AAA / FSMS\n备注：' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at

ON CONFLICT (id) DO NOTHING;

COMMIT;
