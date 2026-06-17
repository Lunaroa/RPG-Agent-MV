export function formatDisplay(command: string, args: string[]): string {
  const DISPLAY_VALUE_MAX = 80;
  const FLAGS_TAKING_INLINE_VALUE = new Set([
    "--model", "--variant", "--format", "--tools", "--permission-mode",
    "--output-format", "--setting-sources", "--add-dir", "--file",
  ]);
  const parts: string[] = [command];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const isFlag = typeof arg === "string" && arg.startsWith("--");
    const isShortFlag = typeof arg === "string" && /^-[a-zA-Z]$/.test(arg);
    if (isFlag || isShortFlag) {
      parts.push(arg);
      const next = args[i + 1];
      if (
        typeof next === "string" && !next.startsWith("-") &&
        (isShortFlag || FLAGS_TAKING_INLINE_VALUE.has(arg) ||
          (next.length <= DISPLAY_VALUE_MAX && !next.includes("\n")))
      ) {
        const truncated = next.length > DISPLAY_VALUE_MAX
          ? `${next.slice(0, DISPLAY_VALUE_MAX)}…`
          : next;
        parts.push(/\s/.test(truncated) ? JSON.stringify(truncated) : truncated);
        i++;
      }
    } else if (typeof arg === "string") {
      if (arg.length > DISPLAY_VALUE_MAX || arg.includes("\n")) {
        parts.push(`<prompt:${arg.length}chars>`);
      } else {
        parts.push(/\s/.test(arg) ? JSON.stringify(arg) : arg);
      }
    } else {
      parts.push(String(arg));
    }
  }
  return parts.join(" ");
}
