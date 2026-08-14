-- 004_missing_tables.sql
-- 补齐 001-003 migration 未定义但代码使用的 11 张表
-- 通过 pg_dump -t 单表反推生产 DB schema
-- 适用于：重新初始化 DB（裸库从 001-004 跑通）
-- 部署顺序：001 → 004 → 002 → 003
-- 注意：需要先用 postgres 超级用户创建 vector 扩展：
--   CREATE EXTENSION IF NOT EXISTS vector;

-- ========== knowledge_feedback ==========
CREATE TABLE public.knowledge_feedback (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    user_id uuid,
    is_helpful boolean NOT NULL,
    comment text,
    correct_content text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_feedback knowledge_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_feedback
    ADD CONSTRAINT knowledge_feedback_pkey PRIMARY KEY (id);


--
-- Name: idx_kb_feedback_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_feedback_doc ON public.knowledge_feedback USING btree (document_id);


--
-- Name: knowledge_feedback knowledge_feedback_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_feedback
    ADD CONSTRAINT knowledge_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: knowledge_feedback knowledge_feedback_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_feedback
    ADD CONSTRAINT knowledge_feedback_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_document(id) ON DELETE CASCADE;


--
-- Name: knowledge_feedback knowledge_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_feedback
    ADD CONSTRAINT knowledge_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id);


--
-- PostgreSQL database dump complete
--

\unrestrict jsAue7dg5krVuc8omshSl3Ai9dfCMxvd3N9tj3WjJD1H0bNM2ccZ7mz2KbvzK4t




-- ========== mfa_pending_token ==========
CREATE TABLE public.mfa_pending_token (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: mfa_pending_token mfa_pending_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_pending_token
    ADD CONSTRAINT mfa_pending_token_pkey PRIMARY KEY (id);


--
-- Name: idx_mfa_pending_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mfa_pending_expiry ON public.mfa_pending_token USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: idx_mfa_pending_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mfa_pending_hash ON public.mfa_pending_token USING btree (token_hash);


--
-- Name: mfa_pending_token mfa_pending_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_pending_token
    ADD CONSTRAINT mfa_pending_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Kcbj7oEUscDmCb0keWmVkEdT4Cx7rc4F5qec2nYcEQCCPgaiQgzP89EMXy4R9mC




-- ========== zero_result_query ==========
CREATE TABLE public.zero_result_query (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    query_text text NOT NULL,
    query_hash character varying(64),
    user_id uuid,
    frequency integer DEFAULT 1,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now()
);


--
-- Name: zero_result_query zero_result_query_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zero_result_query
    ADD CONSTRAINT zero_result_query_pkey PRIMARY KEY (id);


--
-- Name: idx_zr_frequency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zr_frequency ON public.zero_result_query USING btree (company_id, frequency DESC);


--
-- Name: idx_zr_query_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_zr_query_hash ON public.zero_result_query USING btree (company_id, query_hash);


--
-- Name: zero_result_query zero_result_query_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zero_result_query
    ADD CONSTRAINT zero_result_query_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: zero_result_query zero_result_query_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zero_result_query
    ADD CONSTRAINT zero_result_query_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id);


--
-- PostgreSQL database dump complete
--

\unrestrict ZGg1Bsi3JopFob7DeSdpBtCVEsYGcJr4RwCqjKYObAdKiAbpzGPif93mgmoRYOh




