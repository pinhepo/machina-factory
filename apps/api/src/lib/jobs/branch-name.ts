const MAX_SLUG_LEN = 40;
const SUFFIX_LEN = 6;

export function buildWorkBranch(task: string, id: string): string {
  const slug = slugify(task, MAX_SLUG_LEN);
  const suffix = id.slice(0, SUFFIX_LEN);
  return slug ? `machina/${slug}-${suffix}` : `machina/${suffix}`;
}

function slugify(text: string, maxLen: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= maxLen) return base;
  const truncated = base.slice(0, maxLen);
  const lastDash = truncated.lastIndexOf("-");
  if (lastDash > 0) return truncated.slice(0, lastDash);
  return truncated;
}
