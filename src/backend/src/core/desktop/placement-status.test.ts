import assert from "node:assert/strict";
import { describe, it } from "node:test";

// 与 RPG-Agent-MV/ui/desktop/src/utils/placementStatus.ts 保持语义一致（桌面端无独立 test runner）
function isPlacedStatus(status?: string | null): boolean {
  return status === "placed" || status === "verified";
}

function isPlacementEventDone(event: {
  status?: string | null;
  placedEventId?: number | null;
  x?: number | null;
  y?: number | null;
}): boolean {
  if (isPlacedStatus(event.status)) return true;
  const hasCoords = Number.isInteger(event.x) && Number.isInteger(event.y);
  return event.placedEventId != null && hasCoords;
}

function allPlacementEventsPlaced(events: Array<{ status?: string; placedEventId?: number | null; x?: number | null; y?: number | null }> | undefined): boolean {
  const list = events || [];
  return list.length > 0 && list.every((e) => isPlacementEventDone(e));
}

describe("event placement status helpers", () => {
  it("treats placed and verified as done", () => {
    assert.equal(isPlacedStatus("placed"), true);
    assert.equal(isPlacedStatus("verified"), true);
    assert.equal(isPlacedStatus("draft"), false);
  });

  it("requires every event placed before continue", () => {
    assert.equal(
      allPlacementEventsPlaced([
        { status: "placed" },
        { status: "draft" },
      ]),
      false,
    );
    assert.equal(
      allPlacementEventsPlaced([
        { status: "placed" },
        { status: "verified" },
      ]),
      true,
    );
    assert.equal(allPlacementEventsPlaced([]), false);
  });

  it("accepts placedEventId with coordinates when status is still draft", () => {
    assert.equal(
      allPlacementEventsPlaced([
        { status: "draft", placedEventId: 4, x: 8, y: 12 },
      ]),
      true,
    );
  });

  it("excludes coordinate-placed draft events from missingContractIds", () => {
    const events = [
      { contractId: "test.tavern-owner-greeting", status: "draft", placedEventId: 4, x: 8, y: 12 },
      { contractId: "test.other", status: "draft" },
    ];
    const missingContractIds = events
      .filter((event) => !isPlacementEventDone(event))
      .map((event) => String((event as { contractId?: string }).contractId || ""))
      .filter(Boolean);
    assert.deepEqual(missingContractIds, ["test.other"]);
  });
});
