import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type FileChild
} from "docx";
import { marked, type Token, type Tokens } from "marked";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { ConsultationRecord } from "../shared/types.js";
import type { QuoteResult } from "../certification/quote.service.js";

const COLORS = {
  primary: "245B48",
  primaryLight: "E9F1ED",
  accent: "C8603D",
  ink: "24312C",
  muted: "66736D",
  line: "D9E1DD",
  surface: "F4F7F5",
  white: "FFFFFF"
} as const;

const FONTS = {
  heading: "Microsoft YaHei",
  body: "SimSun",
  latin: "Aptos"
} as const;

export interface DocxBranding {
  companyName: string;
  clientName: string;
  projectName: string;
  documentTitle: string;
  version: string;
  preparedBy: string;
  confidentiality: string;
  includeToc: boolean;
  includeReferences: boolean;
  /** 认证机构办公地址 */
  agencyAddress?: string;
  /** 认证机构联系人电话 */
  agencyContact?: string;
  /** 发票税率（如 6%）*/
  taxRate?: string;
  /** 发票类型 */
  invoiceType?: string;
  /** 付款方式 */
  paymentTerms?: string;
  /** 出证周期 */
  certificatePeriod?: string;
}

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

function textRun(text: string, style: InlineStyle = {}) {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? "Consolas" : FONTS.body,
    size: style.code ? 19 : 21,
    color: style.code ? "9B3F29" : COLORS.ink,
    shading: style.code ? { type: ShadingType.CLEAR, fill: "F4EEEB" } : undefined
  });
}

function inlineRuns(tokens: Token[] | undefined, inherited: InlineStyle = {}): TextRun[] {
  if (!tokens?.length) return [];
  return tokens.flatMap((token) => {
    if (token.type === "strong") {
      return inlineRuns(token.tokens, { ...inherited, bold: true });
    }
    if (token.type === "em") {
      return inlineRuns(token.tokens, { ...inherited, italics: true });
    }
    if (token.type === "del") {
      return inlineRuns(token.tokens, { ...inherited, strike: true });
    }
    if (token.type === "codespan") {
      return [textRun(token.text, { ...inherited, code: true })];
    }
    if (token.type === "br") {
      return [new TextRun({ break: 1 })];
    }
    if (token.type === "link") {
      return inlineRuns(token.tokens, inherited);
    }
    if (token.type === "text") {
      return token.tokens?.length
        ? inlineRuns(token.tokens, inherited)
        : [textRun(token.text, inherited)];
    }
    const value = "text" in token ? String(token.text) : "";
    return value ? [textRun(value, inherited)] : [];
  });
}

function border(color: string = COLORS.line, size = 4) {
  return { style: BorderStyle.SINGLE, color, size };
}

function tableCell(
  content: string | TextRun[],
  options: { heading?: boolean; fill?: string; width?: number } = {}
) {
  const runs =
    typeof content === "string"
      ? [
          options.heading
            ? new TextRun({
                text: content,
                bold: true,
                color: options.fill === COLORS.primary ? COLORS.white : COLORS.ink,
                font: FONTS.heading,
                size: 20
              })
            : textRun(content)
        ]
      : content;
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill
      ? { type: ShadingType.CLEAR, fill: options.fill, color: "auto" }
      : undefined,
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
    children: [
      new Paragraph({
        children: runs,
        spacing: { after: 0, line: 300 },
        alignment: AlignmentType.LEFT
      })
    ]
  });
}

function metadataTable(record: ConsultationRecord, branding: DocxBranding) {
  const rows = [
    ["项目名称", branding.projectName, "文档版本", branding.version],
    ["客户单位", branding.clientName, "编制单位", branding.companyName],
    ["咨询角色", roleName(record.role), "编制人员", branding.preparedBy],
    ["所属行业", record.industry, "编制日期", formatDate(record.createdAt)]
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1500, 3000, 1500, 3000],
    borders: {
      top: border(),
      bottom: border(),
      left: border(),
      right: border(),
      insideHorizontal: border(),
      insideVertical: border()
    },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: [
            tableCell(String(row[0] ?? ""), { heading: true, fill: COLORS.primaryLight, width: 1500 }),
            tableCell(String(row[1] ?? ""), { width: 3000 }),
            tableCell(String(row[2] ?? ""), { heading: true, fill: COLORS.primaryLight, width: 1500 }),
            tableCell(String(row[3] ?? ""), { width: 3000 })
          ]
        })
    )
  });
}

function roleName(role: ConsultationRecord["role"]) {
  return {
    consultant: "数字化咨询顾问",
    "solution-engineer": "方案工程师",
    trainer: "培训讲师",
    "knowledge-assistant": "知识助手",
    "certification-expert": "认证专家",
    "certification-auditor": "数字审核员"
  }[role];
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function markdownTable(token: Tokens.Table) {
  const makeCell = (cell: Tokens.TableCell, heading: boolean) =>
    tableCell(heading ? cell.text : inlineRuns(cell.tokens), {
      heading,
      fill: heading ? COLORS.primary : undefined
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border(),
      bottom: border(),
      left: border(),
      right: border(),
      insideHorizontal: border(),
      insideVertical: border()
    },
    rows: [
      new TableRow({ tableHeader: true, children: token.header.map((cell) => makeCell(cell, true)) }),
      ...token.rows.map(
        (row, index) =>
          new TableRow({
            children: row.map((cell) =>
              tableCell(inlineRuns(cell.tokens), {
                fill: index % 2 === 1 ? COLORS.surface : undefined
              })
            )
          })
      )
    ]
  });
}

