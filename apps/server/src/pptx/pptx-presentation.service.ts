import PptxGenJS from "pptxgenjs";
import { marked, type Token, type Tokens } from "marked";
import type { ConsultationRecord } from "../shared/types.js";

interface PptxSlide {
  background: { color: string };
  addText(text: string, options?: Record<string, unknown>): unknown;
  addShape(shape: string, options?: Record<string, unknown>): unknown;
  addNotes(notes: string): unknown;
}

interface PptxPresentation {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, string>;
  addSlide(): PptxSlide;
  write(options: Record<string, unknown>): Promise<string | ArrayBuffer | Blob | Uint8Array>;
}

type PptxConstructor = new () => PptxPresentation;
const PptxCtor = (
  typeof PptxGenJS === "function"
    ? PptxGenJS
    : (PptxGenJS as unknown as { default: PptxConstructor }).default
) as unknown as PptxConstructor;

const theme = {
  primary: "1C2B25",
  secondary: "64716B",
  accent: "C8603D",
  light: "E7EEE9",
  bg: "F7F8F6"
} as const;

const FONT = "Microsoft YaHei";
const SLIDE_W = 10;
const SLIDE_H = 5.625;

export interface PptxBranding {
  companyName: string;
  clientName: string;
  projectName: string;
  presentationTitle: string;
  version: string;
  presenter: string;
  confidentiality: string;
  includeReferences: boolean;
}

interface ContentSection {
  title: string;
  paragraphs: string[];
  bullets: string[];
}

function cleanText(value: string, maxLength = 180) {
  const text = value
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function inlineText(tokens: Token[] | undefined): string {
  if (!tokens?.length) return "";
  return tokens
    .map((token) => {
      if ("tokens" in token && Array.isArray(token.tokens)) return inlineText(token.tokens);
      return "text" in token ? String(token.text) : "";
    })
    .join("");
}

function extractSections(markdown: string): ContentSection[] {
  const sections: ContentSection[] = [];
  let current: ContentSection = { title: "核心内容", paragraphs: [], bullets: [] };
  const commit = () => {
    if (current.paragraphs.length || current.bullets.length) sections.push(current);
  };

  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      commit();
      current = {
        title: cleanText(inlineText(token.tokens) || token.text, 32),
        paragraphs: [],
        bullets: []
      };
      continue;
    }
    if (token.type === "paragraph") {
      const value = cleanText(inlineText(token.tokens) || token.text, 260);
      if (value) current.paragraphs.push(value);
      continue;
    }
    if (token.type === "list") {
      (token as Tokens.List).items.forEach((item) => {
        const value = cleanText(item.text, 100);
        if (value) current.bullets.push(value);
      });
      continue;
    }
    if (token.type === "blockquote") {
      const value = cleanText(token.text, 220);
      if (value) current.paragraphs.push(value);
    }
  }
  commit();
  return sections;
}

function sectionBy(sections: ContentSection[], pattern: RegExp) {
  return sections.find((section) => pattern.test(section.title));
}

function sectionItems(section: ContentSection | undefined, fallback: string[], limit = 4) {
  if (!section) return fallback.slice(0, limit);
  const items = [...section.bullets, ...section.paragraphs]
    .flatMap((value) => value.split(/[。；]/))
    .map((value) => cleanText(value, 72))
    .filter((value) => value.length > 3);
  return (items.length ? items : fallback).slice(0, limit);
}

