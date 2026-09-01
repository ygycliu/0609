BEGIN;

-- ============================================
-- Migration 032: 批量插入客户证书（来自 /mnt/renz/06、客户证书/）
-- 来源：436 PDF 自动 OCR + 文件名推断
-- ============================================

-- 1. 自动建缺失 certification_project
INSERT INTO certification_project (
  company_id, project_code, customer_id, customer_name,
  service_type_id, service_type_code, service_type_name,
  signing_entity_id, signing_entity_name,
  status, created_by, created_at, updated_at, project_owner_id, project_owner_name
)
SELECT DISTINCT
  c.company_id,
  'AUTO-' || c.customer_code || '-' || to_char(NOW(), 'YYYYMMDD'),
  c.id,
  c.name,
  (SELECT id FROM service_type LIMIT 1),
  'certification',
  '认证服务（批量补建）',
  (SELECT id FROM signing_entity LIMIT 1),
  '华中国际认证检验集团有限公司',
  'project_archived',
  '00000000-0000-0000-0000-000000000099'::uuid,
  NOW(), NOW(),
  NULL::uuid, '系统'
FROM customer c
WHERE c.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM certification_project cp WHERE cp.customer_id = c.id AND cp.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

-- 2. 批量插入证书（68 张带有效期）
INSERT INTO project_certificate (
  company_id, project_id, cert_type, standard, issue_date, valid_until,
  issuing_body, status, certificate_no, notes, created_at, updated_at
)
  SELECT '7725b196-a73e-4677-bfe5-14003fb21efd'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '7725b196-a73e-4677-bfe5-14003fb21efd' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2029-03-10'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '84026Q10359R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏五丰农业科技有限公司-QMS证书中文.pdf.pdf
