import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPlacementNote,
  normalizeContractImplementation,
} from "./event-placement-service.ts";

// 与 RPG-Agent-MV/ui/desktop/src/utils/placementEventDraft.ts 保持语义一致

function hasAbstractContractPages(pages?: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(pages) || !pages.length) return false;
  const first = pages[0];
  return Boolean(first && typeof first === "object" && Array.isArray((first as { commands?: unknown }).commands));
}

describe("placement event draft helpers", () => {
  it("detects abstract contract pages with commands[]", () => {
    assert.equal(hasAbstractContractPages([{ commands: [{ kind: "text", text: "hi" }] }]), true);
    assert.equal(hasAbstractContractPages([{ trigger: 0, list: [] }]), false);
    assert.equal(hasAbstractContractPages(undefined), false);
  });

  it("normalizeContractImplementation wraps top-level commands", () => {
    const pages = normalizeContractImplementation(
      { commands: [{ kind: "text", text: "Sample line" }] },
      "action-button",
    );
    assert.ok(pages);
    assert.equal(pages!.length, 1);
    assert.equal((pages![0] as { trigger?: string }).trigger, "action-button");
    assert.equal(hasAbstractContractPages(pages!), true);
  });

  it("buildPlacementNote keeps explicit note text without adding AIWF tokens", () => {
    const note = buildPlacementNote("fixture.plaque", "custom line\nAIWF:story:fixture.plaque");
    assert.equal(note.includes("AIWF:"), false);
    assert.match(note, /custom line/);
  });
});
