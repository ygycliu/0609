import fs from "node:fs/promises";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertCurrentProductionRuntimeOwnership } from "./shared/runtime-ownership.js";

await assertCurrentProductionRuntimeOwnership();
await fs.mkdir(config.dataDir, { recursive: true });

const server = (await createApp()).listen(config.port, config.host, () => {
  console.log(`AI 数字化中心 API: http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