文件路径：/mnt/renz/06、客户证书/博创证书/3月份/宁夏五丰农业科技有限公司-QMS证书中文.pdf.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8b3a3236-5a1c-4cbb-a0d3-c29c50b7a22c'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8b3a3236-5a1c-4cbb-a0d3-c29c50b7a22c' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-07-02'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05325I10234R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：信德恒达27001.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/信德恒达27001.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'fc62bc97-24c1-4839-beb1-8ab1b986a343'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'fc62bc97-24c1-4839-beb1-8ab1b986a343' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-06-23'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05325I10209R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川商功人工智能科技有限公司27001.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/银川商功人工智能科技有限公司27001.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '87f2b44b-5c1c-4ed8-90e1-b9a649e612fa'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '87f2b44b-5c1c-4ed8-90e1-b9a649e612fa' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-07-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05325I10246R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：欣凯烨27001.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/欣凯烨27001.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '994849e2-a74d-4a74-9fbb-07861a4cf374'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '994849e2-a74d-4a74-9fbb-07861a4cf374' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2027-09-04'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05324I10378R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：光瑞27001.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/光瑞27001.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '87f2b44b-5c1c-4ed8-90e1-b9a649e612fa'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '87f2b44b-5c1c-4ed8-90e1-b9a649e612fa' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-07-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '0532025ITSM00147R0MN' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：欣凯烨20000.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/欣凯烨20000.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8b3a3236-5a1c-4cbb-a0d3-c29c50b7a22c'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8b3a3236-5a1c-4cbb-a0d3-c29c50b7a22c' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-07-02'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '0532025ITSM00140R0MN' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：信德恒达20000.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/信德恒达20000.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '994849e2-a74d-4a74-9fbb-07861a4cf374'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '994849e2-a74d-4a74-9fbb-07861a4cf374' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-07-09'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '0532025ITSM00145R0MN' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：光瑞20000.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/7月份/光瑞20000.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e3fa623c-9dbb-4ee1-8568-9b99080b4f4e'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e3fa623c-9dbb-4ee1-8568-9b99080b4f4e' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / FSMS' AS cert_type,
  'ISO 22000:2018' AS standard,
  NULL::date AS issue_date,
  '2028-03-12'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '015FSMS2500080' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏厚生记食品有限公司 25 FH.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/宁夏厚生记食品有限公司 25 FH.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'fc62bc97-24c1-4839-beb1-8ab1b986a343'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'fc62bc97-24c1-4839-beb1-8ab1b986a343' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / BCMS' AS cert_type,
  'GB/T30146-2023' AS standard,
  NULL::date AS issue_date,
  '2028-08-31'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '87625Y1207R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川商功人工智能科技有限公司-业务连续性管理体系认证证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/9月份/银川商功人工智能科技有限公司-业务连续性管理体系认证证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '949fb59d-8de8-4152-a374-a2e28afd3fa5'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '949fb59d-8de8-4152-a374-a2e28afd3fa5' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 27922-2011' AS standard,
  NULL::date AS issue_date,
  '2028-09-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '65625SC6105R0Z' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏大朴  售后服务证书.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/9月份/宁夏大朴  售后服务证书.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'a5651572-5e4c-4919-9568-4149efd43716'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'a5651572-5e4c-4919-9568-4149efd43716' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / FSMS' AS cert_type,
  'ISO 22000:2018' AS standard,
  NULL::date AS issue_date,
  '2028-03-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '015FSMS2500085' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏厚生记枸杞饮品股份有限公司 25 FH.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/宁夏厚生记枸杞饮品股份有限公司 25 FH.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '07fdca75-e685-473f-aa5e-582a5adad88b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '07fdca75-e685-473f-aa5e-582a5adad88b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 27922-2011' AS standard,
  NULL::date AS issue_date,
  '2028-09-17'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '65625SC6501R0Z' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏和鸣 售后服务证书(2).pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/9月份/宁夏和鸣 售后服务证书(2).pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 37029-2018' AS standard,
  NULL::date AS issue_date,
  '2028-03-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126225MS2067' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：2067银川新华百货连锁超市有限公司A99-SWKZSX-中英文版附件.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/2067银川新华百货连锁超市有限公司A99-SWKZSX-中英文版附件.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'ISO28000:2007' AS standard,
  NULL::date AS issue_date,
  '2028-03-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126225MS2068' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：2068银川新华百货连锁超市有限公司A99-GYL-中英文版附件.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/2068银川新华百货连锁超市有限公司A99-GYL-中英文版附件.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'f5334437-ca95-4a2f-977a-e56008a60f28'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'f5334437-ca95-4a2f-977a-e56008a60f28' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-10-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  'ZT' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：春香优选（宁夏）科技有限公司QES+英文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/10月份/春香优选（宁夏）科技有限公司QES+英文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1423e1ec-40e8-4397-897f-1a0ddf22daa5'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1423e1ec-40e8-4397-897f-1a0ddf22daa5' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T19001-2016' AS standard,
  '2025-11-12'::date AS issue_date,
  '2028-11-11'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625Q2647R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：海南州金院民族工艺美术商贸有限公司q-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/海南州金院民族工艺美术商贸--初审/海南州金院民族工艺美术商贸有限公司q-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T27922-2011' AS standard,
  NULL::date AS issue_date,
  '2028-03-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126225MS2066' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：2066银川新华百货连锁超市有限公司LY-中英文版附件.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/2066银川新华百货连锁超市有限公司LY-中英文版附件.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1423e1ec-40e8-4397-897f-1a0ddf22daa5'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1423e1ec-40e8-4397-897f-1a0ddf22daa5' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS' AS cert_type,
  'GB/T24001-2016' AS standard,
  '2025-11-12'::date AS issue_date,
  '2028-11-11'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625E1665R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：海南州金院民族工艺美术商贸有限公司e-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/海南州金院民族工艺美术商贸--初审/海南州金院民族工艺美术商贸有限公司e-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1423e1ec-40e8-4397-897f-1a0ddf22daa5'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1423e1ec-40e8-4397-897f-1a0ddf22daa5' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / OHSMS' AS cert_type,
  'GB/T 45001-2020' AS standard,
  '2025-11-12'::date AS issue_date,
  '2028-11-11'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625S1477R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：海南州金院民族工艺美术商贸有限公司s-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/海南州金院民族工艺美术商贸--初审/海南州金院民族工艺美术商贸有限公司s-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '2148e477-e3b8-4be6-898b-a1fd78a4a740'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '2148e477-e3b8-4be6-898b-a1fd78a4a740' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / OHSMS' AS cert_type,
  'GB/T 45001-2020' AS standard,
  '2025-12-08'::date AS issue_date,
  '2028-12-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625S1584R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏润宇塑业有限公司s-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/宁夏润宇塑业证书--初审/宁夏润宇塑业有限公司s-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '2148e477-e3b8-4be6-898b-a1fd78a4a740'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '2148e477-e3b8-4be6-898b-a1fd78a4a740' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T19001-2016' AS standard,
  '2025-12-08'::date AS issue_date,
  '2028-12-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625Q2867R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏润宇塑业有限公司q-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/宁夏润宇塑业证书--初审/宁夏润宇塑业有限公司q-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '2148e477-e3b8-4be6-898b-a1fd78a4a740'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '2148e477-e3b8-4be6-898b-a1fd78a4a740' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS' AS cert_type,
  'GB/T24001-2016' AS standard,
  '2025-12-08'::date AS issue_date,
  '2028-12-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '07625E1786R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏润宇塑业有限公司e-证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/11月份/宁夏润宇塑业证书--初审/宁夏润宇塑业有限公司e-证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2028-03-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126225MS2069' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：2069银川新华百货连锁超市有限公司A99-SA-中英文版附件.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/3月份/2069银川新华百货连锁超市有限公司A99-SA-中英文版附件.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '4c69803f-ed58-415e-bf3d-365b33e5f514'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '4c69803f-ed58-415e-bf3d-365b33e5f514' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-04-27'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05325I10133R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：中技安全-信息证书 英文文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/4月份/中技安全--信息证书/中技安全-信息证书 英文文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e84343f0-e493-412e-b4bc-8c330f15cbb1'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e84343f0-e493-412e-b4bc-8c330f15cbb1' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-04-24'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '05325I10129R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：政安信息中文版.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/4月份/政安信息--信息证书/政安信息中文版.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '4c69803f-ed58-415e-bf3d-365b33e5f514'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '4c69803f-ed58-415e-bf3d-365b33e5f514' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-04-27'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '0532025ITSM00071R0C' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：中技安全-信息证书 中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/4月份/中技安全--信息证书/中技安全-信息证书 中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8590831f-c809-4801-a22d-4c6220412816'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8590831f-c809-4801-a22d-4c6220412816' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色 / 能源' AS cert_type,
  'GB/T33635-2017' AS standard,
  NULL::date AS issue_date,
  '2028-08-20'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126025A991789R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏众鑫运输有限公司-绿色供应链管理体系+绿色管理(有水印).pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/8月份/宁夏众鑫运输有限公司-绿色供应链管理体系+绿色管理(有水印).pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e84343f0-e493-412e-b4bc-8c330f15cbb1'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e84343f0-e493-412e-b4bc-8c330f15cbb1' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-04-24'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '0532025ITSM00067R0MN' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：政安信息证书.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/4月份/政安信息--信息证书/政安信息证书.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'a6120111-8182-4465-b466-faf24d104fb8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'a6120111-8182-4465-b466-faf24d104fb8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2028-12-14'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '31425LSQY041R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：甘肃东方百佳商贸有限公司-绿色企业.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/12月份/甘肃东方百佳商贸有限公司-绿色企业.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'a6120111-8182-4465-b466-faf24d104fb8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'a6120111-8182-4465-b466-faf24d104fb8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色' AS cert_type,
  'GB/T 37422-2019' AS standard,
  NULL::date AS issue_date,
  '2028-12-14'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '31425GPC037R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：甘肃东方百佳商贸有限公司-绿色包装.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/12月份/甘肃东方百佳商贸有限公司-绿色包装.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2028-08-17'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126225MS6172R0M' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：6172银川新华百货连锁超市有限公司LSQY-中英文版附件.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/8月份/6172银川新华百货连锁超市有限公司LSQY-中英文版附件.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'c3f8e316-2452-4357-9361-19a83c6072e8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'c3f8e316-2452-4357-9361-19a83c6072e8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ISMS' AS cert_type,
  'ISO/IEC 27001:2022' AS standard,
  NULL::date AS issue_date,
  '2028-01-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '1022250014R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏英炜智慧电子信息工程有限公司-ISMS证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/1月份/宁夏英炜智慧电子信息工程有限公司-ISMS证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'a6120111-8182-4465-b466-faf24d104fb8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'a6120111-8182-4465-b466-faf24d104fb8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色' AS cert_type,
  'GB/T 33635-2017' AS standard,
  NULL::date AS issue_date,
  '2028-12-14'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '31425GSMS0242R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：甘肃东方百佳商贸有限公司-绿色供应链.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/12月份/甘肃东方百佳商贸有限公司-绿色供应链.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'c3f8e316-2452-4357-9361-19a83c6072e8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'c3f8e316-2452-4357-9361-19a83c6072e8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / ITSMS' AS cert_type,
  'ISO/IEC 20000' AS standard,
  NULL::date AS issue_date,
  '2028-01-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '1022250013R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏英炜智慧电子信息工程有限公司-ITSMS证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/1月份/宁夏英炜智慧电子信息工程有限公司-ITSMS证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1bc1579b-1ca0-4989-afd3-20b8f2c0f315'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1bc1579b-1ca0-4989-afd3-20b8f2c0f315' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T19001-2016' AS standard,
  NULL::date AS issue_date,
  '2026-05-04'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '102123Q0032R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：定边县申浩工贸有限责任公司-QMS证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协证书/15.定边县申浩工贸/定边县申浩工贸有限责任公司-QMS证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1bc1579b-1ca0-4989-afd3-20b8f2c0f315'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1bc1579b-1ca0-4989-afd3-20b8f2c0f315' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / OHSMS' AS cert_type,
  'GB/T45001-2020' AS standard,
  NULL::date AS issue_date,
  '2026-05-04'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '102123S0034R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：定边县申浩工贸有限责任公司-OHSMS证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协证书/15.定边县申浩工贸/定边县申浩工贸有限责任公司-OHSMS证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1bc1579b-1ca0-4989-afd3-20b8f2c0f315'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1bc1579b-1ca0-4989-afd3-20b8f2c0f315' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS' AS cert_type,
  'GB/T24001-2016' AS standard,
  NULL::date AS issue_date,
  '2026-05-04'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '102123E0033R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：定边县申浩工贸有限责任公司-EMS证书中文.pdf
