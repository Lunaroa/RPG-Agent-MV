// 把 zod schema 适配成引擎的 SchemaValidator（解耦校验库，引擎本身不依赖 zod）。

import type { ZodType } from "zod";

import type { SchemaValidator } from "./types.ts";

export function zodValidator<T>(schema: ZodType<T>): SchemaValidator {
  return (value: unknown) => {
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, data: result.data };
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: issues || "schema mismatch" };
  };
}
