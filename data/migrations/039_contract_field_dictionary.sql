-- V2.3 字段字典导入（30 个字段）
-- 从 4 份合同抽象出来的通用字段

BEGIN;

-- ============================================================
-- 1. 基础信息（basic）
-- ============================================================
INSERT INTO contract_field_dictionary
  (field_code, field_label, field_category, data_type, required, applies_to, sort_order, description, example_value)
VALUES
  ('customer_name', '甲方客户名称', 'basic', 'string', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 10,
   '客户公司全称（含"有限公司"等）', '宁夏厚生记枸杞饮品股份有限公司'),
  ('customer_address', '甲方通讯地址', 'basic', 'text', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 11,
   '客户公司地址', '宁夏贺兰县德胜工业园区新胜西路1号'),
  ('customer_legal_rep', '甲方法人代表', 'basic', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 12,
   '客户方法人代表/授权人', '张三'),
  ('signing_entity', '乙方主体', 'basic', 'enum', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 13,
   '签约主体（华中/中认/外协）', '中认认证有限公司'),
  ('contract_no', '合同编号', 'basic', 'string', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 14,
   '合同编号（自动生成）', 'HZCX-2026-001'),
  ('signed_at', '签订日期', 'basic', 'date', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 15,
   '合同签订日期', '2024-03-15'),
  ('effective_at', '生效日期', 'basic', 'date', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 16,
   '合同生效日期', '2024-03-15'),
  ('expire_at', '到期日期', 'basic', 'date', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 17,
   '合同到期日期', '2027-03-14');

-- ============================================================
-- 2. 联系方式（contact）
-- ============================================================
INSERT INTO contract_field_dictionary
  (field_code, field_label, field_category, data_type, required, applies_to, sort_order, description, example_value)
VALUES
  ('contact_person', '客户方联系人', 'contact', 'string', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 20,
   '客户方联系人姓名', '赵小兰'),
  ('contact_phone', '联系电话', 'contact', 'string', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 21,
   '11位手机号', '18919260770'),
  ('contact_email', '电子邮箱', 'contact', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 22,
   '客户联系邮箱', 'zhang@company.com'),
  ('contact_position', '联系人职务', 'contact', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 23,
   '联系人职务', '总经理');

-- ============================================================
-- 3. 认证信息（cert）
-- ============================================================
INSERT INTO contract_field_dictionary
  (field_code, field_label, field_category, data_type, enum_options, required, applies_to, sort_order, description, example_value)
VALUES
  ('cert_category', '认证类别', 'cert', 'array',
   '["初次认证","监督审核","再认证","转换机构","结合再认证","结合次监督"]'::jsonb,
   TRUE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 30,
   '认证类型（多选）', '["初次认证"]'),

  ('cert_systems', '认证体系', 'cert', 'array',
   '["QMS","EMS","OHSMS","ISMS","ITSMS","HACCP","FSMS","SC","EnMS","ISO9001","ISO14001","ISO45001","ISO27001","ISO22000","HACCP","ISO13485","HSE","ISO22301","GB/T50430","GB/T31274","ISO28000","ISO27701","GB/T39604","GB/T31950","GB/T35770","ISO37001","ISO50001"]'::jsonb,
   TRUE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 31,
   '认证体系（多选）', '["QMS","EMS","OHSMS"]'),

  ('cert_scope', '认证范围', 'cert', 'text', NULL,
   TRUE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 32,
   '甲方申请的认证范围描述', '维生素风味饮料、枸杞饮料及碳酸饮料的生产'),

  ('audit_region', '审核区域场所', 'cert', 'text', NULL,
   TRUE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 33,
   '现场审核的区域场所', '宁夏贺兰县德胜工业园区新胜西路1号厂区'),

  ('employee_count', '员工人数', 'cert', 'number', NULL,
   TRUE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 34,
   '甲方体系内有效人数', '55'),

  ('site_count', '分公司/分厂数', 'cert', 'number', NULL,
   FALSE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 35,
   '固定场所数', '0'),

  ('temp_site_count', '临时现场数', 'cert', 'number', NULL,
   FALSE, ARRAY['ZRC','EXTERNAL']::text[], 36,
   '正在实施的临时现场数', '0'),

  ('accreditation_mark', '认可标志', 'cert', 'enum',
   '["CNAS","IAS","无"]'::jsonb,
   FALSE, ARRAY['ZRC']::text[], 37,
   '是否带认可标志', 'CNAS'),

  ('certificate_validity', '证书有效期', 'cert', 'enum',
   '["1年","2年","3年"]'::jsonb,
   FALSE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 38,
   '证书有效期', '3年'),

  ('multi_site_required', '多场所要求', 'cert', 'boolean', NULL,
   FALSE, ARRAY['HZCX','ZRC','EXTERNAL']::text[], 39,
   '是否要求多场所清单附件', 'true'),

  ('special_requirements', '其它特殊要求', 'cert', 'text', NULL,
   FALSE, ARRAY['ZRC']::text[], 40,
   '客户特别要求（如加急、特定审核员等）', NULL);

-- ============================================================
-- 4. 费用信息（amount）
-- ============================================================
INSERT INTO contract_field_dictionary
  (field_code, field_label, field_category, data_type, required, applies_to, sort_order, description, example_value)
VALUES
  ('first_audit_fee', '初次认证费', 'amount', 'number', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 50,
   '初审认证费（元）', '8000'),
  ('first_year_supervision_fee', '第一年监督审核费', 'amount', 'number', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 51,
   '第一年监审费（元）', '3000'),
  ('second_year_supervision_fee', '第二年监督审核费', 'amount', 'number', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 52,
   '第二年监审费（元）', '3000'),
  ('recert_fee', '再认证费', 'amount', 'number', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 53,
   '再认证费（元）', '8000'),
  ('total_amount', '合同总金额', 'amount', 'number', TRUE, ARRAY['HZCX','ZRC','EXTERNAL'], 54,
   '合同总金额（自动计算）', '22000'),
  ('payment_terms', '付款条款', 'amount', 'text', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 55,
   '付款方式说明', '现场审核前30日内一次性支付');

-- ============================================================
-- 5. 银行信息（bank）
-- ============================================================
INSERT INTO contract_field_dictionary
  (field_code, field_label, field_category, data_type, required, applies_to, sort_order, description, example_value)
VALUES
  ('bank_name', '收款开户行', 'bank', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 60,
   '乙方收款开户行', '宁夏银行光明支行'),
  ('bank_holder', '收款户名', 'bank', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 61,
   '乙方收款户名', '中认认证有限公司宁夏分公司'),
  ('bank_account', '收款账号', 'bank', 'string', FALSE, ARRAY['HZCX','ZRC','EXTERNAL'], 62,
   '乙方收款账号', '1200000691398');

-- ============================================================
-- 验证
-- ============================================================
DO $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt FROM contract_field_dictionary;
  RAISE NOTICE '✅ V2.3 字段字典导入完成：% 个字段', cnt;
END $$;

COMMIT;