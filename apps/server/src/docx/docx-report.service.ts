import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
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
    companyName: "[编制单位名称]",
    clientName: "[客户单位名称]",
    projectName: "[项目名称]",
    documentTitle: "企业数字化建设方案",
    version: "V1.0",
    preparedBy: "[编制人员/团队]",
    confidentiality: "内部资料",
    includeToc: true,
    includeReferences: true
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
        children: buildQuoteContent(quote, branding)
      }
    ]
  });
  return Packer.toBuffer(doc);
}

function buildQuoteContent(quote: QuoteResult, branding: DocxBranding): FileChild[] {
  const blocks: FileChild[] = [];
  const now = new Date();

  // 标题
  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: "认证证书报价单",
          bold: true,
          size: 36,
          color: COLORS.primary,
          font: FONTS.heading
        })
      ]
    })
  );

  // 客户信息块
  blocks.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "客户：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: quote.companyName, size: 22, color: COLORS.ink }),
        new TextRun({ text: "    行业：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: quote.industry, size: 22, color: COLORS.ink }),
        new TextRun({ text: "    人数：", bold: true, size: 22, color: COLORS.ink }),
        new TextRun({ text: `${quote.employeeCount} 人（${quote.sizeTier}）`, size: 22, color: COLORS.ink })
      ]
    })
  );

  blocks.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: "出具日期：", bold: true, size: 20, color: COLORS.muted }),
        new TextRun({
          text: now.toLocaleString("zh-CN"),
          size: 20,
          color: COLORS.muted
        }),
        new TextRun({ text: "    报价人：", bold: true, size: 20, color: COLORS.muted }),
        new TextRun({ text: branding.preparedBy, size: 20, color: COLORS.muted })
      ]
    })
  );

  // 证书明细表
  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({ text: "一、报价明细", bold: true, size: 26, color: COLORS.primary })
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

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      buildCell("证书名称", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 3000 }),
      buildCell("基价", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1200, align: "right" }),
      buildCell("行业系数", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1000, align: "center" }),
      buildCell("调整后", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1300, align: "right" }),
      buildCell("审核员", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1000, align: "center" }),
      buildCell("人日（初/监/再）", { bold: true, color: COLORS.white, fill: COLORS.primary, width: 1800, align: "center" })
    ]
  });

  const itemRows = quote.certifications.map((c, i) => new TableRow({
    children: [
      buildCell(c.certName, { fill: i % 2 ? COLORS.surface : COLORS.white, width: 3000 }),
      buildCell(`¥ ${c.basePrice.toLocaleString()}`, { fill: i % 2 ? COLORS.surface : COLORS.white, width: 1200, align: "right" }),
      buildCell(`× ${c.industryFactor}`, { fill: i % 2 ? COLORS.surface : COLORS.white, width: 1000, align: "center" }),
      buildCell(`¥ ${c.adjustedBase.toLocaleString()}`, { fill: i % 2 ? COLORS.surface : COLORS.white, width: 1300, align: "right" }),
      buildCell(c.auditorLevel, { fill: i % 2 ? COLORS.surface : COLORS.white, width: 1000, align: "center" }),
      buildCell(`${c.initialAuditDays} / ${c.supervisionAuditDays} / ${c.recertificationAuditDays}`,
        { fill: i % 2 ? COLORS.surface : COLORS.white, width: 1800, align: "center" })
    ]
  }));

  blocks.push(new Table({
    width: { size: 9300, type: WidthType.DXA },
    borders: {
      top: border(COLORS.line, 4),
      bottom: border(COLORS.line, 4),
      left: border(COLORS.line, 4),
      right: border(COLORS.line, 4),
      insideHorizontal: border(COLORS.line, 4),
      insideVertical: border(COLORS.line, 4)
    },
    rows: [headerRow, ...itemRows]
  }));

  // 计算明细
  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({ text: "二、计算明细", bold: true, size: 26, color: COLORS.primary })
      ]
    })
  );

  const calcRows = [
    [`1. 专家评审费（${quote.totalAuditDays} 人日 × ¥500）`, `¥ ${quote.expertReviewFee.toLocaleString()}`],
    [`2. 三体系组长费（${quote.groupLeaderFee > 0 ? "QES" : "—"}）`, `¥ ${quote.groupLeaderFee.toLocaleString()}`],
    [`3. 专业补贴（${quote.professionalSubsidy > 0 ? "特殊行业/高风险" : "—"}）`, `¥ ${quote.professionalSubsidy.toLocaleString()}`],
    [`4. 专家差旅费（实报实销）`, `¥ ${quote.travelFee.toLocaleString()}`],
    [`5. 审核员住宿${quote.accommodationFee > 0 ? "（异地 ¥300/天）" : "（本地免）"}`, `¥ ${quote.accommodationFee.toLocaleString()}`],
    [`6. 管理注册年金（${quote.standardCount} 体系 × ¥1,100）`, `¥ ${quote.managementAnnualFee.toLocaleString()}`],
    [`基础价（6 部分之和）`, `¥ ${quote.basePrice.toLocaleString()}`],
    [`税费（基础价 / 0.92 × 8.7%）`, `¥ ${quote.taxFee.toLocaleString()}`],
    [`企业经营管理费（基础价 × 18%）`, `¥ ${quote.businessManagementFee.toLocaleString()}`]
  ];

  const calcTable = new Table({
    width: { size: 6000, type: WidthType.DXA },
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
        tableCell(row[0], { heading: true, fill: i % 2 ? COLORS.surface : COLORS.white, width: 4000 }),
        tableCell(row[1], { fill: i % 2 ? COLORS.surface : COLORS.white, width: 2000 })
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
          size: 44,
          color: COLORS.accent,
          font: FONTS.heading
        })
      ]
    })
  );

  // 监督 + 人日
  blocks.push(
    new Paragraph({
      spacing: { after: 280 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "监督审核（次年）：", size: 20, color: COLORS.muted }),
        new TextRun({
          text: `¥ ${quote.supervisionPrice.toLocaleString()}`,
          bold: true,
          size: 20,
          color: COLORS.ink
        }),
        new TextRun({ text: "    ｜    总审核人日：", size: 20, color: COLORS.muted }),
        new TextRun({
          text: `${quote.estimatedAuditDays} 天`,
          bold: true,
          size: 20,
          color: COLORS.ink
        })
      ]
    })
  );

  // 包含项
  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({ text: "三、价格包含", bold: true, size: 24, color: COLORS.primary })
      ]
    })
  );
  for (const item of quote.priceIncludes) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        bullet: { level: 0 },
        children: [new TextRun({ text: item, size: 20 })]
      })
    );
  }

  // 不包含
  blocks.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({ text: "四、价格不包含", bold: true, size: 24, color: COLORS.primary })
      ]
    })
  );
  for (const item of quote.priceExcludes) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        bullet: { level: 0 },
        children: [new TextRun({ text: item, size: 20 })]
      })
    );
  }

  // 签章
  blocks.push(
    new Paragraph({
      spacing: { before: 400, after: 100 },
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