-- ========== knowledge_version_v2 ==========
CREATE TABLE public.knowledge_version_v2 (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version integer NOT NULL,
    content_text text NOT NULL,
    change_summary text,
    created_by uuid,
    review_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_version_v2 knowledge_version_v2_document_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_document_id_version_key UNIQUE (document_id, version);


--
-- Name: knowledge_version_v2 knowledge_version_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_pkey PRIMARY KEY (id);


--
-- Name: idx_version_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_version_doc ON public.knowledge_version_v2 USING btree (document_id, version DESC);


--
-- Name: knowledge_version_v2 knowledge_version_v2_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: knowledge_version_v2 knowledge_version_v2_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_user(id);


--
-- Name: knowledge_version_v2 knowledge_version_v2_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_document(id) ON DELETE CASCADE;


--
-- Name: knowledge_version_v2 knowledge_version_v2_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_version_v2
    ADD CONSTRAINT knowledge_version_v2_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.knowledge_review(id);


--
-- PostgreSQL database dump complete
--

\unrestrict iRQkmHccbxVBrVh8YAil8MkWoepKf9PwtIxdbT3g0g5UnUMRcKgKSXGrJm76y6E




-- ========== audit_session ==========
CREATE TABLE public.audit_session (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    customer_name text NOT NULL,
    industry text,
    employee_count integer,
    audit_type text NOT NULL,
    standards text[] NOT NULL,
    address text,
    contact_person text,
    contact_phone text,
    scheduled_date date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    attachments_ready boolean DEFAULT false,
    CONSTRAINT audit_session_audit_type_check CHECK ((audit_type = ANY (ARRAY['initial'::text, 'surveillance'::text, 'recertification'::text])))
);


--
-- Name: COLUMN audit_session.attachments_ready; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_session.attachments_ready IS '出报告前附件是否就绪（false 阻止出报告）';


--
-- Name: audit_session audit_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_session
    ADD CONSTRAINT audit_session_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_session_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_session_company ON public.audit_session USING btree (company_id);


--
-- PostgreSQL database dump complete
--

\unrestrict 0WkRcXkKfDC0vi2VnqhWObgWY4ObXfxvocWFnpdqZ2lCnBOlrcaHddnO6KQ1xzb




-- ========== consultation_feedback ==========
CREATE TABLE public.consultation_feedback (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    consultation_id uuid NOT NULL,
    user_id uuid,
    rating smallint NOT NULL,
    comment text,
    issue_type character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT consultation_feedback_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 0, 1])))
);


--
-- Name: consultation_feedback consultation_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_pkey PRIMARY KEY (id);


--
-- Name: idx_feedback_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_company ON public.consultation_feedback USING btree (company_id, created_at DESC);


--
-- Name: idx_feedback_consultation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_consultation ON public.consultation_feedback USING btree (consultation_id);


--
-- Name: consultation_feedback consultation_feedback_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: consultation_feedback consultation_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_feedback
    ADD CONSTRAINT consultation_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eOdXunki5hcGpLUr8ot2wF6jMmZrdEE6ebaO33weJGUCZvtlzGFbm0BycEkPXd9




