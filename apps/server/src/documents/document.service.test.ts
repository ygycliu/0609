import { describe, expect, it } from "vitest";
import { extractDocumentText } from "./document.service.js";

function file(name: string, content: string): Express.Multer.File {
  const buffer = Buffer.from(content);
  return {
    fieldname: "file",
    originalname: name,
    encoding: "7bit",
    mimetype: "text/plain",
    size: buffer.length,
    destination: "",
    filename: name,
    path: "",
    buffer,
    stream: undefined as never
  };
}

describe("extractDocumentText", () => {
  it("读取 UTF-8 文本文件", async () => {
    await expect(extractDocumentText(file("需求说明.md", "建设企业知识助手"))).resolves.toBe(
      "建设企业知识助手"
    );
  });

  it("拒绝不支持的文件类型", async () => {
    await expect(extractDocumentText(file("archive.zip", "data"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
  });
});