文件路径：/mnt/renz/06、客户证书/外协证书/15.定边县申浩工贸/定边县申浩工贸有限责任公司-EMS证书中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '9b789d6a-3df8-4f56-a48a-6c9aa2f003db'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '9b789d6a-3df8-4f56-a48a-6c9aa2f003db' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 37029-2018' AS standard,
  NULL::date AS issue_date,
  '2027-12-30'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126224MS9082' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：9082安创蓓康生物科技有限公司A99-SWKZSX-中英文版.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/2024年初审/9082安创蓓康生物科技有限公司A99-SWKZSX-中英文版.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '9b789d6a-3df8-4f56-a48a-6c9aa2f003db'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '9b789d6a-3df8-4f56-a48a-6c9aa2f003db' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'ISO28000:2007' AS standard,
  NULL::date AS issue_date,
  '2027-12-30'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126224MS9081' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：9081安创蓓康生物科技有限公司A99-GYL-中英文版.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/2024年初审/9081安创蓓康生物科技有限公司A99-GYL-中英文版.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '9b789d6a-3df8-4f56-a48a-6c9aa2f003db'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '9b789d6a-3df8-4f56-a48a-6c9aa2f003db' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 31950-2023' AS standard,
  NULL::date AS issue_date,
  '2027-12-30'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126224MS9080' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：9080安创蓓康生物科技有限公司A99-CX-中英文版.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/2024年初审/9080安创蓓康生物科技有限公司A99-CX-中英文版.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '9b789d6a-3df8-4f56-a48a-6c9aa2f003db'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '9b789d6a-3df8-4f56-a48a-6c9aa2f003db' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 27922-2011' AS standard,
  NULL::date AS issue_date,
  '2027-12-30'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '126224MS9065' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：9065安创蓓康生物科技有限公司A99-SH5-中英文版.pdf
