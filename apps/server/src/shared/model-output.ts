const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const THINK_TAG = /<\/?think\b[^>]*>/gi;

export function sanitizeModelOutput(value: string): string {
  return value
    .replace(THINK_BLOCK, "")
    .replace(THINK_TAG, "")
    .trim();
}
