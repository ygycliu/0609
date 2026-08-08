import type { KnowledgeItem } from "../shared/types.js";

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  const words = normalized.split(/\s+/).filter((word) => word.length > 1);
  const chinese = normalized.replace(/[^\p{Script=Han}]/gu, "");
  const bigrams = Array.from({ length: Math.max(0, chinese.length - 1) }, (_, index) =>
    chinese.slice(index, index + 2)
  );
  return [...new Set([...words, ...bigrams])];
}

export interface KnowledgeSearchOptions {
  /** category 白名单；undefined 表示不过滤 */
  categories?: string[];
  /** 返回 Top N */
  limit?: number;
}

export function searchKnowledge(
  query: string,
  items: KnowledgeItem[],
  options: KnowledgeSearchOptions = {}
): KnowledgeItem[] {
  const limit = options.limit ?? 4;
  const categories = options.categories;

  // 先按 category 过滤（实现专用知识库隔离）
  const candidates =
    !categories || categories.length === 0
      ? items
      : items.filter((item) => categories.includes(item.category));

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return candidates.slice(0, limit);

  return candidates
    .map((item) => {
      const title = `${item.title} ${item.tags.join(" ")}`.toLowerCase();
      const bodyTokens = new Set(tokenize(`${title} ${item.content}`));
      const score = queryTokens.reduce((total, token) => {
        if (title.includes(token)) return total + 5;
        if (bodyTokens.has(token)) return total + 2;
        return total;
      }, 0);
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
