/**
 * OFD 转 Word 工具
 *
 * OFD（Open Fixed-layout Document）是国产版式文档标准，本质是 ZIP 包
 * 解析 ofd:TextCode 节点提取文本，生成 .docx
 */

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";
import { Document, Paragraph, Packer, HeadingLevel, AlignmentType, TextRun } from "docx";

/** 解压 OFD（OFD = ZIP） */
async function extractOfd(ofdBuffer: Buffer, destDir: string): Promise<void> {
  const zipPath = path.join(destDir, "source.ofd");
  await fs.writeFile(zipPath, ofdBuffer);
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: "ignore" });
}

/** 提取所有 ofd:TextCode 文本 */
function extractText(extractDir: string): string {
  let full = "";
  const pagesDir = path.join(extractDir, "Doc_0", "Pages");
  if (!fsSync.existsSync(pagesDir)) return full;
  const pages = fsSync.readdirSync(pagesDir).filter(d => d.startsWith("Page_")).sort();
  for (const p of pages) {
    const xmlPath = path.join(pagesDir, p, "Content.xml");
    if (!fsSync.existsSync(xmlPath)) continue;
    const xml = fsSync.readFileSync(xmlPath, "utf-8");
    const matches = xml.match(/<ofd:TextCode[^>]*>([^<]*)<\/ofd:TextCode>/g) || [];
    for (const m of matches) {
      full += m.replace(/<[^>]+>/g, "");
    }
  }
  return full;
}

/**
 * 从文本中提取标题（取首行或前 30 字）
 */
function extractTitle(text: string, fallback: string): string {
  const trimmed = text.trim().slice(0, 200);
  // 寻找关键标题模式
  const titleMatch = trimmed.match(/(宁夏回族自治区[^关于]*?通知)/);
  if (titleMatch) return titleMatch[1].trim();
  // 取包含"通知"的首句
  const notifMatch = trimmed.match(/([^。]+通知)/);
  if (notifMatch) return notifMatch[1].trim();
  // 取前 30 字
  return trimmed.slice(0, 30).trim() || fallback;
}

/**
 * OFD Buffer → Word Buffer
 */
export async function ofdBufferToDocxBuffer(
  ofdBuffer: Buffer,
  options: { titleHint?: string } = {}
): Promise<{ docx: Buffer; title: string; text: string }> {
  // 1. 解压到临时目录
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ofd2docx-"));
  try {
    await extractOfd(ofdBuffer, tmpDir);

    // 2. 提取文本
    const text = extractText(tmpDir);
    if (!text.trim()) {
      throw new Error("OFD 文件中未提取到文本内容");
    }

    // 3. 推断标题
    const title = extractTitle(text, options.titleHint || "未命名文档");

    // 4. 智能分段
    const lines = text.split(/(?<=。|！)/).map(s => s.trim()).filter(Boolean);
    const paragraphs: Paragraph[] = [];

    // 标题
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: title, bold: true, size: 32, color: "C00000" })]
      }),
      new Paragraph({ text: "" })
    );

    // 正文
    for (const line of lines) {
      if (!line.trim()) continue;
      // 跳过标题行（已在标题中）
      if (line.trim() === title.trim()) continue;

      if (/^[一二三四五六七八九十]+、/.test(line) || /^（[一二三四五六七八九十]+）/.test(line)) {
        paragraphs.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: line, bold: true, color: "1F4E79", size: 24 })],
            spacing: { before: 200, after: 100 }
          })
        );
      } else if (line.startsWith("附件") || line.startsWith("注：")) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, bold: true, size: 22 })],
            spacing: { before: 100, after: 100 }
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
            spacing: { after: 120 }
          })
        );
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: paragraphs }],
      creator: "AI 数字化中心 - OFD转换器",
      title: title
    });

    const buf = await Packer.toBuffer(doc);
    return { docx: buf, title, text };
  } finally {
    // 清理临时目录
    try {
      execSync(`rm -rf "${tmpDir}"`, { stdio: "ignore" });
    } catch {}
  }
}
