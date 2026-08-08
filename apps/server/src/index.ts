import fs from "node:fs/promises";
import { createApp } from "./app.js";
import { config } from "./config.js";

await fs.mkdir(config.dataDir, { recursive: true });

const server = createApp().listen(config.port, () => {
  console.log(`AI 数字化咨询中心 API: http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
