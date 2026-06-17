import path from "path";
import { analyzeMapSpace, inspectMapCoordinate } from "../../rmmv/map-space.ts";
import { scanProject } from "../../rmmv/project-scanner.ts";

interface Anchor {
  id: string;
  x: number;
  y: number;
  tileClass: string;
  occupiedBy: string[];
  description: string;
}

interface Coordinate {
  x: number;
  y: number;
  inBounds: boolean;
  tileClass: string;
  occupiedBy: string[];
}

interface MapSpaceResult {
  anchors: Anchor[];
  findings: Finding[];
  [key: string]: unknown;
}

interface Finding {
  severity?: string;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EventContextResult {
  generatedAt: string;
  project: string;
  map: {
    id: number;
    name: string;
    width: number;
    height: number;
    eventCount: number;
  };
  event: {
    id: number;
    name: string;
    note: string;
    x: number;
    y: number;
    pageCount: number;
    pages: unknown[];
  };
  coordinate: {
    x: number;
    y: number;
    inBounds: boolean;
    tileClass: string;
    occupiedBy: string[];
  };
  anchors: {
    id: string;
    x: number;
    y: number;
    tileClass: string;
    occupiedBy: string[];
    description: string;
  }[];
  findings: Finding[];
  pageOrder: {
    rule: string;
    currentHighestPage: number;
    appendedPageNumber: number;
    risk: string;
  };
  appendPageEvidence: {
    kind: string;
    mapId: number;
    eventId: number;
    pageCount: number;
  };
  appendPageTemplate: {
    op: string;
    mapId: number;
    eventId: number;
    evidence: { kind: string; mapId: number; eventId: number; pageCount: number }[];
    page: {
      trigger: string;
      conditions: { selfSwitch: string };
      commands: { kind: string; text: string }[];
    };
  };
  reviewerChecklist: string[];
}

function buildEventContext(projectRoot: string, mapId: number, eventId: number): EventContextResult {
  assertInteger(mapId, "mapId", 1);
  assertInteger(eventId, "eventId", 1);
  const project: string = path.resolve(projectRoot);
  const index = scanProject(project);
  const map = index.maps.find((item) => item.id === mapId);
  if (!map) throw new Error(`Map ${mapId} not found in project index.`);
  if (!map.exists) throw new Error(`Map ${mapId}:${map.name || "(unnamed)"} has no readable map file.`);
  const event = map.events.find((item) => item.id === eventId);
  if (!event) throw new Error(`Event ${eventId} not found on map ${mapId}:${map.name || "(unnamed)"}.`);
  const mapSpace = analyzeMapSpace(project, mapId) as unknown as MapSpaceResult;
  const coordinate = inspectMapCoordinate(project, mapId, event.x, event.y) as unknown as Coordinate;
  const relatedAnchors: Anchor[] = mapSpace.anchors.filter((anchor: Anchor) => relatedToEvent(anchor, event));
  const relatedFindings: Finding[] = [
    ...index.audit.findings.filter((finding) => finding.details && finding.details.mapId === mapId && finding.details.eventId === eventId) as unknown as Finding[],
    ...mapSpace.findings.filter((finding: Finding) => finding.details && finding.details.eventId === eventId)
  ];

  return {
    generatedAt: new Date().toISOString(),
    project,
    map: {
      id: map.id,
      name: map.name || "",
      width: map.width,
      height: map.height,
      eventCount: map.eventCount
    },
    event: {
      id: event.id,
      name: event.name || "",
      note: event.note || "",
      x: event.x,
      y: event.y,
      pageCount: event.pageCount,
      pages: event.pages || []
    },
    coordinate: {
      x: coordinate.x,
      y: coordinate.y,
      inBounds: coordinate.inBounds,
      tileClass: coordinate.tileClass,
      occupiedBy: coordinate.occupiedBy
    },
    anchors: relatedAnchors.map((anchor: Anchor) => ({
      id: anchor.id,
      x: anchor.x,
      y: anchor.y,
      tileClass: anchor.tileClass,
      occupiedBy: anchor.occupiedBy,
      description: anchor.description
    })),
    findings: relatedFindings,
    pageOrder: {
      rule: "RPG Maker MV checks event pages from highest page number to lowest.",
      currentHighestPage: event.pageCount,
      appendedPageNumber: event.pageCount + 1,
      risk: "An appended page with no conditions can shadow all lower pages while its trigger is eligible."
    },
    appendPageEvidence: {
      kind: "event-context",
      mapId,
      eventId,
      pageCount: event.pageCount
    },
    appendPageTemplate: {
      op: "add-event-page",
      mapId,
      eventId,
      evidence: [{ kind: "event-context", mapId, eventId, pageCount: event.pageCount }],
      page: {
        trigger: "action-button",
        conditions: { selfSwitch: "A" },
        commands: [
          { kind: "text", text: "Draft appended page text." }
        ]
      }
    },
    reviewerChecklist: [
      "Check the highest existing page before adding a new page.",
      "Do not append an unconditional page unless shadowing all lower pages is intentional and reviewed.",
      "Confirm trigger, priority, and conditions against the original page stack.",
      "Check state-review when the appended page reads or writes switches, variables, self-switches, or common events."
    ]
  };
}

interface EventLike {
  id: number;
  name?: string;
  x: number;
  y: number;
}

function relatedToEvent(anchor: Anchor, event: EventLike): boolean {
  if (anchor.id === `event_${event.id}_${safeLabel(event.name || `event_${event.id}`)}`) return true;
  if (anchor.id.startsWith(`event_${event.id}_`)) return true;
  return anchor.x === event.x && anchor.y === event.y;
}

function safeLabel(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "unnamed";
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) throw new Error(`${label} must be an integer >= ${min}`);
}

export { buildEventContext };