function addPageChrome(
  slide: PptxSlide,
  branding: PptxBranding,
  page: number,
  section: string
) {
  slide.addText(branding.companyName, {
    x: 0.48,
    y: 5.18,
    w: 3.8,
    h: 0.16,
    fontFace: FONT,
    fontSize: 7.5,
    color: theme.secondary,
    margin: 0
  });
  slide.addText(`${branding.confidentiality} · ${branding.version} · ${section}`, {
    x: 4.7,
    y: 5.18,
    w: 4.25,
    h: 0.16,
    fontFace: FONT,
    fontSize: 7.5,
    color: theme.secondary,
    align: "right",
    margin: 0
  });
  slide.addShape("ellipse", {
    x: 9.28,
    y: 5.04,
    w: 0.38,
    h: 0.38,
    fill: { color: theme.accent },
    line: { color: theme.accent }
  });
  slide.addText(String(page).padStart(2, "0"), {
    x: 9.28,
    y: 5.12,
    w: 0.38,
    h: 0.12,
    fontFace: FONT,
    fontSize: 7.5,
    bold: true,
    color: theme.bg,
    align: "center",
    margin: 0
  });
}

function addSlideTitle(
  slide: PptxSlide,
  title: string,
  kicker: string,
  branding: PptxBranding,
  page: number
) {
  slide.background = { color: theme.bg };
  slide.addText(kicker.toUpperCase(), {
    x: 0.55,
    y: 0.3,
    w: 3.5,
    h: 0.18,
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: theme.accent,
    charSpacing: 1.2,
    margin: 0
  });
  slide.addText(title, {
    x: 0.55,
    y: 0.58,
    w: 8.75,
    h: 0.48,
    fontFace: FONT,
    fontSize: 24,
    bold: true,
    color: theme.primary,
    fit: "shrink",
    margin: 0
  });
  addPageChrome(slide, branding, page, kicker);
}

function addBulletList(
  slide: PptxSlide,
  items: string[],
  position: { x: number; y: number; w: number; h: number },
  options: { fontSize?: number; accent?: boolean } = {}
) {
  const rowHeight = position.h / Math.max(items.length, 1);
  items.forEach((item, index) => {
    const y = position.y + index * rowHeight;
    slide.addShape("ellipse", {
      x: position.x,
      y: y + 0.12,
      w: 0.13,
      h: 0.13,
      fill: { color: options.accent ? theme.accent : theme.primary },
      line: { color: options.accent ? theme.accent : theme.primary }
    });
    slide.addText(item, {
      x: position.x + 0.25,
      y,
      w: position.w - 0.25,
      h: Math.max(rowHeight - 0.04, 0.35),
      fontFace: FONT,
      fontSize: options.fontSize ?? 14,
      color: theme.primary,
      breakLine: false,
      fit: "shrink",
      valign: "mid",
      margin: 0.03,
      paraSpaceAfterPt: 3
    });
  });
}

function addCover(
  pptx: PptxPresentation,
  record: ConsultationRecord,
  branding: PptxBranding
) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.primary };
  slide.addShape("rect", {
    x: 6.8,
    y: 0,
    w: 3.2,
    h: SLIDE_H,
    fill: { color: theme.light },
    line: { color: theme.light }
  });
  [0, 1, 2, 3].forEach((index) => {
    slide.addShape("roundRect", {
      x: 7.35 + (index % 2) * 1.12,
      y: 0.75 + Math.floor(index / 2) * 1.45,
      w: 0.86,
      h: 0.86,
      rectRadius: 0.08,
      fill: { color: index === 1 ? theme.accent : theme.primary },
      line: { color: index === 1 ? theme.accent : theme.primary }
    });
    slide.addText(["诊断", "咨询", "方案", "实施"][index], {
      x: 7.35 + (index % 2) * 1.12,
      y: 1.08 + Math.floor(index / 2) * 1.45,
      w: 0.86,
      h: 0.18,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: index === 1 ? theme.bg : theme.light,
      align: "center",
      margin: 0
    });
  });
  slide.addShape("chevron", {
    x: 7.18,
    y: 4.15,
    w: 2.1,
    h: 0.62,
    fill: { color: theme.accent },
    line: { color: theme.accent }
  });
  slide.addText("AI数字化认证中心", {
    x: 0.62,
    y: 0.52,
    w: 4.8,
    h: 0.25,
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: theme.light,
    charSpacing: 1.1,
    margin: 0
  });
  slide.addText(branding.presentationTitle, {
    x: 0.62,
    y: 1.35,
    w: 5.65,
    h: 1.35,
    fontFace: FONT,
    fontSize: 34,
    bold: true,
    color: theme.bg,
    fit: "shrink",
    breakLine: false,
    margin: 0
  });
  slide.addText(branding.projectName, {
    x: 0.62,
    y: 2.95,
    w: 5.6,
    h: 0.42,
    fontFace: FONT,
    fontSize: 16,
    color: theme.light,
    fit: "shrink",
    margin: 0
  });
  slide.addText(
    `${branding.clientName}\n${branding.presenter} · ${formatDate(record.createdAt)} · ${branding.version}`,
    {
      x: 0.62,
      y: 4.35,
      w: 5.5,
      h: 0.58,
      fontFace: FONT,
      fontSize: 10,
      color: theme.light,
      breakLine: false,
      margin: 0,
      valign: "bottom"
    }
  );
  slide.addText(branding.confidentiality, {
    x: 7.25,
    y: 5.05,
    w: 2.1,
    h: 0.17,
    fontFace: FONT,
    fontSize: 8,
    color: theme.secondary,
    align: "center",
    margin: 0
  });
  slide.addNotes(`咨询需求：${record.request}\n企业现状：${record.companyContext}`);
}

