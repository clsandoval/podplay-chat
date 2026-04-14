import { parse } from 'yaml';

/** Browser-safe frontmatter parser. Replaces gray-matter which needs Node Buffer. */
export function parseFrontmatter(content: string): { data: Record<string, any>; content: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content };
  try {
    return { data: parse(match[1]) ?? {}, content: match[2] };
  } catch {
    return { data: {}, content };
  }
}
