export interface RmmvHandlerResult {
  summary: string;
  data?: unknown;
  artifacts?: string[];
}

export type RmmvHandlerInput = Record<string, unknown>;