function addAgenda(pptx: PptxPresentation, branding: PptxBranding) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "汇报内容", "Overview", branding, 2);
  const items = [
    ["01", "项目判断", "明确问题、价值与建设边界"],
    ["02", "总体方案", "形成架构、能力与应用设计"],
    ["03", "实施路径", "分阶段试点并量化验收"],
    ["04", "保障机制", "控制风险并建立持续运营"]
  ];
  items.forEach(([number, title, description], index) => {
    const x = 0.65 + (index % 2) * 4.55;
    const y = 1.42 + Math.floor(index / 2) * 1.55;
    slide.addShape("roundRect", {
      x,
      y,
      w: 4.05,
      h: 1.12,
      rectRadius: 0.08,
      fill: { color: index === 0 ? theme.primary : theme.light },
      line: { color: index === 0 ? theme.primary : theme.light }
    });
    slide.addText(number, {
      x: x + 0.22,
      y: y + 0.18,
      w: 0.55,
      h: 0.26,
      fontFace: FONT,
      fontSize: 17,
      bold: true,
      color: index === 0 ? theme.accent : theme.primary,
      margin: 0
    });
    slide.addText(title, {
      x: x + 0.9,
      y: y + 0.16,
      w: 2.75,
      h: 0.3,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: index === 0 ? theme.bg : theme.primary,
      margin: 0
    });
    slide.addText(description, {
      x: x + 0.9,
      y: y + 0.56,
      w: 2.75,
      h: 0.25,
      fontFace: FONT,
      fontSize: 9.5,
      color: index === 0 ? theme.light : theme.secondary,
      fit: "shrink",
      margin: 0
    });
  });
}

function addCoreConclusion(
  pptx: PptxPresentation,
  branding: PptxBranding,
  items: string[],
  record: ConsultationRecord
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "核心判断与建设主张", "Executive Summary", branding, 3);
  slide.addShape("roundRect", {
    x: 0.58,
    y: 1.34,
    w: 6.05,
    h: 3.38,
    rectRadius: 0.08,
    fill: { color: theme.light },
    line: { color: theme.light }
  });
  addBulletList(slide, items, { x: 0.93, y: 1.66, w: 5.35, h: 2.68 }, { fontSize: 15 });
  slide.addShape("hexagon", {
    x: 7.18,
    y: 1.52,
    w: 1.7,
    h: 1.48,
    fill: { color: theme.accent },
    line: { color: theme.accent }
  });
  slide.addText("MVP", {
    x: 7.36,
    y: 2.02,
    w: 1.34,
    h: 0.32,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: theme.bg,
    align: "center",
    margin: 0
  });
  slide.addText("以一个可验证的业务闭环\n建立可复制的建设方法", {
    x: 6.82,
    y: 3.32,
    w: 2.48,
    h: 0.72,
    fontFace: FONT,
    fontSize: 13,
    color: theme.primary,
    align: "center",
    breakLine: false,
    fit: "shrink",
    margin: 0
  });
  slide.addNotes(record.result);
}