function markdownBlocks(markdown: string): FileChild[] {
  const tokens = marked.lexer(markdown);
  const blocks: FileChild[] = [];

  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "heading") {
      const heading =
        token.depth === 1
          ? HeadingLevel.HEADING_1
          : token.depth === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      blocks.push(
        new Paragraph({
          heading,
          children: inlineRuns(token.tokens),
          keepNext: true
        })
      );
      continue;
    }
    if (token.type === "paragraph") {
      blocks.push(
        new Paragraph({
          style: "BodyText",
          children: inlineRuns(token.tokens)
        })
      );
      continue;
    }
    if (token.type === "list") {
      const list = token as Tokens.List;
      list.items.forEach((item: Tokens.ListItem) => {
        blocks.push(
          new Paragraph({
            style: "ListText",
            children: [textRun(item.text.replace(/\n+/g, " "))],
            ...(list.ordered
              ? { numbering: { reference: "report-numbering", level: 0 } }
              : { bullet: { level: 0 } })
          })
        );
      });
      continue;
    }
    if (token.type === "blockquote") {
      blocks.push(
        new Paragraph({
          style: "Quote",
          children: [textRun(token.text.trim(), { italics: true })]
        })
      );
      continue;
    }
    if (token.type === "table") {
      blocks.push(markdownTable(token as Tokens.Table));
      blocks.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }
    if (token.type === "code") {
      blocks.push(
        new Paragraph({
          style: "CodeBlock",
          children: [textRun(token.text, { code: true })]
        })
      );
      continue;
    }
    if (token.type === "hr") {
      blocks.push(
        new Paragraph({
          border: { bottom: border(COLORS.line, 6) },
          spacing: { before: 80, after: 160 }
        })
      );
      continue;
    }
    const fallback = "text" in token ? String(token.text).trim() : "";
    if (fallback) blocks.push(new Paragraph({ style: "BodyText", children: [textRun(fallback)] }));
  }
  return blocks;
}

function cover(record: ConsultationRecord, branding: DocxBranding): FileChild[] {
  return [
    new Paragraph({
      spacing: { before: 1200, after: 260 },
      children: [
        new TextRun({
          text: "AI数字化咨询中心",
          font: FONTS.heading,
          size: 24,
          bold: true,
          color: COLORS.primary
        })
      ]
    }),
    new Paragraph({
      spacing: { before: 280, after: 200 },
      children: [
        new TextRun({
          text: branding.documentTitle,
          font: FONTS.heading,
          size: 48,
          bold: true,
          color: COLORS.ink
        })
      ]
    }),
    new Paragraph({
      spacing: { after: 760 },
      border: { bottom: border(COLORS.accent, 18) },
      children: [
        new TextRun({
          text: branding.projectName,
          font: FONTS.heading,
          size: 24,
          color: COLORS.muted
        })
      ]
    }),
    new Table({
      width: { size: 72, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: border(COLORS.line),
        insideVertical: { style: BorderStyle.NONE }
      },
      rows: [
        ["客户单位", branding.clientName],
        ["编制单位", branding.companyName],
        ["编制人员", branding.preparedBy],
        ["文档版本", branding.version],
        ["编制日期", formatDate(record.createdAt)]
      ].map(
        ([label, value]) =>
          new TableRow({
            children: [
              tableCell(label, { heading: true, width: 1800 }),
              tableCell(value, { width: 4700 })
            ]
          })
      )
    }),
    new Paragraph({
      spacing: { before: 1050 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: branding.confidentiality,
          font: FONTS.heading,
          size: 18,
          color: COLORS.muted
        })
      ]
    }),
    new Paragraph({ children: [new PageBreak()] })
  ];
}

function references(record: ConsultationRecord): FileChild[] {
  if (!record.references.length) {
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun("知识依据")] }),
      new Paragraph({
        style: "BodyText",
        children: [textRun("本次报告未检索到直接匹配的知识条目，关键结论需结合企业调研进一步核实。")]
      })
    ];
  }
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun("知识依据")] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: border(),
        bottom: border(),
        left: border(),
        right: border(),
        insideHorizontal: border(),
        insideVertical: border()
      },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            tableCell("序号", { heading: true, fill: COLORS.primary }),
            tableCell("知识标题", { heading: true, fill: COLORS.primary }),
            tableCell("分类", { heading: true, fill: COLORS.primary })
          ]
        }),
        ...record.references.map(
          (item, index) =>
            new TableRow({
              children: [
                tableCell(String(index + 1)),
                tableCell(item.title),
                tableCell(item.category)
              ]
            })
        )
      ]
    })
  ];
}

function header(branding: DocxBranding) {
  return new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: border(COLORS.primary, 8),
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE }
        },
        rows: [
          new TableRow({
            children: [
              tableCell(
                [new TextRun({ text: branding.companyName, bold: true, color: COLORS.primary, size: 18 })],
                { width: 4500 }
              ),
              tableCell(
                [new TextRun({ text: branding.documentTitle, color: COLORS.muted, size: 17 })],
                { width: 4500 }
              )
            ]
          })
        ]
      })
    ]
  });
}

