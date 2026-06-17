import { test } from "node:test";
import assert from "node:assert";
import { renderEventScript, type EventScriptLine } from "./event-script.ts";

function texts(lines: EventScriptLine[]): string[] {
  return lines.map((line) => line.text);
}

test("renders dialogue with speaker from faceName", () => {
  const model = renderEventScript({
    id: "village.well.pray",
    rmmvTarget: { trigger: "action-button", eventName: "EV_well" },
    implementation: {
      commands: [{ kind: "text", text: "Looks like a sample prop.", faceName: "Actor1", faceIndex: 0 }],
    },
  });
  assert.strictEqual(model.pages.length, 1);
  assert.strictEqual(model.pages[0].triggerLabel, "调查触发");
  const line = model.pages[0].lines[0];
  assert.strictEqual(line.kind, "dialogue");
  assert.strictEqual(line.speaker, "Actor1");
  assert.strictEqual(line.text, "Looks like a sample prop.");
});

test("choice options nest their branch commands one indent deeper", () => {
  const model = renderEventScript({
    id: "c",
    rmmvTarget: { trigger: "action-button" },
    implementation: {
      commands: [
        {
          kind: "choice",
          cancelType: -1,
          choices: [
            { text: "投一枚硬币", commands: [{ kind: "change-gold", operation: "decrease", value: 10 }] },
            { text: "还是算了", commands: [] },
          ],
        },
      ],
    },
  });
  const lines = model.pages[0].lines;
  assert.strictEqual(lines[0].kind, "choice-prompt");
  const option = lines.find((l) => l.kind === "choice-option" && l.text === "投一枚硬币")!;
  assert.strictEqual(option.indent, 0);
  const gold = lines.find((l) => l.kind === "effect")!;
  assert.strictEqual(gold.indent, 1, "branch command sits one indent deeper than its option");
  assert.strictEqual(gold.text, "金钱 −10");
});

test("AIWF marker comments are hidden; empty page falls back to a placeholder", () => {
  const model = renderEventScript({
    id: "marker",
    rmmvTarget: { trigger: "parallel" },
    implementation: {
      commands: [{ kind: "comment", text: "AIWF:event-contract:marker" }],
    },
  });
  assert.strictEqual(model.pages[0].lines.length, 1);
  assert.strictEqual(model.pages[0].lines[0].kind, "comment");
  assert.match(model.pages[0].lines[0].text, /无可见演出/);
});

test("normalizes model variants before rendering (show-text→text, gain→increase)", () => {
  const model = renderEventScript({
    id: "n",
    rmmvTarget: { trigger: "action-button" },
    implementation: {
      commands: [
        { kind: "show-text", text: "拿去吧。" },
        { kind: "change-gold", operation: "gain", value: 30 },
      ],
    },
  });
  const lines = model.pages[0].lines;
  assert.strictEqual(lines[0].kind, "dialogue");
  assert.strictEqual(lines[0].text, "拿去吧。");
  assert.strictEqual(lines[1].text, "金钱 +30");
});

test("multi-page contract reports per-page trigger and self-switch condition", () => {
  const model = renderEventScript({
    id: "two",
    rmmvTarget: { trigger: "parallel" },
    implementation: {
      pages: [
        { trigger: "parallel", commands: [{ kind: "self-switch", name: "A", value: true }] },
        { trigger: "action-button", conditions: { selfSwitch: "A" }, commands: [{ kind: "text", text: "完成了。" }] },
      ],
    },
  });
  assert.strictEqual(model.pages.length, 2);
  assert.strictEqual(model.pages[0].lines[0].text, "自开关 A = 开");
  assert.strictEqual(model.pages[1].triggerLabel, "调查触发");
  assert.match(model.pages[1].conditionLabel || "", /自开关 A=开/);
  assert.strictEqual(texts(model.pages[1].lines)[0], "完成了。");
});