function addSituation(
  pptx: PptxPresentation,
  branding: PptxBranding,
  record: ConsultationRecord
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "现状诊断：从需求描述中识别四类约束", "Current State", branding, 4);
  const cards = [
    ["业务问题", cleanText(record.request, 82)],
    ["现有基础", cleanText(record.companyContext || "需要进一步调研现有系统、数据和组织基础。", 82)],
    ["知识条件", "资料分散、口径不一，需建立分类、版本和来源追溯机制。"],
    ["实施约束", "需要在价值、周期、成本、安全和人工复核之间取得平衡。"]
  ];
  cards.forEach(([title, content], index) => {
    const x = 0.62 + (index % 2) * 4.55;
    const y = 1.38 + Math.floor(index / 2) * 1.62;
    slide.addShape("roundRect", {
      x,
      y,
      w: 4.08,
      h: 1.24,
      rectRadius: 0.08,
      fill: { color: index === 0 ? theme.primary : theme.light },
      line: { color: index === 0 ? theme.primary : theme.light }
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.2,
      y: y + 0.18,
      w: 0.42,
      h: 0.18,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: theme.accent,
      margin: 0
    });
    slide.addText(title, {
      x: x + 0.72,
      y: y + 0.16,
      w: 2.9,
      h: 0.28,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: index === 0 ? theme.bg : theme.primary,
      margin: 0
    });
    slide.addText(content, {
      x: x + 0.72,
      y: y + 0.55,
      w: 2.95,
      h: 0.43,
      fontFace: FONT,
      fontSize: 10,
      color: index === 0 ? theme.light : theme.secondary,
      fit: "shrink",
      breakLine: false,
      margin: 0
    });
  });
}

function addObjectives(
  pptx: PptxPresentation,
  branding: PptxBranding,
  items: string[]
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "建设目标：形成业务、能力与运营三重成果", "Objectives", branding, 5);
  const goals = [
    ["业务价值", items[0] ?? "围绕高价值问题形成可量化的效率与质量提升。"],
    ["平台能力", items[1] ?? "打通知识、模型、工作流和业务系统的能力链路。"],
    ["持续运营", items[2] ?? "建立知识更新、模型评估、权限审计和复盘机制。"]
  ];
  goals.forEach(([title, content], index) => {
    const x = 0.64 + index * 3.05;
    slide.addShape("ellipse", {
      x: x + 0.82,
      y: 1.36,
      w: 1.15,
      h: 1.15,
      fill: { color: index === 1 ? theme.accent : theme.primary },
      line: { color: index === 1 ? theme.accent : theme.primary }
    });
    slide.addText(["01", "02", "03"][index], {
      x: x + 1.1,
      y: 1.75,
      w: 0.58,
      h: 0.22,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: theme.bg,
      align: "center",
      margin: 0
    });
    slide.addText(title, {
      x,
      y: 2.74,
      w: 2.8,
      h: 0.34,
      fontFace: FONT,
      fontSize: 17,
      bold: true,
      color: theme.primary,
      align: "center",
      margin: 0
    });
    slide.addText(content, {
      x: x + 0.2,
      y: 3.25,
      w: 2.4,
      h: 0.72,
      fontFace: FONT,
      fontSize: 10.5,
      color: theme.secondary,
      align: "center",
      fit: "shrink",
      breakLine: false,
      margin: 0
    });
  });
  slide.addText("业务价值优先  ·  数据可追溯  ·  小步试点  ·  安全合规", {
    x: 1.2,
    y: 4.45,
    w: 7.6,
    h: 0.32,
    fontFace: FONT,
    fontSize: 11,
    bold: true,
    color: theme.accent,
    align: "center",
    margin: 0
  });
}