function footer(branding: DocxBranding) {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: border(COLORS.line, 5) },
        spacing: { before: 100 },
        children: [
          new TextRun({
            text: `${branding.confidentiality}  |  ${branding.version}  |  第 `,
            color: COLORS.muted,
            size: 17
          }),
          new TextRun({ children: [PageNumber.CURRENT], color: COLORS.muted, size: 17 }),
          new TextRun({ text: " 页", color: COLORS.muted, size: 17 })
        ]
      })
    ]
  });
}

function documentStyles() {
  return {
    default: {
      document: {
        run: { font: FONTS.body, size: 21, color: COLORS.ink },
        paragraph: { spacing: { line: 330, after: 140 } }
      }
    },
    paragraphStyles: [
      {
        id: "Title",
        name: "Title",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: FONTS.heading, size: 48, bold: true, color: COLORS.ink },
        paragraph: { spacing: { before: 260, after: 220 }, keepNext: true }
      },
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { font: FONTS.heading, size: 32, bold: true, color: COLORS.primary },
        paragraph: {
          outlineLevel: 0,
          spacing: { before: 360, after: 180 },
          border: { bottom: border(COLORS.primaryLight, 8) },
          keepNext: true
        }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { font: FONTS.heading, size: 27, bold: true, color: COLORS.ink },
        paragraph: { outlineLevel: 1, spacing: { before: 280, after: 140 }, keepNext: true }
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { font: FONTS.heading, size: 23, bold: true, color: COLORS.ink },
        paragraph: { outlineLevel: 2, spacing: { before: 220, after: 100 }, keepNext: true }
      },
      {
        id: "BodyText",
        name: "正文",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { font: FONTS.body, size: 21, color: COLORS.ink },
        paragraph: {
          alignment: AlignmentType.JUSTIFIED,
          spacing: { line: 340, after: 150 },
          indent: { firstLineChars: 200 }
        }
      },
      {
        id: "ListText",
        name: "列表正文",
        basedOn: "BodyText",
        next: "ListText",
        quickFormat: true,
        run: { font: FONTS.body, size: 21, color: COLORS.ink },
        paragraph: { spacing: { line: 320, after: 90 }, indent: { left: 360 } }
      },
      {
        id: "Quote",
        name: "引用",
        basedOn: "BodyText",
        next: "BodyText",
        quickFormat: true,
        run: { font: FONTS.body, size: 20, italics: true, color: COLORS.muted },
        paragraph: {
          spacing: { before: 100, after: 150 },
          indent: { left: 360, right: 220 },
          border: { left: border(COLORS.accent, 14) },
          shading: { type: ShadingType.CLEAR, fill: COLORS.surface }
        }
      },
      {
        id: "CodeBlock",
        name: "代码块",
        basedOn: "Normal",
        next: "BodyText",
        quickFormat: true,
        run: { font: "Consolas", size: 18, color: "713A2D" },
        paragraph: {
          spacing: { before: 100, after: 140, line: 280 },
          indent: { left: 260, right: 260 },
          shading: { type: ShadingType.CLEAR, fill: "F5F1EF" }
        }
      }
    ]
  };
}

export async function generateConsultationDocx(
  record: ConsultationRecord,
  branding: DocxBranding
) {
  const body: FileChild[] = [
    ...cover(record, branding),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun("文档说明")] }),
    metadataTable(record, branding),
    new Paragraph({
      style: "BodyText",
      spacing: { before: 160 },
      children: [
        textRun(
          `本报告由 AI数字化咨询中心基于客户需求、行业知识和咨询工作流生成，适用于项目研讨、内部立项与方案深化。`
        )
      ]
    })
  ];

  if (branding.includeToc) {
    body.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun("目录")] }),
      new TableOfContents("目录", {
        hyperlink: true,
        headingStyleRange: "1-3"
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  } else {
    body.push(new Paragraph({ children: [new PageBreak()] }));
  }

  body.push(...markdownBlocks(record.result));
  if (branding.includeReferences) body.push(...references(record));
  body.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [textRun("使用说明与免责声明")] }),
    new Paragraph({
      style: "BodyText",
      children: [
        textRun(
          "本报告为数字化咨询辅助成果，不替代政策、法律、财务、安全及工程领域的专业审查。涉及投资决策、招投标、生产安全和监管合规的内容，应由具备相应资质的人员复核确认。"
        )
      ]
    })
  );

  const document = new Document({
    creator: branding.preparedBy || branding.companyName,
    title: branding.documentTitle,
    subject: branding.projectName,
    description: "AI数字化咨询中心生成的可编辑企业咨询报告",
    styles: documentStyles(),
    numbering: {
      config: [
        {
          reference: "report-numbering",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 300 } } }
            }
          ]
        }
      ]
    },
    features: { updateFields: true },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
              header: 680,
              footer: 680
            }
          }
        },
        headers: {
          first: new Header({ children: [] }),
          default: header(branding)
        },
        footers: {
          first: new Footer({ children: [] }),
          default: footer(branding)
        },
        children: body
      }
    ]
  });

  return Packer.toBuffer(document);
}

