import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Save, X } from "lucide-react";
import { api } from "../lib/api";
import type {
  PartnerOrg, ServiceType, Signatory
} from "../types";

interface NewProjectPageProps {
  onBack: () => void;
  onCreated: (id: string) => void;
}

export function NewProjectPage({ onBack, onCreated }: NewProjectPageProps) {
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [partnerOrgs, setPartnerOrgs] = useState<PartnerOrg[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; industry?: string }>>([]);
  const [searchedCustomers, setSearchedCustomers] = useState<Array<{ id: string; name: string; industry?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 表单
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [signatoryId, setSignatoryId] = useState("");
  const [partnerOrgId, setPartnerOrgId] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [industry, setIndustry] = useState("");
  const [certificationScope, setCertificationScope] = useState("");
  const [certificationStandards, setCertificationStandards] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [salesSource, setSalesSource] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [expectedCertDate, setExpectedCertDate] = useState("");
  const [notes, setNotes] = useState("");

  // 新建外协
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerContact, setNewPartnerContact] = useState("");
  const [newPartnerPhone, setNewPartnerPhone] = useState("");

  // 新建客户
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerContact, setNewCustomerContact] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerIndustry, setNewCustomerIndustry] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  useEffect(() => {
    console.log("NewProjectPage useEffect start");
    Promise.all([
      api.listSignatories(),
      api.listServiceTypes(),
      api.listPartnerOrgs(),
    ]).then(([sigs, svcs, parts]: any) => {
      setSignatories(sigs || []);
      setServiceTypes(svcs || []);
      setPartnerOrgs(parts || []);
    }).catch((e) => console.error("load error", e));
  }, []);

  // 实时搜索客户（防抖）
  useEffect(() => {
    const q = customerSearch.trim();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.searchCustomers(q, 30);
        setSearchedCustomers((r as any).data || r || []);
      } catch { setSearchedCustomers([]); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const selectedServiceType = serviceTypes.find((s) => s.id === serviceTypeId);
  const needPartner = selectedServiceType?.config?.need_partner;

  async function handleSubmit() {
    if (!customerId) { setError("请选择客户"); return; }
    if (!serviceTypeId) { setError("请选择服务类型"); return; }
    if (!signatoryId) { setError("请选择签约主体"); return; }
    if (needPartner && !partnerOrgId) { setError("该服务类型需要选择外协单位"); return; }

    setSubmitting(true);
    setError("");
    try {
      const result: any = await api.createCertificationProject({
        customerId,
        serviceTypeId,
        signatoryId,
        partnerOrgId: needPartner ? partnerOrgId : undefined,
        contactPerson: contactPerson || undefined,
        contactPhone: contactPhone || undefined,
        industry: industry || undefined,
        certificationScope: certificationScope || undefined,
        certificationStandards: certificationStandards || undefined,
        riskLevel: riskLevel || undefined,
        salesSource: salesSource || undefined,
        contractAmount: contractAmount ? Number(contractAmount) : undefined,
        expectedCertDate: expectedCertDate || undefined,
        notes: notes || undefined,
      });
      console.log("createProject result:", result);
      onCreated(result.id);
    } catch (e: any) {
      setError(e?.message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreatePartner() {
    if (!newPartnerName.trim()) return;
    try {
      const r = await api.createPartnerOrg({
        name: newPartnerName.trim(),
        contactPerson: newPartnerContact.trim(),
        contactPhone: newPartnerPhone.trim(),
      });
      setPartnerOrgs((prev) => [r.data, ...prev]);
      setPartnerOrgId(r.data.id);
      setShowPartnerModal(false);
      setNewPartnerName("");
      setNewPartnerContact("");
      setNewPartnerPhone("");
    } catch (e: any) {
      alert(e?.message || "创建外协失败");
    }
  }

  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) {
      alert("请填写客户名称");
      return;
    }
    setCreatingCustomer(true);
    try {
      // 自动生成 customerCode（基于名称拼音首字母 + 时间戳）
      const code = "C" + Date.now().toString().slice(-8);
      const r: any = await api.createCustomer({
        customerCode: code,
        name: newCustomerName.trim(),
        contactPerson: newCustomerContact.trim() || undefined,
        contactPhone: newCustomerPhone.trim() || undefined,
        industry: newCustomerIndustry.trim() || undefined,
        status: "active"
      });
      // 关闭弹窗 + 重置
      setShowCustomerModal(false);
      setNewCustomerName("");
      setNewCustomerContact("");
      setNewCustomerPhone("");
      setNewCustomerIndustry("");
      // 自动加到客户列表 + 自动选中
      const created = r;
      if (created && created.id) {
        setCustomers((prev) => [created, ...prev]);
        setCustomerId(created.id);
        setCustomerSearch("");
      }
    } catch (e: any) {
      alert(e?.message || "创建客户失败");
    } finally {
      setCreatingCustomer(false);
    }
  }

  const filteredCustomers = searchedCustomers;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <button className="back-button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回工作台
          </button>
          <h1>新建认证项目</h1>
          <p>选择客户、服务类型、签约主体，建立一条完整业务主线</p>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="form-section">
        {/* 客户 */}
        <div className="form-row">
          <label>客户 *</label>
          <div className="customer-search">
            <input
              type="text"
              placeholder="🔍 输入客户名称模糊搜索（按客户名 / 简称 / 行业）..."
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setCustomerDropdownOpen(true);
              }}
              onFocus={() => setCustomerDropdownOpen(true)}
              onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 200)}
              autoComplete="off"
            />
            {customerDropdownOpen && (
              <div className="customer-dropdown">
                {searching && <div className="customer-dropdown-empty">搜索中...</div>}
                {!searching && filteredCustomers.length === 0 && (
                  <div className="customer-dropdown-empty">
                    {customerSearch.trim()
                      ? <>未找到" {customerSearch} "的客户。<br/>点下面"➕ 新建客户"创建。</>
                      : "暂无客户，请新建。"}
                  </div>
                )}
                {!searching && filteredCustomers.length > 0 && (
                  <>
                    <div className="customer-dropdown-hint">
                      找到 {filteredCustomers.length} 个客户（{customerSearch ? `关键词："${customerSearch}"` : "全部"}）
                    </div>
                    {filteredCustomers.map((c) => (
                      <div
                        key={c.id}
                        className={`customer-dropdown-item ${customerId === c.id ? "selected" : ""}`}
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerDropdownOpen(false);
                        }}
                      >
                        <span className="customer-name">{c.name}</span>
                        {c.industry && <span className="customer-industry">· {c.industry}</span>}
                      </div>
                    ))}
                  </>
                )}
                <div
                  className="customer-dropdown-item customer-dropdown-new"
                  onClick={() => {
                    setShowCustomerModal(true);
                    setCustomerDropdownOpen(false);
                  }}
                >
                  ➕ 新建客户...
                </div>
              </div>
            )}
          </div>
          {customerId && (
            <div className="selected-customer-info">
              <small>
                已选客户：<strong>{searchedCustomers.find((c) => c.id === customerId)?.name || "(已选，需重新搜索显示)"}</strong>
              </small>
              <button
                type="button"
                className="ghost-button small"
                onClick={() => {
                  setCustomerId("");
                  setCustomerSearch("");
                  setCustomerDropdownOpen(true);
                }}
                style={{ marginLeft: 8, padding: "2px 8px" }}
              >
                重新选择
              </button>
            </div>
          )}
        </div>

        {/* 服务类型 */}
        <div className="form-row">
          <label>服务类型 *</label>
          <div className="service-type-grid">
            {serviceTypes.map((st) => (
              <button
                key={st.id}
                className={`service-type-card ${serviceTypeId === st.id ? "active" : ""}`}
                onClick={() => setServiceTypeId(st.id)}
                type="button"
              >
                <strong>{st.name}</strong>
                <small>{st.description}</small>
                {st.config?.need_partner && <span className="badge">需外协</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 签约主体 */}
        <div className="form-row">
          <label>签约主体 *</label>
          <select value={signatoryId} onChange={(e) => setSignatoryId(e.target.value)}>
            <option value="">-- 选择签约主体 --</option>
            {signatories.map((s) => (
              <option key={s.id} value={s.id}>
                {(s as any).shortName || (s as any).short_name || s.name}
              </option>
            ))}
          </select>
        </div>

        {/* 外协单位 */}
        {needPartner && (
          <div className="form-row">
            <label>外协认证单位 *</label>
            <div className="partner-row">
              <select value={partnerOrgId} onChange={(e) => setPartnerOrgId(e.target.value)}>
                <option value="">-- 选择外协 --</option>
                {partnerOrgs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button className="ghost-button" onClick={() => setShowPartnerModal(true)}>
                <Plus size={14} /> 新建外协
              </button>
            </div>
          </div>
        )}

        {/* 联系人 */}
        <div className="form-row-2">
          <div>
            <label>联系人</label>
            <input type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </div>
          <div>
            <label>联系电话</label>
            <input type="text" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
        </div>

        {/* 行业/标准/范围 */}
        <div className="form-row-3">
          <div>
            <label>行业</label>
            <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="如：食品" />
          </div>
          <div>
            <label>风险等级</label>
            <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
              <option value="">-- 选择 --</option>
              <option value="low">低风险</option>
              <option value="medium">中风险</option>
              <option value="high">高风险</option>
            </select>
          </div>
          <div>
            <label>销售来源</label>
            <input type="text" value={salesSource} onChange={(e) => setSalesSource(e.target.value)} placeholder="如：客户转介绍" />
          </div>
        </div>

        {/* 认证范围 */}
        <div className="form-row">
          <label>申请认证范围</label>
          <textarea
            rows={3}
            value={certificationScope}
            onChange={(e) => setCertificationScope(e.target.value)}
            placeholder="如：餐饮服务、快餐配送、团餐加工"
          />
        </div>

        {/* 认证标准 */}
        <div className="form-row">
          <label>认证标准</label>
          <input
            type="text"
            value={certificationStandards}
            onChange={(e) => setCertificationStandards(e.target.value)}
            placeholder="如：GB/T 19001-2016"
          />
        </div>

        {/* 金额 / 日期 */}
        <div className="form-row-2">
          <div>
            <label>合同金额（元）</label>
            <input type="number" value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label>预计出证日期</label>
            <input type="date" value={expectedCertDate} onChange={(e) => setExpectedCertDate(e.target.value)} />
          </div>
        </div>

        {/* 备注 */}
        <div className="form-row">
          <label>备注</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="form-actions">
          <button className="ghost-button" onClick={onBack}>取消</button>
          <button className="primary-button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {submitting ? "创建中..." : "创建项目"}
          </button>
        </div>
      </section>

      {/* 新建客户弹窗 */}
      {showCustomerModal && (
        <div className="modal-overlay" onClick={() => setShowCustomerModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Plus size={18} /> 新建客户</h3>
            <p className="muted small">客户会立即加入客户管理库，同时自动选中用于本项目</p>
            <div className="form-row">
              <label>客户名称 *</label>
              <input
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                placeholder="例：宁夏某某新材料有限公司"
              />
            </div>
            <div className="form-row-2">
              <div>
                <label>联系人</label>
                <input
                  value={newCustomerContact}
                  onChange={(e) => setNewCustomerContact(e.target.value)}
                />
              </div>
              <div>
                <label>联系电话</label>
                <input
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="form-row">
              <label>行业</label>
              <input
                value={newCustomerIndustry}
                onChange={(e) => setNewCustomerIndustry(e.target.value)}
                placeholder="例：食品 / 化工 / 制造"
              />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowCustomerModal(false)}><X size={14} /> 取消</button>
              <button className="primary-button" onClick={handleCreateCustomer} disabled={creatingCustomer}>
                <Save size={14} /> {creatingCustomer ? "保存中..." : "保存并选中"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建外协弹窗 */}
      {showPartnerModal && (
        <div className="modal-overlay" onClick={() => setShowPartnerModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Plus size={18} /> 新建合作认证单位</h3>
            <div className="form-row">
              <label>单位名称 *</label>
              <input
                type="text"
                value={newPartnerName}
                onChange={(e) => setNewPartnerName(e.target.value)}
                placeholder="外协认证单位名称"
              />
            </div>
            <div className="form-row-2">
              <div>
                <label>联系人</label>
                <input
                  type="text"
                  value={newPartnerContact}
                  onChange={(e) => setNewPartnerContact(e.target.value)}
                />
              </div>
              <div>
                <label>联系电话</label>
                <input
                  type="text"
                  value={newPartnerPhone}
                  onChange={(e) => setNewPartnerPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowPartnerModal(false)}>
                <X size={14} /> 取消
              </button>
              <button className="primary-button" onClick={handleCreatePartner}>
                <Save size={14} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}