function addArchitecture(pptx: PptxPresentation, branding: PptxBranding) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "总体架构：五层能力协同支撑业务闭环", "Architecture", branding, 6);
  const layers = [
    ["业务应用层", "数字化咨询 · AI 应用 · 数字孪生 · 培训与知识服务"],
    ["工作流与智能体层", "咨询顾问 · 方案工程师 · 培训讲师 · 知识助手"],
    ["模型与知识层", "模型路由 · RAG 检索 · 提示模板 · 内容安全"],
    ["数据与集成层", "文档解析 · API 集成 · 数据治理 · 权限审计"],
    ["基础设施层", "云服务器 · AI 工作站 · 网络通信 · 运维监控"]
  ];
  layers.forEach(([title, content], index) => {
    const y = 1.23 + index * 0.68;
    slide.addShape("roundRect", {
      x: 0.82 + index * 0.18,
      y,
      w: 8.35 - index * 0.36,
      h: 0.52,
      rectRadius: 0.05,
      fill: { color: index === 0 ? theme.primary : index === 2 ? theme.accent : theme.light },
      line: { color: index === 0 ? theme.primary : index === 2 ? theme.accent : theme.light }
    });
    slide.addText(title, {
      x: 1.05 + index * 0.18,
      y: y + 0.15,
      w: 1.55,
      h: 0.18,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: index === 0 || index === 2 ? theme.bg : theme.primary,
      margin: 0
    });
    slide.addText(content, {
      x: 2.75 + index * 0.12,
      y: y + 0.15,
      w: 5.75 - index * 0.28,
      h: 0.18,
      fontFace: FONT,
      fontSize: 9,
      color: index === 0 || index === 2 ? theme.bg : theme.secondary,
      fit: "shrink",
      margin: 0
    });
  });
  slide.addText("安全治理与持续运营贯穿所有层级", {
    x: 2.55,
    y: 4.68,
    w: 4.9,
    h: 0.25,
    fontFace: FONT,
    fontSize: 10,
    bold: true,
    color: theme.primary,
    align: "center",
    margin: 0
  });
}

function addWorkstreams(
  pptx: PptxPresentation,
  branding: PptxBranding,
  items: string[]
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "重点建设内容：四条工作流并行推进", "Workstreams", branding, 7);
  const titles = ["场景与业务", "知识与数据", "模型与工作流", "治理与运营"];
  const fallback = [
    "完成现状诊断、场景识别和价值排序，明确 MVP 边界。",
    "建立分类体系、解析流程、版本管理和知识质量规则。",
    "接入本地与 API 模型，编排检索、生成和人工复核。",
    "建立权限、安全、评估、反馈和持续优化机制。"
  ];
  titles.forEach((title, index) => {
    const x = 0.45 + index * 2.38;
    slide.addShape("roundRect", {
      x,
      y: 1.35,
      w: 2.05,
      h: 3.15,
      rectRadius: 0.08,
      fill: { color: index === 1 ? theme.primary : theme.light },
      line: { color: index === 1 ? theme.primary : theme.light }
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.18,
      y: 1.58,
      w: 0.45,
      h: 0.22,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: theme.accent,
      margin: 0
    });
    slide.addText(title, {
      x: x + 0.18,
      y: 2.08,
      w: 1.68,
      h: 0.38,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: index === 1 ? theme.bg : theme.primary,
      fit: "shrink",
      margin: 0
    });
    slide.addText(items[index] ?? fallback[index], {
      x: x + 0.18,
      y: 2.8,
      w: 1.68,
      h: 1.05,
      fontFace: FONT,
      fontSize: 10,
      color: index === 1 ? theme.light : theme.secondary,
      breakLine: false,
      fit: "shrink",
      margin: 0
    });
  });
}