export function enterpriseTemplateRecord(): ConsultationRecord {
  return {
    id: "enterprise-solution-template",
    role: "solution-engineer",
    industry: "[所属行业]",
    companyContext: "[填写企业现状、已有系统、数据基础、组织能力及主要约束]",
    request: "[填写本项目需要解决的核心问题和建设目标]",
    deliverable: "企业数字化建设方案",
    model: "demo",
    createdAt: new Date().toISOString(),
    references: [
      { id: "reference-1", title: "[知识依据或政策名称]", category: "[知识分类]" }
    ],
    result: `# 项目概述

## 建设背景

[说明企业现状、行业趋势、政策环境和启动项目的原因。]

## 建设目标

1. [业务目标一]
2. [管理目标二]
3. [技术目标三]

# 现状诊断

## 业务与管理现状

[描述现有业务流程、组织职责、协同方式和主要问题。]

## 信息化与数据现状

| 诊断维度 | 当前情况 | 主要问题 | 改进方向 |
| --- | --- | --- | --- |
| 业务系统 | [填写] | [填写] | [填写] |
| 数据基础 | [填写] | [填写] | [填写] |
| AI 能力 | [填写] | [填写] | [填写] |
| 组织保障 | [填写] | [填写] | [填写] |

# 总体方案

## 建设原则

- 业务价值优先
- 数据与知识可追溯
- 小步试点、持续迭代
- 安全合规、人工复核

## 总体架构

[描述基础设施层、数据层、AI 能力层、工作流层和应用层之间的关系。]

## 建设内容

### 模块一：[模块名称]

[填写建设范围、主要能力、接口边界和交付成果。]

### 模块二：[模块名称]

[填写建设范围、主要能力、接口边界和交付成果。]

# 实施计划

| 阶段 | 周期 | 主要任务 | 交付成果 | 验收条件 |
| --- | --- | --- | --- | --- |
| 诊断设计 | [填写] | [填写] | [填写] | [填写] |
| MVP 试点 | [填写] | [填写] | [填写] | [填写] |
| 评估推广 | [填写] | [填写] | [填写] | [填写] |

# 投资与资源建议

[填写人员角色、软硬件资源、第三方服务和预算测算口径。]

# 风险与保障

| 风险 | 影响 | 应对措施 | 责任方 |
| --- | --- | --- | --- |
| [风险一] | [填写] | [填写] | [填写] |
| [风险二] | [填写] | [填写] | [填写] |

# 验收指标

1. [业务成效指标]
2. [系统性能指标]
3. [知识与模型质量指标]
4. [安全与合规指标]`
  };
}

export function enterpriseTemplateBranding(): DocxBranding {
  return {
    companyName: "华中国际认证检验集团有限公司",
    clientName: "[客户单位名称]",
    projectName: "管理体系认证报价",
    documentTitle: "管理体系认证报价单",
    version: "V1.0",
    preparedBy: "刘军",
    confidentiality: "内部资料",
    includeToc: false,
    includeReferences: false,
    agencyAddress: "银川国智知识产权服务园201室",
    agencyContact: "13195086656",
    taxRate: "6%",
    invoiceType: "增值税普通发票",
    paymentTerms: "合同签订首付70%，收到证书付清尾款30%",
    certificatePeriod: "30天左右"
  };
}

/**
 * 生成认证报价单 DOCX（精简版）
 */
