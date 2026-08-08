import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("脱敏请求和响应中的认证头与Cookie", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const logger = createLogger(destination);

    logger.info({
      req: {
        headers: {
          authorization: "Bearer access-secret",
          cookie: "access_token=access-secret; refresh_token=refresh-secret"
        }
      },
      res: {
        headers: {
          "set-cookie": [
            "access_token=access-secret; HttpOnly",
            "refresh_token=refresh-secret; HttpOnly"
          ]
        }
      }
    });

    expect(output).not.toContain("access-secret");
    expect(output).not.toContain("refresh-secret");
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