function addRoadmap(
  pptx: PptxPresentation,
  branding: PptxBranding,
  items: string[]
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "实施路线：以阶段成果驱动决策与推广", "Roadmap", branding, 8);
  const phases = [
    ["阶段一", "0-4 周", "诊断与设计", items[0] ?? "完成调研、场景清单、数据盘点和 MVP 设计。"],
    ["阶段二", "5-10 周", "试点验证", items[1] ?? "打通知识、模型、工作流和人工复核闭环。"],
    ["阶段三", "11-16 周", "评估推广", items[2] ?? "依据效果评估决定扩展范围和运营机制。"]
  ];
  slide.addShape("line", {
    x: 1.3,
    y: 2.42,
    w: 7.35,
    h: 0,
    line: { color: theme.secondary, width: 2, beginArrowType: "none", endArrowType: "triangle" }
  });
  phases.forEach(([stage, period, title, content], index) => {
    const x = 0.75 + index * 3.02;
    slide.addShape("ellipse", {
      x: x + 0.85,
      y: 2.08,
      w: 0.68,
      h: 0.68,
      fill: { color: index === 1 ? theme.accent : theme.primary },
      line: { color: index === 1 ? theme.accent : theme.primary }
    });
    slide.addText(String(index + 1), {
      x: x + 1.06,
      y: 2.29,
      w: 0.26,
      h: 0.18,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: theme.bg,
      align: "center",
      margin: 0
    });
    slide.addText(`${stage} · ${period}`, {
      x,
      y: 1.42,
      w: 2.38,
      h: 0.25,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: theme.accent,
      align: "center",
      margin: 0
    });
    slide.addText(title, {
      x,
      y: 3.0,
      w: 2.38,
      h: 0.32,
      fontFace: FONT,
      fontSize: 17,
      bold: true,
      color: theme.primary,
      align: "center",
      margin: 0
    });
    slide.addText(content, {
      x: x + 0.1,
      y: 3.52,
      w: 2.18,
      h: 0.7,
      fontFace: FONT,
      fontSize: 9.5,
      color: theme.secondary,
      align: "center",
      fit: "shrink",
      breakLine: false,
      margin: 0
    });
  });
}

function addRisks(
  pptx: PptxPresentation,
  branding: PptxBranding,
  items: string[]
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "风险与保障：把不确定性纳入实施机制", "Governance", branding, 9);
  const risks = items.length
    ? items
    : [
        "知识来源不完整导致结论缺少企业特异性。",
        "数据权限和敏感信息处理不符合安全要求。",
        "模型效果只在演示场景有效，缺少固定测试集。",
        "项目缺少业务负责人和持续运营机制。"
      ];
  const responses = [
    "建立资料责任人、来源标注、版本管理和专家抽检。",
    "实施权限隔离、脱敏、审计和关键环节人工审批。",
    "建立质量、成本、时延和事实准确率的评估基线。",
    "明确业务、技术、数据和安全角色及例行复盘制度。"
  ];
  risks.slice(0, 4).forEach((risk, index) => {
    const y = 1.3 + index * 0.86;
    slide.addShape("roundRect", {
      x: 0.62,
      y,
      w: 3.8,
      h: 0.64,
      rectRadius: 0.04,
      fill: { color: index === 0 ? theme.primary : theme.light },
      line: { color: index === 0 ? theme.primary : theme.light }
    });
    slide.addText(risk, {
      x: 0.87,
      y: y + 0.18,
      w: 3.3,
      h: 0.24,
      fontFace: FONT,
      fontSize: 10.5,
      color: index === 0 ? theme.bg : theme.primary,
      fit: "shrink",
      margin: 0
    });
    slide.addShape("chevron", {
      x: 4.58,
      y: y + 0.15,
      w: 0.52,
      h: 0.34,
      fill: { color: theme.accent },
      line: { color: theme.accent }
    });
    slide.addShape("roundRect", {
      x: 5.28,
      y,
      w: 4.08,
      h: 0.64,
      rectRadius: 0.04,
      fill: { color: theme.bg },
      line: { color: theme.secondary, transparency: 58 }
    });
    slide.addText(responses[index], {
      x: 5.53,
      y: y + 0.18,
      w: 3.56,
      h: 0.24,
      fontFace: FONT,
      fontSize: 10.5,
      color: theme.secondary,
      fit: "shrink",
      margin: 0
    });
  });
  slide.addText("主要风险", {
    x: 1.7,
    y: 4.86,
    w: 1.5,
    h: 0.18,
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: theme.primary,
    align: "center",
    margin: 0
  });
  slide.addText("保障措施", {
    x: 6.6,
    y: 4.86,
    w: 1.5,
    h: 0.18,
    fontFace: FONT,
    fontSize: 9,
    bold: true,
    color: theme.primary,
    align: "center",
    margin: 0
  });
}

