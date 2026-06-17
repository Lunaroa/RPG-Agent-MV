import type { RmmvHandlerInput, RmmvHandlerResult } from "./rmmv-handler-types.ts";
import {
  runRmmvAssetInventory,
  runRmmvCommonEventReferences,
  runRmmvDbCatalog,
  runRmmvEventContext,
  runRmmvEventFeedback,
  runRmmvEventEditor,
  runRmmvEventRegistry,
  runRmmvMapEditor,
  runRmmvMapEvents,
  runRmmvMapIndex,
  runRmmvPatch,
  runRmmvPluginInventory,
  runRmmvStateSlots,
} from "./rmmv-handlers.ts";

type RmmvDispatchHandler = (input: RmmvHandlerInput) => RmmvHandlerResult | Promise<RmmvHandlerResult>;

export const RMMV_TOOL_DISPATCH: Record<string, RmmvDispatchHandler> = {
  "event-context": runRmmvEventContext,
  "event-editor": runRmmvEventEditor,
  "event-registry": runRmmvEventRegistry,
  "map-editor": runRmmvMapEditor,
  patch: runRmmvPatch,
  "map-events": runRmmvMapEvents,
  "map-index": runRmmvMapIndex,
  "asset-inventory": runRmmvAssetInventory,
  "plugin-inventory": runRmmvPluginInventory,
  "db-catalog": runRmmvDbCatalog,
  "state-slots": runRmmvStateSlots,
  "common-event-references": runRmmvCommonEventReferences,
  "event-feedback": runRmmvEventFeedback,
};

export async function dispatchRmmvTool(command: string, input: RmmvHandlerInput): Promise<RmmvHandlerResult> {
  const handler = RMMV_TOOL_DISPATCH[command];
  if (!handler) throw new Error(`Unknown rmmv tool command: ${command}`);
  return handler(input);
}
