import { describe, expect, it } from "vitest";
import { sanitizeModelOutput } from "./model-output.js";

describe("sanitizeModelOutput", () => {
  it("removes complete and stray reasoning tags", () => {
    expect(sanitizeModelOutput("<think>secret reasoning</think>\n# Result")).toBe("# Result");
    expect(sanitizeModelOutput("<think>draft\nFinal answer")).toBe("draft\nFinal answer");
    expect(sanitizeModelOutput("Answer</think>")).toBe("Answer");
  });
});