function addMetricsAndNext(
  pptx: PptxPresentation,
  branding: PptxBranding,
  metrics: string[],
  record: ConsultationRecord
) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "验收指标与下一步行动", "Success Metrics", branding, 10);
  const fallback = [
    "关键问题回答可追溯率 ≥ 90%",
    "试点流程处理时间缩短 ≥ 30%",
    "专家抽检通过率 ≥ 85%",
    "重大事实错误数量 = 0"
  ];
  const values = metrics.length ? metrics : fallback;
  values.slice(0, 4).forEach((value, index) => {
    const x = 0.58 + index * 2.32;
    slide.addShape("roundRect", {
      x,
      y: 1.28,
      w: 2.05,
      h: 1.35,
      rectRadius: 0.08,
      fill: { color: index === 2 ? theme.accent : theme.light },
      line: { color: index === 2 ? theme.accent : theme.light }
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.18,
      y: 1.5,
      w: 0.4,
      h: 0.18,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: index === 2 ? theme.bg : theme.accent,
      margin: 0
    });
    slide.addText(value, {
      x: x + 0.18,
      y: 1.85,
      w: 1.69,
      h: 0.52,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: index === 2 ? theme.bg : theme.primary,
      align: "center",
      valign: "mid",
      fit: "shrink",
      margin: 0
    });
  });
  slide.addShape("roundRect", {
    x: 0.58,
    y: 3.02,
    w: 8.92,
    h: 1.42,
    rectRadius: 0.08,
    fill: { color: theme.primary },
    line: { color: theme.primary }
  });
  slide.addText("下一步行动", {
    x: 0.9,
    y: 3.36,
    w: 1.25,
    h: 0.25,
    fontFace: FONT,
    fontSize: 15,
    bold: true,
    color: theme.bg,
    margin: 0
  });
  slide.addText("01  明确试点业务与负责人", {
    x: 2.45,
    y: 3.36,
    w: 1.9,
    h: 0.25,
    fontFace: FONT,
    fontSize: 10.5,
    color: theme.light,
    margin: 0
  });
  slide.addText("02  补充企业资料与数据样本", {
    x: 4.45,
    y: 3.36,
    w: 2.05,
    h: 0.25,
    fontFace: FONT,
    fontSize: 10.5,
    color: theme.light,
    margin: 0
  });
  slide.addText("03  召开 MVP 方案评审会", {
    x: 6.75,
    y: 3.36,
    w: 1.95,
    h: 0.25,
    fontFace: FONT,
    fontSize: 10.5,
    color: theme.light,
    margin: 0
  });
  if (branding.includeReferences) {
    const referenceText = record.references.length
      ? `知识依据：${record.references.map((item) => item.title).join("、")}`
      : "知识依据：当前未检索到直接匹配资料，关键结论需在项目调研中复核。";
    slide.addText(cleanText(referenceText, 160), {
      x: 0.65,
      y: 4.68,
      w: 8.45,
      h: 0.2,
      fontFace: FONT,
      fontSize: 7.5,
      color: theme.secondary,
      fit: "shrink",
      margin: 0
    });
  }
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export async function generateConsultationPptx(
  record: ConsultationRecord,
  branding: PptxBranding
) {
  const sections = extractSections(record.result);
  const core = sectionItems(sectionBy(sections, /核心|判断|摘要/), [
    "从可验证的业务问题出发，不以平台功能堆叠作为建设目标。",
    "同步建设知识、模型、工作流、安全治理和评估机制。",
    "优先选择价值明确、数据可得、流程稳定的 MVP 场景。"
  ], 4);
  const suggestions = sectionItems(sectionBy(sections, /建议|方案|建设/), [], 4);
  const roadmap = sectionItems(sectionBy(sections, /阶段|路线|行动|实施/), [], 3);
  const risks = sectionItems(sectionBy(sections, /风险|约束/), [], 4);
  const metrics = sectionItems(sectionBy(sections, /验收|指标|成效/), [], 4);

  const pptx = new PptxCtor();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = branding.presenter;
  pptx.company = branding.companyName;
  pptx.subject = branding.projectName;
  pptx.title = branding.presentationTitle;
  pptx.lang = "zh-CN";
  pptx.theme = {
    headFontFace: FONT,
    bodyFontFace: FONT,
    lang: "zh-CN"
  };

  addCover(pptx, record, branding);
  addAgenda(pptx, branding);
  addCoreConclusion(pptx, branding, core, record);
  addSituation(pptx, branding, record);
  addObjectives(pptx, branding, suggestions);
  addArchitecture(pptx, branding);
  addWorkstreams(pptx, branding, suggestions);
  addRoadmap(pptx, branding, roadmap);
  addRisks(pptx, branding, risks);
  addMetricsAndNext(pptx, branding, metrics, record);

  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
}

