import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly initialValue: T
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.write(this.initialValue);
      return structuredClone(this.initialValue);
    }
  }

  async write(value: T): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporaryPath, this.filePath);
  }
}
