-- ============================================================
-- 审核项模板（012_audit_item_templates.sql）
-- 创建时间：2026-08-25
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_item_template (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID,
  template_code   VARCHAR(50),                          -- ISO9001 / ISO14001 / ISO45001 / All
  template_name   VARCHAR(100) NOT NULL,
  standards       VARCHAR(30)[] DEFAULT '{}',            -- 适用标准
  industry        VARCHAR(50),                          -- 适用行业（NULL = 通用）
  audit_type      VARCHAR(30) DEFAULT 'initial',         -- initial / surveillance / recertification

  -- 模板内容
  items           JSONB NOT NULL,                        -- [{clause, standard, department, question, evidence}]

  -- 元数据
  is_active       BOOLEAN DEFAULT TRUE,
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, template_code, audit_type)
);

CREATE INDEX IF NOT EXISTS idx_ait_active ON audit_item_template(is_active);
CREATE INDEX IF NOT EXISTS idx_ait_standards ON audit_item_template USING GIN(standards);

COMMENT ON TABLE audit_item_template IS '审核项模板库';
COMMENT ON COLUMN audit_item_template.items IS 'JSON 数组，每个元素：{clause, standard, department, question, evidence}';

-- 默认模板（公司级 NULL = 通用）
INSERT INTO audit_item_template
  (company_id, template_code, template_name, standards, audit_type, items, description)