export function presentationTemplateRecord(): ConsultationRecord {
  return {
    id: "digital-transformation-presentation-template",
    role: "trainer",
    industry: "所属行业",
    companyContext:
      "请在此处替换为客户企业现状、已有系统、数据基础、组织能力和主要约束。",
    request:
      "请在此处替换为本项目需要解决的核心问题、建设范围和期望业务成果。",
    deliverable: "数字化建设方案演示",
    model: "demo",
    createdAt: "2026-07-28T00:00:00.000Z",
    references: [
      { id: "reference-1", title: "请替换为知识、政策或案例依据", category: "知识分类" }
    ],
    result: `# 核心判断

- 从业务价值出发明确数字化建设边界
- 以可验证的 MVP 场景降低项目风险
- 同步建设知识、模型、工作流与治理能力

# 建设建议

1. 完成业务诊断与高价值场景排序
2. 建立企业知识分类和数据治理机制
3. 建设模型服务、RAG 检索与工作流编排
4. 建立权限、安全、评估和持续运营机制

# 分阶段行动

1. 诊断设计：完成调研、场景清单和 MVP 方案
2. 试点验证：打通知识、模型、工作流和人工复核
3. 评估推广：量化业务价值并确定推广范围

# 风险与约束

- 企业知识与数据样本不完整
- 敏感数据缺少分级、脱敏和审计机制
- 模型效果缺少固定测试集与专家抽检
- 项目缺少业务负责人和持续运营机制

# 验收指标

- 关键问题回答可追溯率不低于 90%
- 试点流程处理时间缩短 30% 以上
- 专家抽检通过率不低于 85%
- 重大事实错误数量为 0`
  };
}

export function presentationTemplateBranding(): PptxBranding {
  return {
    companyName: "编制单位名称",
    clientName: "客户单位名称",
    projectName: "数字化建设项目名称",
    presentationTitle: "企业数字化建设方案",
    version: "V1.0",
    presenter: "编制人员 / 汇报人",
    confidentiality: "内部资料",
    includeReferences: true
  };
}