export async function generateQuoteDocx(
  quote: QuoteResult,
  branding: DocxBranding
): Promise<Buffer> {
  const doc = new Document({
    creator: branding.companyName,
    title: `认证报价单 - ${quote.companyName}`,
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${branding.companyName} · 认证专家`,
                    size: 16,
                    color: COLORS.muted
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "本报价单基于 2026 年实际报价规则生成，最终以正式合同为准",
                    size: 14,
                    color: COLORS.muted
                  })
                ]
              })
            ]
          })
        },
        children: await buildQuoteContentWithImages(quote, branding)
      }
    ]
  });
  return Packer.toBuffer(doc);
}

function buildQuoteContent(quote: QuoteResult, branding: DocxBranding): FileChild[] {
  const blocks: FileChild[] = [];
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  // ========== 首页：机构信息（封面）==========
  // 机构名称（居中，大字号）
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 60 },
      children: [
        new TextRun({
          text: "─传递信任 服务发展─",
          size: 20,
          color: COLORS.muted,
          italics: true
        })
      ]
    })
  );

  // 标题
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: "管理体系认证报价单",
          bold: true,
          size: 40,
          color: COLORS.primary,
          font: FONTS.heading
        })
      ]
    })
  );

  // 机构信息（3 行：机构名称 / 办公地址 / 联系人+电话）
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "机构名称：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: branding.companyName, size: 22, color: COLORS.ink })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "办公地址：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: branding.agencyAddress ?? "银川国智知识产权服务园201室", size: 22, color: COLORS.ink })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "联 系 人：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: branding.preparedBy ?? "刘军", size: 22, color: COLORS.ink }),
        new TextRun({ text: "    电    话：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: branding.agencyContact ?? "13195086656", size: 22, color: COLORS.ink })
      ]
    })
  );

  // 分隔线
  blocks.push(
    new Paragraph({
      spacing: { before: 100, after: 200 },
      border: { bottom: { color: COLORS.primary, space: 4, style: BorderStyle.SINGLE, size: 12 } },
      children: []
    })
  );

  // 分页符：机构信息页 → 客户报价页
  blocks.push(
    new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new PageBreak()]
    })
  );

  // ========== 客户信息（首页）==========
  blocks.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 200 },
      children: [
        new TextRun({
          text: "管理体系认证报价单",
          bold: true,
          size: 32,
          color: COLORS.primary,
          font: FONTS.heading
        })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "客户名称：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: quote.companyName, size: 22, color: COLORS.ink })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "组织规模：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: `${quote.employeeCount} 人（${quote.industry}）`, size: 22, color: COLORS.ink })
      ]
    })
  );

  // 拟申请认证范围（多行）
  blocks.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "拟申请认证范围：", bold: true, size: 22, color: COLORS.ink })
      ]
    })
  );
  const scopeText = quote.certificationScope || "（最终认证范围以合同评审为准）";
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      indent: { left: 400 },
      children: [
        new TextRun({ text: scopeText, size: 20, color: COLORS.ink })
      ]
    })
  );
  // 只在没有填认证范围时才显示合同评审备注
  if (!quote.certificationScope) {
    blocks.push(
      new Paragraph({
        spacing: { after: 240 },
        indent: { left: 400 },
        children: [
          new TextRun({ text: "（最终认证范围以合同评审为准）", size: 18, color: COLORS.muted, italics: true })
        ]
      })
    );
  }

  // ========== 一、报价明细表 ==========
  blocks.push(
    new Paragraph({
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({ text: "一、报价明细", bold: true, size: 26, color: COLORS.primary, font: FONTS.heading })
      ]
    })
  );

  function buildCell(text: string, options: {
    bold?: boolean;
    color?: string;
    fill?: string;
    width?: number;
    align?: "left" | "right" | "center";
  } = {}): TableCell {
    return new TableCell({
      width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
      verticalAlign: VerticalAlign.CENTER,
      shading: options.fill
        ? { type: ShadingType.CLEAR, fill: options.fill, color: "auto" }
        : undefined,
      margins: { top: 110, bottom: 110, left: 130, right: 130 },
      children: [
        new Paragraph({
          alignment: options.align === "right" ? AlignmentType.RIGHT
            : options.align === "center" ? AlignmentType.CENTER
            : AlignmentType.LEFT,
          children: [
            new TextRun({
              text,
              bold: options.bold,
              color: options.color ?? COLORS.ink,
              size: 20
            })
          ]
        })
      ]
    });
  }

  // 报价明细表（简化版：只显示证书+价格+备注）
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      buildCell("认证类别", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1800 }),
      buildCell("认证标准", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 2800 }),
      buildCell("价格（元）", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1500, align: "right" }),
      buildCell("备注", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 2700 })
    ]
  });

  // 标准映射（按体系拆分）
  const certStandardMap: Record<string, string> = {
    "Q": "GB/T19001-2016/ISO9001:2015",
    "E": "GB/T 24001-2016 /ISO 14001:2015",
    "S": "GB/T 45001-2020 /ISO 45001:2018",
    "27001": "GB/T22080-2016/ISO/IEC27001:2022",
    "20000": "ISO/IEC 20000-1:2018",
    "HACCP": "GB/T27341-2009/ISO22000",
    "食品安全管理": "ISO 22000:2018",
    "GAP": "良好农业规范",
    "商品售后服务": "商品售后服务认证",
    "餐饮服务": "餐饮服务认证",
    "社会责任": "SA 8000 社会责任",
    "能源": "ISO 50001:2018",
    "碳管理": "ISO 14068",
    "绿色供应链": "绿色供应链"
  };

  // 体系简称映射（用于拆分 QES 三体系）
  const shortCertMap: Record<string, string> = {
    "QES": "Q",
    "QE": "Q",
    "ES": "E",
    "QJES": "Q",
    "27001": "27001",
    "20000": "20000",
    "双信息": "27001",  // 显示 27001 行
    "HACCP": "HACCP",
    "食品安全管理": "食品安全管理",
    "GAP": "GAP",
    "商品售后服务": "商品售后服务",
    "餐饮服务": "餐饮服务",
    "社会责任": "社会责任",
    "能源": "能源",
    "碳管理": "碳管理",
    "绿色供应链": "绿色供应链"
  };

  // 体系类型名称映射（拆分）
  const shortTypeMap: Record<string, string> = {
    "Q": "质量管理体系认证",
    "E": "环境管理体系",
    "S": "职业健康安全管理体系",
    "27001": "信息安全管理体系",
    "20000": "信息技术服务管理体系",
    "HACCP": "危害分析与关键控制点体系",
    "食品安全管理": "食品安全管理体系",
    "GAP": "良好农业规范",
    "商品售后服务": "商品售后服务认证",
    "餐饮服务": "餐饮服务认证",
    "社会责任": "社会责任管理体系",
    "能源": "能源管理体系",
    "碳管理": "碳管理体系",
    "绿色供应链": "绿色供应链管理体系"
  };

  // 把每个选中的证书拆分成行（QES → 3 行）
  const expandedRows: Array<{
    certId: string;
    certType: string;
    certStandard: string;
  }> = [];
  for (const c of quote.certifications) {
    if (c.certId === "QES") {
      // QES = Q + E + S 三行
      for (const std of ["Q", "E", "S"]) {
        expandedRows.push({
          certId: c.certId,
          certType: shortTypeMap[std],
          certStandard: certStandardMap[std]
        });
      }
    } else if (c.certId === "QE") {
      // QE = Q + E 两行
      for (const std of ["Q", "E"]) {
        expandedRows.push({
          certId: c.certId,
          certType: shortTypeMap[std],
          certStandard: certStandardMap[std]
        });
      }
    } else if (c.certId === "ES") {
      // ES = E + S 两行
      for (const std of ["E", "S"]) {
        expandedRows.push({
          certId: c.certId,
          certType: shortTypeMap[std],
          certStandard: certStandardMap[std]
        });
      }
    } else if (c.certId === "QJES") {
      // QJES = Q + E + 27001（Q+E 在 QES，27001 单独）
      for (const std of ["Q", "E"]) {
        expandedRows.push({
          certId: c.certId,
          certType: shortTypeMap[std],
          certStandard: certStandardMap[std]
        });
      }
      expandedRows.push({
        certId: c.certId,
        certType: shortTypeMap["27001"],
        certStandard: certStandardMap["27001"]
      });
    } else if (c.certId === "双信息") {
      // 双信息 = 27001 + 20000 两行
      for (const std of ["27001", "20000"]) {
        expandedRows.push({
          certId: c.certId,
          certType: shortTypeMap[std],
          certStandard: certStandardMap[std]
        });
      }
    } else {
      // 其他证书单行
      expandedRows.push({
        certId: c.certId,
        certType: shortTypeMap[c.certId] ?? c.certName,
        certStandard: certStandardMap[c.certId] ?? c.certName
      });
    }
  }

  // 监督价格 = 初审的 80%
  const supervisionPrice = Math.round(quote.basePrice * 0.8);
  const initialPriceText = `初审 ¥${quote.basePrice.toLocaleString()}`;
  const supervisionPriceText = `监督 ¥${supervisionPrice.toLocaleString()}`;

  // 构建报价明细行（合并价格/备注单元格）
  const itemRows: TableRow[] = [];
  for (let i = 0; i < expandedRows.length; i++) {
    const row = expandedRows[i];
    const isFirst = i === 0;
    const isLast = i === expandedRows.length - 1;

    itemRows.push(
      new TableRow({
        children: [
          buildCell(row.certType, { fill: COLORS.white, width: 2400 }),
          buildCell(row.certStandard, { fill: COLORS.white, width: 3200 }),
          // 价格/备注列只在第一行实际生成 cell（含 rowSpan）
          // 后面的行不创建这些列的 cell（让 LibreOffice/Word 合并）
          ...(isFirst
            ? [
                new TableCell({
                  rowSpan: expandedRows.length,
                  verticalAlign: VerticalAlign.CENTER,
                  margins: { top: 110, bottom: 110, left: 130, right: 130 },
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: initialPriceText,
                          bold: true,
                          color: COLORS.accent,
                          size: 22,
                          underline: {}
                        })
                      ]
                    }),
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: supervisionPriceText,
                          bold: true,
                          color: COLORS.accent,
                          size: 22,
                          underline: {}
                        })
                      ]
                    })
                  ]
                }),
                new TableCell({
                  rowSpan: expandedRows.length,
                  verticalAlign: VerticalAlign.CENTER,
                  margins: { top: 110, bottom: 110, left: 130, right: 130 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: "差旅食宿费由企业实报实销（银川老师为主）",
                          size: 20
                        })
                      ]
                    })
                  ]
                })
              ]
            : [])  // 非首行：让 rowSpan 接管这两列
        ]
      })
    );
  }

  // 商务条款（发票 + 付款方式）
  const billingRow = new TableRow({
    children: [
      buildCell("发票类型及税率", { fill: COLORS.surface, width: 2400, bold: true }),
      buildCell(`税率${branding.taxRate ?? "6%"}，${branding.invoiceType ?? "增值税普通发票"}`,
        { fill: COLORS.white, width: 3200 }),
      buildCell("—", { fill: COLORS.white, width: 1600, align: "center" }),
      buildCell("—", { fill: COLORS.white, width: 1600, align: "center" })
    ]
  });

  const paymentRow = new TableRow({
    children: [
      buildCell("付款方式", { fill: COLORS.surface, width: 2400, bold: true }),
      buildCell(branding.paymentTerms ?? "合同签订首付70%，收到证书付清尾款30%",
        { fill: COLORS.white, width: 3200 }),
      buildCell("—", { fill: COLORS.white, width: 1600, align: "center" }),
      buildCell("—", { fill: COLORS.white, width: 1600, align: "center" })
    ]
  });

  blocks.push(new Table({
    width: { size: 8800, type: WidthType.DXA },
    borders: {
      top: border(COLORS.line, 4),
      bottom: border(COLORS.line, 4),
      left: border(COLORS.line, 4),
      right: border(COLORS.line, 4),
      insideHorizontal: border(COLORS.line, 4),
      insideVertical: border(COLORS.line, 4)
    },
    rows: [headerRow, ...itemRows, billingRow, paymentRow]
  }));

  // ========== 二、计算明细 ==========
  blocks.push(
    new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({ text: "二、计算明细", bold: true, size: 26, color: COLORS.primary, font: FONTS.heading })
      ]
    })
  );

  // 公式说明
  blocks.push(
    new Paragraph({
      spacing: { before: 80, after: 120 },
      children: [
        new TextRun({
          text: "💡 报价公式 = 人日×500 + 体系数×1,100 + 280（QES时）+ 专业补贴(人日/专家×200) + 税费 + 经营管理",
          italics: true,
          size: 18,
          color: COLORS.muted
        })
      ]
    })
  );

  const calcRows = [
    [`1. 专家评审费（${quote.totalAuditDays} 人日 × ¥500）`, `¥ ${quote.expertReviewFee.toLocaleString()}`],
    [`2. 三体系组长费（${quote.groupLeaderFee > 0 ? "QES" : "—"}）`, `¥ ${quote.groupLeaderFee.toLocaleString()}`],
    [`3. 专业补贴（${quote.totalAuditDays} 人日 / ${quote.expertCount} 专家 × ¥200）`, `¥ ${quote.professionalSubsidy.toLocaleString()}`],
    [`4. 管理注册年金（${quote.standardCount} 体系 × ¥1,100）`, `¥ ${quote.managementAnnualFee.toLocaleString()}`],
    [`基础价（4 项直接相加）`, `¥ ${quote.basePrice.toLocaleString()}`],
    [`税费（基础价 / 0.92 × 8.7%）`, `¥ ${quote.taxFee.toLocaleString()}`],
    [`企业经营管理费（基础价 × 18%）`, `¥ ${quote.businessManagementFee.toLocaleString()}`]
  ];

  const calcTable = new Table({
    width: { size: 8800, type: WidthType.DXA },
    borders: {
      top: border(COLORS.line, 4),
      bottom: border(COLORS.line, 4),
      left: border(COLORS.line, 4),
      right: border(COLORS.line, 4),
      insideHorizontal: border(COLORS.line, 4),
      insideVertical: border(COLORS.line, 4)
    },
    rows: calcRows.map((row, i) => new TableRow({
      children: [
        tableCell(row[0], { heading: true, fill: i % 2 ? COLORS.surface : COLORS.white, width: 5500 }),
        tableCell(row[1], { fill: i % 2 ? COLORS.surface : COLORS.white, width: 3300 })
      ]
    }))
  });
  blocks.push(calcTable);

  // 最终客户报价
  blocks.push(
    new Paragraph({
      spacing: { before: 320, after: 100 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "最终客户报价（含税 + 经营管理）", size: 22, color: COLORS.muted })
      ]
    })
  );
  blocks.push(
    new Paragraph({
      spacing: { before: 60, after: 240 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `¥ ${quote.finalPrice.toLocaleString()}`,
          bold: true,
          size: 48,
          color: COLORS.accent,
          font: FONTS.heading
        })
      ]
    })
  );

  // ========== 三、商务条款（参照云森模板）==========
  blocks.push(
    new Paragraph({
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({ text: "三、商务条款", bold: true, size: 26, color: COLORS.primary, font: FONTS.heading })
      ]
    })
  );

  // 发票类型及税率
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "发票类型及税率：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({
          text: branding.invoiceType ?? "增值税普通发票",
          size: 22,
          color: COLORS.ink
        }),
        new TextRun({
          text: " 税率" + (branding.taxRate ?? "6%"),
          bold: true,
          size: 22,
          color: COLORS.accent
        })
      ]
    })
  );

  // 付款方式
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "付款方式：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({
          text: branding.paymentTerms ?? "合同签订首付70%，收到证书付清尾款30%",
          size: 22,
          color: COLORS.ink
        })
      ]
    })
  );

  // 出证周期
  blocks.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: "出证周期：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({
          text: branding.certificatePeriod ?? "30天左右",
          size: 22,
          color: COLORS.ink
        })
      ]
    })
  );

  // ========== 四、价格包含/不包含 ==========
  blocks.push(
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [
        new TextRun({ text: "四、价格包含", bold: true, size: 24, color: COLORS.primary })
      ]
    })
  );
  for (const item of quote.priceIncludes) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: "✓ " + item, size: 20 })]
      })
    );
  }

  blocks.push(
    new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({ text: "五、价格不包含", bold: true, size: 24, color: COLORS.primary })
      ]
    })
  );
  for (const item of quote.priceExcludes) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: "✗ " + item, size: 20 })]
      })
    );
  }

  // ========== 六、申请认证基本条件 ==========
  blocks.push(
    new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({ text: "六、申请认证基本条件", bold: true, size: 24, color: COLORS.primary })
      ]
    })
  );
  const conditions = [
    "①企业资质满三个月；体系运行满6个月；",
    "②企业近一年无行政处罚（已消除影响的除外）；",
    "③能提供营业执照、组织机构代码证等相关资质文件；",
    "④建立完整的内部审核和管理评审记录。"
  ];
  for (const c of conditions) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: c, size: 20 })]
      })
    );
  }

  // ========== 七、签章 ==========
  blocks.push(
    new Paragraph({
      spacing: { before: 200, after: 100 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          text: branding.companyName + " · 宁夏分公司",
          bold: true,
          size: 22,
          color: COLORS.ink
        })
      ]
    })
  );
  blocks.push(
    new Paragraph({
      spacing: { before: 60, after: 100 },
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: dateStr, size: 22, color: COLORS.ink })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [
        new TextRun({ text: "客户签字：", size: 20, color: COLORS.muted }),
        new TextRun({ text: "________________________", size: 20 }),
        new TextRun({ text: "    日期：", size: 20, color: COLORS.muted }),
        new TextRun({ text: "________________________", size: 20 })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { before: 100 },
      children: [
        new TextRun({ text: "公司签章：", size: 20, color: COLORS.muted }),
        new TextRun({ text: "________________________", size: 20 }),
        new TextRun({ text: "    日期：", size: 20, color: COLORS.muted }),
        new TextRun({ text: "________________________", size: 20 })
      ]
    })
  );

  return blocks;
}

/**
 * 异步版本：构造包含证书图片附件的报价文档内容
 * 使用 Promise 等待 buildQuoteContent 完成后追加证书图片
 */
async function buildQuoteContentWithImages(quote: QuoteResult, branding: DocxBranding): Promise<FileChild[]> {
  // 调用同步函数获取基础 blocks
  const blocks: FileChild[] = buildQuoteContent(quote, branding);

  // 去掉原本同步函数末尾误加的"八、"标题（（异步函数里再加）
  // 保留最后 2 个 paragraph（签章块）
  const lastIdx = blocks.length - 1;
  if (lastIdx >= 0) {
    const lastBlock = blocks[lastIdx] as any;
    const lastChildren = lastBlock?.root?.children || lastBlock?.options?.children || [];
    const lastText = JSON.stringify(lastChildren);
    if (lastText.includes('"八、证书样本附件')) {
      blocks.pop();
    }
  }

  const certDir = path.join(config.dataDir, "certificates");
  const certs = [
    { file: "qms_certificate_sample.jpg", title: "质量管理体系认证证书（样本）", standard: "GB/T 19001-2016/ISO 9001:2015" },
    { file: "ems_certificate_sample.jpg", title: "环境管理体系认证证书（样本）", standard: "GB/T 24001-2016/ISO 14001:2015" },
    { file: "ohsms_certificate_sample.jpg", title: "职业健康安全管理体系认证证书（样本）", standard: "GB/T 45001-2020/ISO 45001:2018" }
  ];

  blocks.push(
    new Paragraph({
      spacing: { before: 400, after: 100 },
      children: [
        new TextRun({ text: "八、证书样本附件（华中国际认证检验集团）", bold: true, size: 26, color: COLORS.primary, font: FONTS.heading })
      ]
    })
  );

  for (const cert of certs) {
    const imgPath = path.join(certDir, cert.file);
    try {
      const imgBuffer = await fs.readFile(imgPath);

      // 读取图片实际尺寸（PNG/JPG 头），按宽高比缩放
      let origWidth = 600;
      let origHeight = 800;
      try {
        const header = imgBuffer.subarray(0, 24);
        if (header[0] === 0x89 && header[1] === 0x50) {
          // PNG: IHDR @ offset 8: width(4) + height(4)
          origWidth = (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
          origHeight = (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
        } else if (header[0] === 0xFF && header[1] === 0xD8) {
          // JPG: 扫描 SOFn 标记（FF C0/C1/C2/C3）
          let i = 2;
          while (i < imgBuffer.length - 9) {
            if (imgBuffer[i] !== 0xFF) {
              i++;
              continue;
            }
            const marker = imgBuffer[i + 1];
            // SOFn markers: 0xC0-0xCF (except C4, C8, CC)
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
              origHeight = (imgBuffer[i + 5] << 8) | imgBuffer[i + 6];
              origWidth = (imgBuffer[i + 7] << 8) | imgBuffer[i + 8];
              break;
            }
            const segLen = (imgBuffer[i + 2] << 8) | imgBuffer[i + 3];
            i += 2 + segLen;
          }
        }
      } catch {
        // 解析失败使用默认值
      }

      // 按比例缩放到目标宽度 480 px
      const targetWidth = 480;
      const displayWidth = targetWidth;
      const displayHeight = Math.round(targetWidth * origHeight / origWidth);

      blocks.push(
        new Paragraph({
          spacing: { before: 240, after: 100 },
          children: [
            new TextRun({ text: cert.title, bold: true, size: 22, color: COLORS.ink }),
            new TextRun({ text: "  |  ", size: 22, color: COLORS.muted }),
            new TextRun({ text: cert.standard, size: 20, color: COLORS.muted }),
            new TextRun({ text: `  (${origWidth}×${origHeight})`, size: 16, color: COLORS.muted })
          ]
        })
      );
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 240 },
          children: [
            new ImageRun({
              data: imgBuffer,
              transformation: { width: displayWidth, height: displayHeight },
              type: "jpg"
            })
          ]
        })
      );
    } catch (err) {
      blocks.push(
        new Paragraph({
          spacing: { before: 100, after: 100 },
          children: [
            new TextRun({ text: `[证书样本未找到：${cert.file}]`, size: 18, color: COLORS.muted, italics: true })
          ]
        })
      );
    }
  }

  return blocks;
}