-- ========== active_token ==========
CREATE TABLE public.active_token (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_ip inet,
    user_agent text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: active_token active_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_token
    ADD CONSTRAINT active_token_pkey PRIMARY KEY (id);


--
-- Name: idx_active_token_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_token_expiry ON public.active_token USING btree (expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_token_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_expires ON public.active_token USING btree (expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_hash ON public.active_token USING btree (token_hash) WHERE (revoked_at IS NULL);


--
-- Name: idx_token_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_user ON public.active_token USING btree (user_id, expires_at DESC);


--
-- Name: active_token active_token_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_token
    ADD CONSTRAINT active_token_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: active_token active_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_token
    ADD CONSTRAINT active_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict qiDiI2sx1YUB2BocUPWxyehHDCLH9xNpqub8q9bOvp4Jdj4MotJ6OIIqNXSvfCw




-- ========== audit_attachment ==========
CREATE TABLE public.audit_attachment (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    session_id uuid NOT NULL,
    item_id uuid NOT NULL,
    original_name text NOT NULL,
    stored_name text NOT NULL,
    file_type text NOT NULL,
    mime_type text,
    size_bytes bigint NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_attachment audit_attachment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_attachment
    ADD CONSTRAINT audit_attachment_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_attachment_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_attachment_company ON public.audit_attachment USING btree (company_id);


--
-- Name: idx_audit_attachment_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_attachment_item ON public.audit_attachment USING btree (item_id);


--
-- Name: idx_audit_attachment_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_attachment_session ON public.audit_attachment USING btree (session_id);


--
-- Name: audit_attachment audit_attachment_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_attachment
    ADD CONSTRAINT audit_attachment_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.audit_checklist_item(id) ON DELETE CASCADE;


--
-- Name: audit_attachment audit_attachment_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_attachment
    ADD CONSTRAINT audit_attachment_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.audit_session(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict mMzt7PGEtin42FgjAoobr4PBB8mg3r6yJGVvJkSUVrItPJO72RSU4hgxH8DobmX




-- ========== knowledge_review ==========
CREATE TABLE public.knowledge_review (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_id uuid NOT NULL,
    document_id uuid NOT NULL,
    feedback_id uuid,
    submitted_by uuid,
    review_type character varying(20) NOT NULL,
    proposed_content text,
    reason text,
    status character varying(20) DEFAULT 'pending'::character varying,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    new_version integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_review knowledge_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_pkey PRIMARY KEY (id);


--
-- Name: idx_review_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_doc ON public.knowledge_review USING btree (document_id);


--
-- Name: idx_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_status ON public.knowledge_review USING btree (company_id, status, created_at DESC);


--
-- Name: knowledge_review knowledge_review_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(id) ON DELETE CASCADE;


--
-- Name: knowledge_review knowledge_review_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_document(id) ON DELETE CASCADE;


--
-- Name: knowledge_review knowledge_review_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.knowledge_feedback(id);


--
-- Name: knowledge_review knowledge_review_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.app_user(id);


--
-- Name: knowledge_review knowledge_review_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_review
    ADD CONSTRAINT knowledge_review_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.app_user(id);


--
-- PostgreSQL database dump complete
--

\unrestrict roXd4ggofISZ076HzYrr6jxmIBFGZi6xQuag79XzxsXhNUiRBY9aqMw6WX0PUV2




-- ========== audit_checklist_item ==========
CREATE TABLE public.audit_checklist_item (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    clause text NOT NULL,
    standard text NOT NULL,
    department text NOT NULL,
    question text NOT NULL,
    evidence text NOT NULL,
    result text DEFAULT 'pending'::text NOT NULL,
    notes text DEFAULT ''::text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audit_checklist_item_result_check CHECK ((result = ANY (ARRAY['pass'::text, 'ng_major'::text, 'ng_minor'::text, 'observation'::text, 'pending'::text])))
);


--
-- Name: audit_checklist_item audit_checklist_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_checklist_item
    ADD CONSTRAINT audit_checklist_item_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_item_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_item_session ON public.audit_checklist_item USING btree (session_id);


--
-- Name: audit_checklist_item audit_checklist_item_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_checklist_item
    ADD CONSTRAINT audit_checklist_item_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.audit_session(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict AuTb7blcoIW1Kj7acOEbxepq3667ptOOJuIgOJq6CQU67914aWgg76cOPnLZw1A




-- ========== knowledge_quality_aggregate ==========
CREATE TABLE public.knowledge_quality_aggregate (
    document_id uuid NOT NULL,
    helpful_count integer DEFAULT 0,
    not_helpful_count integer DEFAULT 0,
    feedback_count integer DEFAULT 0,
    retrieval_count integer DEFAULT 0,
    last_retrieved_at timestamp with time zone,
    helpful_ratio numeric(3,2),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_quality_aggregate knowledge_quality_aggregate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_quality_aggregate
    ADD CONSTRAINT knowledge_quality_aggregate_pkey PRIMARY KEY (document_id);


--
-- Name: knowledge_quality_aggregate knowledge_quality_aggregate_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_quality_aggregate
    ADD CONSTRAINT knowledge_quality_aggregate_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_document(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict sq6bUOEToWQKpIN5Iy7wyaaTZkPGbtPAE0Sgt1NEaVqGB5QT7QbAQSl47eUnYCj