文件路径：/mnt/renz/06、客户证书/外协初审+监督/2024年初审/9065安创蓓康生物科技有限公司A99-SH5-中英文版.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8ef1551e-ced5-4ca1-acc5-9dab6d512b93'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8ef1551e-ced5-4ca1-acc5-9dab6d512b93' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-12-24'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '65625Q03563R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：鄂尔多斯市智业混凝土QES.pdf
文件路径：/mnt/renz/06、客户证书/外协证书/鄂尔多斯市智业混凝土QES.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T 27922-2011' AS standard,
  NULL::date AS issue_date,
  '2027-03-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27324SC10022R0M' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：SC 001 银川新华百货连锁超市有限公司（中认二维码证书）商品售后五星 监一.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/4月份/SC 001 银川新华百货连锁超市有限公司（中认二维码证书）商品售后五星 监一.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '343b86b7-bed4-44e8-9d8b-95095c18568c'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '343b86b7-bed4-44e8-9d8b-95095c18568c' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T 27922-2011' AS standard,
  NULL::date AS issue_date,
  '2026-02-27'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27323SC10014R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：SC 005 宁夏华辉环保科技股份有限公司（中认二维码证书）商品售后五星 监二.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/4月份/SC 005 宁夏华辉环保科技股份有限公司（中认二维码证书）商品售后五星 监二.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'b9fb9345-d4fa-4f16-9195-91cbc3e89eeb'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'b9fb9345-d4fa-4f16-9195-91cbc3e89eeb' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-28'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20084R1M' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1246 甘肃华奕门窗幕墙节能科技有限公司 CNAS（中认二维码证书） 再认证.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/2月份/QES 1246 甘肃华奕门窗幕墙节能科技有限公司 CNAS（中认二维码证书） 再认证.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'c3173e0a-c8a7-471f-8f68-d74973a599da'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'c3173e0a-c8a7-471f-8f68-d74973a599da' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2026-04-27'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27323Q20298R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 435 宁夏供销集团有限公司宁夏供销电子商务产业发展有限公司 CNAS 监二.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/4月份/QES 435 宁夏供销集团有限公司宁夏供销电子商务产业发展有限公司 CNAS 监二.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '1b258894-0816-4fe5-9111-19231e98cd68'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '1b258894-0816-4fe5-9111-19231e98cd68' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2027-01-23'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27324Q20060R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 027 银川忠盛恒信息服务有限公司 IAS（中认二维码证书）监一.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/1月份/QES 027 银川忠盛恒信息服务有限公司 IAS（中认二维码证书）监一.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '343b86b7-bed4-44e8-9d8b-95095c18568c'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '343b86b7-bed4-44e8-9d8b-95095c18568c' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2027-01-11'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27324Q20017R0M' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1459 宁夏华辉环保科技股份有限公司（中认二维码证书） 监一.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/1月份/QES 1459 宁夏华辉环保科技股份有限公司（中认二维码证书） 监一.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '4b707ce7-8276-4ffa-9466-6be145026353'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '4b707ce7-8276-4ffa-9466-6be145026353' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2026-12-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27323Q21093R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1524宁夏国韵城市环境服务有限公司 IAS（中认二维码证书）监一.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/1月份/QES 1524宁夏国韵城市环境服务有限公司 IAS（中认二维码证书）监一.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '94482c4b-3b8b-42c1-9b46-b81d1b2dc646'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '94482c4b-3b8b-42c1-9b46-b81d1b2dc646' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-02'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20003R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1248 永康宁（宁夏）实业有限公司 IAS（中认二维码证书）初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认监督2025/1月份/QES 1248 永康宁（宁夏）实业有限公司 IAS（中认二维码证书）初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e0b68e32-07b0-420e-a83b-d57c7032f668'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e0b68e32-07b0-420e-a83b-d57c7032f668' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-02-07'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20058R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：Q 060 宁夏八方工程管理咨询有限公司（中认二维码证书） 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/2月份/Q 060 宁夏八方工程管理咨询有限公司（中认二维码证书） 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '0fd03e88-2220-464d-8c8f-0058f277ddd4'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '0fd03e88-2220-464d-8c8f-0058f277ddd4' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / QMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-02-18'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20081R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：Q 032 宁夏金夏米业有限公司 IAS（中认二维码证书） 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/2月份/Q 032 宁夏金夏米业有限公司 IAS（中认二维码证书） 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8a4d47cf-9e8b-4f5a-a0f0-2d8a8274d196'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8a4d47cf-9e8b-4f5a-a0f0-2d8a8274d196' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-02-13'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20072R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 059 宁夏六盘山人力资源有限公司 Q IAS ES CNAS（中认二维码证书） 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/2月份/QES 059 宁夏六盘山人力资源有限公司 Q IAS ES CNAS（中认二维码证书） 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '288bec90-f36e-4383-af54-a0f85b5aaebf'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '288bec90-f36e-4383-af54-a0f85b5aaebf' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-02-05'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20056R0M' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 040 宁夏浩鑫遇通建设有限公司（中认二维码证书）初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/2月份/QES 040 宁夏浩鑫遇通建设有限公司（中认二维码证书）初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '8b28be70-664f-4720-8e1e-5bd9f63a56e8'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '8b28be70-664f-4720-8e1e-5bd9f63a56e8' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-04-02'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20195R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 253 宁夏鑫盛物业服务有限公司 CNAS 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/4月份/QES 253 宁夏鑫盛物业服务有限公司 CNAS 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'bb371a41-7993-4941-8d42-d2ada1f4e5b2'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'bb371a41-7993-4941-8d42-d2ada1f4e5b2' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-15'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20037R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1327 宁夏建安消防科技有限公司（中认二维码证书）初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/1月份/QES 1327 宁夏建安消防科技有限公司（中认二维码证书）初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'afe8b0e1-5a9f-4ced-9613-a2d679950bcb'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'afe8b0e1-5a9f-4ced-9613-a2d679950bcb' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-26'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20051R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 049 宁夏欣欣家润餐饮管理有限公司 IAS（中认二维码证书）初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/1月份/QES 049 宁夏欣欣家润餐饮管理有限公司 IAS（中认二维码证书）初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'a53d8ba6-0b39-47ea-94ee-a60580868b2c'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'a53d8ba6-0b39-47ea-94ee-a60580868b2c' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-06'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20014R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1338 宁夏绿盛康果蔬生鲜配送服务有限公司 CNAS（中认二维码证书） 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/1月份/QES 1338 宁夏绿盛康果蔬生鲜配送服务有限公司 CNAS（中认二维码证书） 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'ec43158c-efde-4e9e-9818-e391e3889ee7'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'ec43158c-efde-4e9e-9818-e391e3889ee7' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / QMS / OHSMS' AS cert_type,
  'GB/T 19001-2016' AS standard,
  NULL::date AS issue_date,
  '2028-01-06'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '27325Q20013R0S' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：QES 1334 绿源良品(宁夏)供应链有限公司 CNAS（中认二维码证书） 初审.pdf
