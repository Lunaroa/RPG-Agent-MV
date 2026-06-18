export interface EventRef {
  mapId: number;
  eventId: number;
}

export interface ParsedArgs {
  // string 值
  project?: string;
  projectId?: string;
  agent?: string;
  profile?: string;
  before?: string;
  after?: string;
  out?: string;
  outProject?: string;
  spec?: string;
  contract?: string;
  contractId?: string;
  proof?: string;
  evidence?: string;
  scene?: string;
  status?: string;
  id?: string;
  format?: string;
  match?: string;
  slot?: string;
  assetId?: string;
  tags?: string;
  verdict?: string;
  session?: string;
  fromTags?: string;
  toTags?: string;
  excludeTags?: string;
  phase?: string;
  assetLibrary?: string;
  scope?: string;
  library?: string;
  role?: string;
  addEntry?: string;
  intent?: string;
  taskId?: string;
  creationMode?: string;
  contextMode?: string;
  targetSpec?: string;
  review?: string;
  bundle?: string;
  decision?: string;
  reviewer?: string;
  notes?: string;
  command?: string;
  label?: string;
  host?: string;
  kimiEnv?: string;
  llmEnv?: string;
  tool?: string;
  playability?: string;
  runtimeTest?: string;
  runtimeMode?: string;
  workspaceRoot?: string;
  browser?: string;
  nwjs?: string;
  target?: string;
  selector?: string;
  testId?: string;
  text?: string;
  key?: string;
  condition?: string;
  expect?: string;
  modifiers?: string;
  failureKind?: string;
  purpose?: string;
  "initial-switch"?: string;
  "initial-var"?: string;
  // number 值
  "rendered-map-id"?: number;
  x?: number;
  y?: number;
  mapId?: number;
  targetMapId?: number;
  tilesetId?: number;
  size?: number;
  stride?: number;
  scale?: number;
  atX?: number;
  atY?: number;
  batchSize?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  cropWidth?: number;
  cropHeight?: number;
  maxCrops?: number;
  limit?: number;
  startX?: number;
  startY?: number;
  eventId?: number;
  maxPreviewWidth?: number;
  maxPreviewHeight?: number;
  switches?: number;
  variables?: number;
  commonEvents?: number;
  port?: number;
  maxRetries?: number;
  timeoutMs?: number;
  waitMs?: number;
  probe?: boolean;
  probeKeywords?: string[];
  // 数组值
  files?: string[];
  mapIds?: number[];
  eventRefs?: EventRef[];
  // boolean 标志
  dryRun?: boolean;
  apply?: boolean;
  applyEventCommandOps?: boolean;
  replaceOutput?: boolean;
  refreshIndex?: boolean;
  allowBlocked?: boolean;
  localOnly?: boolean;
  useLlm?: boolean;
  prepareOnly?: boolean;
  skipKnowledgeRefresh?: boolean;
  summary?: boolean;
  overwriteZero?: boolean;
  allowReferenceBlockCopy?: boolean;
  allowMapStructural?: boolean;
  agentMode?: boolean;
  wait?: boolean;
  capture?: boolean;
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") {
      parsed.project = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--project-id") {
      parsed.projectId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--file") {
      parsed.files = [...(parsed.files || []), requireValue(args, index, arg)];
      index += 1;
    } else if (arg === "--agent") {
      parsed.agent = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--profile") {
      parsed.profile = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--before") {
      parsed.before = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--after") {
      parsed.after = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--out") {
      parsed.out = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--out-project") {
      parsed.outProject = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--spec") {
      parsed.spec = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--contract") {
      parsed.contract = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--contract-id") {
      parsed.contractId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--proof") {
      parsed.proof = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--evidence") {
      parsed.evidence = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--rendered-map-id") {
      parsed["rendered-map-id"] = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--scene") {
      parsed.scene = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--status") {
      parsed.status = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--id") {
      parsed.id = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--format") {
      parsed.format = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--x") {
      parsed.x = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--y") {
      parsed.y = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--map-id") {
      const mapId = parseInteger(requireValue(args, index, arg), arg);
      parsed.mapId = mapId;
      parsed.mapIds = [...(parsed.mapIds || []), mapId];
      index += 1;
    } else if (arg === "--target-map-id") {
      parsed.targetMapId = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--tileset") {
      parsed.tilesetId = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--size") {
      parsed.size = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--stride") {
      parsed.stride = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--scale") {
      parsed.scale = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--at-x") {
      parsed.atX = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--at-y") {
      parsed.atY = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--match") {
      parsed.match = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--slot") {
      parsed.slot = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--asset-id") {
      parsed.assetId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--tags") {
      parsed.tags = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--verdict") {
      parsed.verdict = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--session") {
      parsed.session = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--from-tags") {
      parsed.fromTags = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--to-tags") {
      parsed.toTags = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--exclude-tags") {
      parsed.excludeTags = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--phase") {
      parsed.phase = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--batch-size") {
      parsed.batchSize = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--min-width") {
      parsed.minWidth = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--min-height") {
      parsed.minHeight = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-width") {
      parsed.maxWidth = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-height") {
      parsed.maxHeight = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--crop-width") {
      parsed.cropWidth = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--crop-height") {
      parsed.cropHeight = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-crops") {
      parsed.maxCrops = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--asset-library") {
      parsed.assetLibrary = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--scope") {
      parsed.scope = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--library") {
      parsed.library = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--role") {
      parsed.role = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--add-entry") {
      parsed.addEntry = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--start-x") {
      parsed.startX = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--start-y") {
      parsed.startY = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--event-id") {
      parsed.eventId = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--event") {
      parsed.eventRefs = [...(parsed.eventRefs || []), parseEventRef(requireValue(args, index, arg), arg)];
      index += 1;
    } else if (arg === "--intent") {
      parsed.intent = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--task-id") {
      parsed.taskId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--creation-mode") {
      parsed.creationMode = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--context-mode") {
      parsed.contextMode = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--target-spec") {
      parsed.targetSpec = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--review") {
      parsed.review = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--bundle") {
      parsed.bundle = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--decision") {
      parsed.decision = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--reviewer") {
      parsed.reviewer = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--notes") {
      parsed.notes = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--command") {
      parsed.command = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--label") {
      parsed.label = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--max-preview-width") {
      parsed.maxPreviewWidth = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-preview-height") {
      parsed.maxPreviewHeight = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--switches") {
      parsed.switches = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--variables") {
      parsed.variables = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--common-events") {
      parsed.commonEvents = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--port") {
      parsed.port = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--host") {
      parsed.host = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--tool") {
      parsed.tool = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--kimi-env") {
      parsed.kimiEnv = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--llm-env") {
      parsed.llmEnv = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--playability") {
      parsed.playability = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--runtime-test") {
      parsed.runtimeTest = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--runtime-mode") {
      parsed.runtimeMode = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--workspace-root") {
      parsed.workspaceRoot = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--max-retries") {
      parsed.maxRetries = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--wait-ms") {
      parsed.waitMs = parseInteger(requireValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--probe") {
      parsed.probe = true;
    } else if (arg === "--probe-keywords") {
      const raw = requireValue(args, index, arg);
      parsed.probeKeywords = raw
        .split(",")
        .map((keyword: string) => keyword.trim())
        .filter((keyword: string) => keyword.length > 0);
      index += 1;
    } else if (arg === "--browser") {
      parsed.browser = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--nwjs") {
      parsed.nwjs = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--target") {
      parsed.target = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--selector") {
      parsed.selector = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--test-id") {
      parsed.testId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--text") {
      parsed.text = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--key") {
      parsed.key = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--condition") {
      parsed.condition = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--expect") {
      parsed.expect = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--modifiers") {
      parsed.modifiers = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--failure-kind") {
      parsed.failureKind = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--purpose") {
      parsed.purpose = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--initial-switch") {
      parsed["initial-switch"] = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--initial-var") {
      parsed["initial-var"] = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--apply-event-command-ops") {
      parsed.applyEventCommandOps = true;
    } else if (arg === "--replace-output") {
      parsed.replaceOutput = true;
    } else if (arg === "--refresh-index") {
      parsed.refreshIndex = true;
    } else if (arg === "--allow-blocked") {
      parsed.allowBlocked = true;
    } else if (arg === "--local-only") {
      parsed.localOnly = true;
    } else if (arg === "--use-llm") {
      parsed.useLlm = true;
    } else if (arg === "--prepare-only") {
      parsed.prepareOnly = true;
    } else if (arg === "--skip-knowledge-refresh") {
      parsed.skipKnowledgeRefresh = true;
    } else if (arg === "--summary") {
      parsed.summary = true;
    } else if (arg === "--overwrite-zero") {
      parsed.overwriteZero = true;
    } else if (arg === "--allow-reference-block-copy") {
      parsed.allowReferenceBlockCopy = true;
    } else if (arg === "--allow-map-structural") {
      parsed.allowMapStructural = true;
    } else if (arg === "--agent-mode") {
      parsed.agentMode = true;
    } else if (arg === "--wait") {
      parsed.wait = true;
    } else if (arg === "--capture") {
      parsed.capture = true;
    } else if (arg === "--no-capture") {
      parsed.capture = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

export function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

export function parseInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Value for ${flag} must be an integer`);
  return parsed;
}

export function parseEventRef(value: string, flag: string): EventRef {
  const match = /^(\d+):(\d+)$/.exec(String(value || ""));
  if (!match) throw new Error(`Value for ${flag} must be formatted as <mapId>:<eventId>`);
  const mapId = Number(match[1]);
  const eventId = Number(match[2]);
  if (!Number.isInteger(mapId) || mapId < 1 || !Number.isInteger(eventId) || eventId < 1) {
    throw new Error(`Value for ${flag} must contain integer IDs >= 1`);
  }
  return { mapId, eventId };
}
