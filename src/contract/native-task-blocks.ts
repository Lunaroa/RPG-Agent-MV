const NATIVE_TASK_BLOCK = /<task\b(?=[^>]*\bstate=(["']?)(?:running|completed|failed|timeout|not_ready|stopped)\1)[^>]*>[\s\S]*?<\/task>/gi;

function stripOutsideFences(source: string, strip: (value: string) => string): string {
  const fenced = /```[\s\S]*?```/g;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(source))) {
    out += strip(source.slice(cursor, match.index));
    out += match[0];
    cursor = match.index + match[0].length;
  }
  out += strip(source.slice(cursor));
  return out;
}

export function stripNativeTaskBlocks(text: string): string {
  const source = String(text || "");
  return stripOutsideFences(source, (value) => value.replace(NATIVE_TASK_BLOCK, ""));
}

export function nativeTaskResultText(text: string): string {
  const source = String(text || "").trim();
  const block = /^<task\b(?=[^>]*\bstate=(["']?)(?:running|completed|failed|timeout|not_ready|stopped)\1)[^>]*>([\s\S]*?)<\/task>$/i.exec(source);
  if (!block) return source;
  const result = /<task_result>([\s\S]*?)<\/task_result>/i.exec(block[2]);
  return result ? result[1].trim() : "";
}