文件路径：/mnt/renz/06、客户证书/中认2025年证书/中认初审2025/1月份/QES 1334 绿源良品(宁夏)供应链有限公司 CNAS（中认二维码证书） 初审.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '10a4df2b-5ce7-4ccb-a990-335366d3c911'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '10a4df2b-5ce7-4ccb-a990-335366d3c911' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / EMS / OHSMS' AS cert_type,
  'GB/T 24001-2016' AS standard,
  NULL::date AS issue_date,
  '2029-05-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226E00942R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏熊大果蔬ES中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/宁夏熊大果蔬ES中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '11fcbddf-a38a-4207-a28f-d14721f3c211'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '11fcbddf-a38a-4207-a28f-d14721f3c211' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 33129-2016' AS standard,
  NULL::date AS issue_date,
  '2029-05-20'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226APD00002R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川华冠食品APD中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/银川华冠食品APD中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '11fcbddf-a38a-4207-a28f-d14721f3c211'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '11fcbddf-a38a-4207-a28f-d14721f3c211' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'ISO 28000:2022' AS standard,
  NULL::date AS issue_date,
  '2029-05-20'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226SCS00005R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川华冠食品SCS中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/银川华冠食品SCS中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '10a4df2b-5ce7-4ccb-a990-335366d3c911'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '10a4df2b-5ce7-4ccb-a990-335366d3c911' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'ISO 28000:2022' AS standard,
  NULL::date AS issue_date,
  '2029-05-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226SCS00004R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏熊大果蔬SCS中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/宁夏熊大果蔬SCS中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '10a4df2b-5ce7-4ccb-a990-335366d3c911'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '10a4df2b-5ce7-4ccb-a990-335366d3c911' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  'GB/T 33129-2016' AS standard,
  NULL::date AS issue_date,
  '2029-05-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226APD00001R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏熊大果蔬APD中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/宁夏熊大果蔬APD中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '10a4df2b-5ce7-4ccb-a990-335366d3c911'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '10a4df2b-5ce7-4ccb-a990-335366d3c911' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2029-05-19'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226FT00001R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：宁夏熊大果蔬FT中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/宁夏熊大果蔬FT中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT '11fcbddf-a38a-4207-a28f-d14721f3c211'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = '11fcbddf-a38a-4207-a28f-d14721f3c211' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2029-05-20'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226FT00002R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川华冠食品FT中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/银川华冠食品FT中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at
UNION ALL

  SELECT 'e744b6c4-5905-4623-b725-8ee8d1dc512b'::uuid AS company_id,
  COALESCE((SELECT id FROM certification_project WHERE customer_id = 'e744b6c4-5905-4623-b725-8ee8d1dc512b' AND deleted_at IS NULL ORDER BY created_at LIMIT 1), NULL::uuid) AS project_id,
  'AAA / 绿色' AS cert_type,
  '' AS standard,
  NULL::date AS issue_date,
  '2029-05-31'::date AS valid_until,
  '华中国际认证检验集团有限公司' AS issuing_body,
  'active' AS status,
  '52226GC00037R000' AS certificate_no,
  '批量从 /mnt/renz/06、客户证书/ 提取：银川新华百货连锁超市GC中文.pdf
文件路径：/mnt/renz/06、客户证书/2026年外协证书/银川新华百货连锁超市GC中文.pdf' AS notes,
  NOW() AS created_at,
  NOW() AS updated_at

ON CONFLICT (id) DO NOTHING;


COMMIT;