VALUES
  -- QES 三体系综合模板（initial）
  (NULL, 'QES_INITIAL', 'QES三体系初次审核', ARRAY['iso9001','iso14001','iso45001'], 'initial',
  '[{"clause":"4.1","standard":"ISO 9001","department":"最高管理层","question":"组织是否识别了内外部环境因素？是否定期评审？","evidence":"环境因素识别清单、评审记录"},{"clause":"4.2","standard":"ISO 9001","department":"综合部","question":"是否识别了相关方及其需求和期望？","evidence":"相关方识别表"},{"clause":"6.1.2","standard":"ISO 14001","department":"环安专员","question":"环境因素识别是否全面？是否考虑生命周期？是否定期更新？","evidence":"环境因素识别与评价表"},{"clause":"6.1.3","standard":"ISO 14001","department":"环安专员","question":"是否识别并评价了适用法律法规？合规性评价如何？","evidence":"法律法规清单、合规性评价报告"},{"clause":"6.1.2","standard":"ISO 45001","department":"环安专员","question":"危险源辨识是否全面（三种状态/三种时态/七种类型）？风险评价合理？","evidence":"危险源辨识与风险评价表"},{"clause":"8.2","standard":"ISO 45001","department":"环安专员","question":"应急预案是否完善？演练频次合规？","evidence":"应急预案、演练记录"},{"clause":"7.2","standard":"All","department":"综合部","question":"关键岗位人员能力是否匹配？特殊工种是否持证？","evidence":"岗位说明书、资格证书"},{"clause":"7.5","standard":"All","department":"综合部","question":"文件控制是否受控？版本一致？发放回收记录完整？","evidence":"文件清单、收发记录"},{"clause":"8.1","standard":"All","department":"生产部","question":"关键过程是否识别并有效控制？操作规程上墙？","evidence":"过程清单、作业指导书"},{"clause":"8.5.1","standard":"All","department":"生产部","question":"生产过程控制：设备状态、参数记录、首件/巡检/成品检验","evidence":"设备台账、检验记录"},{"clause":"8.7","standard":"ISO 9001","department":"生产/品管","question":"不合格品控制：标识、隔离、评审、处置","evidence":"不合格品处理记录"},{"clause":"9.2","standard":"All","department":"综合部","question":"内审是否覆盖所有过程？不符合项整改是否闭环？","evidence":"内审计划、报告、整改记录"},{"clause":"9.3","standard":"All","department":"最高管理层","question":"管理评审输入材料是否齐全？输出有改进决议？","evidence":"管理评审资料、决议"},{"clause":"10.2","standard":"All","department":"综合部","question":"纠正措施是否有效（原因分析 + 措施 + 验证）？","evidence":"纠正措施单"}]'::jsonb,
  '适用于三体系（QES）初次审核的标准模板，基于 GB/T 19001/24001/45001:2016/2020'

),
  (NULL, 'QES_SURVEILLANCE', 'QES三体系监督审核', ARRAY['iso9001','iso14001','iso45001'], 'surveillance',
  '[{"clause":"4.1","standard":"ISO 9001","department":"最高管理层","question":"环境因素是否有变化？领导作用是否持续？","evidence":"环境变化识别记录"},{"clause":"6.1.2","standard":"ISO 14001","department":"环安专员","question":"环境因素变化？新项目环境影响评价？","evidence":"环评报告"},{"clause":"6.1.2","standard":"ISO 45001","department":"环安专员","question":"危险源变化？新工艺风险？","evidence":"危险源更新表"},{"clause":"9.2","standard":"All","department":"综合部","question":"上次不符合项整改有效性？","evidence":"整改验证记录"},{"clause":"10.2","standard":"All","department":"综合部","question":"纠正措施持续有效？","evidence":"持续改进记录"},{"clause":"8.5.1","standard":"All","department":"生产部","question":"生产过程持续受控？","evidence":"过程监视记录"}]'::jsonb,
  '适用于 QES 三体系年度监督审核（推荐人日更少）'

),
  (NULL, 'QES_RECERT', 'QES三体系再认证', ARRAY['iso9001','iso14001','iso45001'], 'recertification',
  '[{"clause":"4.1","standard":"ISO 9001","department":"最高管理层","question":"3 年内环境因素变化及应对","evidence":"3 年评审总结"},{"clause":"6.1.2","standard":"ISO 14001","department":"环安专员","question":"3 年环境绩效改进情况","evidence":"环境绩效趋势"},{"clause":"6.1.2","standard":"ISO 45001","department":"环安专员","question":"3 年安全绩效改进","evidence":"安全绩效趋势"},{"clause":"9.2","standard":"All","department":"综合部","question":"内审全覆盖？整改有效性？","evidence":"3 年内审报告"},{"clause":"9.3","standard":"All","department":"最高管理层","question":"管理评审持续有效？","evidence":"管理评审决议跟踪"},{"clause":"10.2","standard":"All","department":"综合部","question":"持续改进成果？","evidence":"改进成果统计"}]'::jsonb,
  '适用于 QES 三体系 3 年期再认证审核（深度最高）'

),
  (NULL, 'Q_INITIAL', 'Q质量体系初次审核', ARRAY['iso9001'], 'initial',
  '[{"clause":"4.1","standard":"ISO 9001","department":"最高管理层","question":"组织环境识别","evidence":"环境因素清单"},{"clause":"4.2","standard":"ISO 9001","department":"综合部","question":"相关方需求识别","evidence":"相关方清单"},{"clause":"7.2","standard":"ISO 9001","department":"综合部","question":"人员能力匹配","evidence":"岗位说明书"},{"clause":"7.5","standard":"ISO 9001","department":"综合部","question":"文件控制","evidence":"文件清单"},{"clause":"8.1","standard":"ISO 9001","department":"生产部","question":"关键过程控制","evidence":"作业指导书"},{"clause":"8.5.1","standard":"ISO 9001","department":"生产部","question":"生产过程控制","evidence":"过程监视记录"},{"clause":"8.7","standard":"ISO 9001","department":"品管","question":"不合格品控制","evidence":"不合格品记录"},{"clause":"9.2","standard":"ISO 9001","department":"综合部","question":"内审有效性","evidence":"内审报告"},{"clause":"9.3","standard":"ISO 9001","department":"管理层","question":"管理评审有效性","evidence":"评审记录"},{"clause":"10.2","standard":"ISO 9001","department":"综合部","question":"纠正措施有效性","evidence":"纠正措施单"}]'::jsonb,
  '单体系 Q 初次审核（10 项核心条款）'

)
ON CONFLICT DO NOTHING;