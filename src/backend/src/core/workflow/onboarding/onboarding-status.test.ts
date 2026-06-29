import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  aggregateOnboardingStatus,
  type OnboardingInput,
} from "./onboarding-status.ts";

function baseInput(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    project: "Project1",
    projectId: "project1",
    maps: [{ id: 1, name: "村庄", eventCount: 2 }],
    drifts: [],
    reconcileStatus: "clean",
    registryMapIds: [1],
    storyProject: { initialized: true, mode: "original" },
    awaitPlacementCount: 0,
    generatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("aggregateOnboardingStatus", () => {
  test("齐整工程 → clean，无建议动作", () => {
    const report = aggregateOnboardingStatus(baseInput());
    assert.equal(report.severity, "clean");
    assert.deepEqual(report.recommendedActions, []);
    assert.equal(report.maps.suspectedNew.length, 0);
  });

  test("孤儿事件分 tagged/untracked，并触发收编动作", () => {
    const report = aggregateOnboardingStatus(
      baseInput({
        drifts: [
          { code: "orphan-tagged", mapId: 1, eventId: 5, eventName: "EV_A", referencedId: "village.a" },
          { code: "orphan-untracked", mapId: 2, eventId: 3, eventName: "EV_B" },
        ],
        maps: [
          { id: 1, name: "村庄", eventCount: 2 },
          { id: 2, name: "森林", eventCount: 1 },
        ],
        registryMapIds: [1, 2],
      }),
    );
    assert.equal(report.severity, "needs-attention");
    assert.equal(report.registry.orphanTagged.length, 1);
    assert.equal(report.registry.orphanUntracked.length, 1);
    assert.equal(report.registry.orphanTagged[0].referencedId, "village.a");
    const adopt = report.recommendedActions.find((a) => a.type === "adopt-orphans");
    assert.ok(adopt);
    assert.equal(adopt.count, 2);
    // 含孤儿的地图被标为疑似新增
    assert.ok(report.maps.suspectedNew.some((m) => m.mapId === 1));
    assert.ok(report.maps.suspectedNew.some((m) => m.mapId === 2));
  });

  test("安全漂移单独计数，触发 apply-safe-drift", () => {
    const report = aggregateOnboardingStatus(
      baseInput({
        drifts: [
          { code: "status-stale-draft", mapId: 1, eventId: 1 },
          { code: "event-modified", mapId: 1, eventId: 3 },
        ],
      }),
    );
    assert.equal(report.registry.safeDriftCount, 1);
    const apply = report.recommendedActions.find((a) => a.type === "apply-safe-drift");
    assert.ok(apply);
    assert.equal(apply.count, 1);
    // event-modified 进入 drifts 分桶，但不算安全漂移
    assert.ok(report.registry.drifts.some((d) => d.code === "event-modified"));
  });



  test("找不到 data 目录（no-data-dir）→ blocked", () => {
    const report = aggregateOnboardingStatus(
      baseInput({ reconcileStatus: "no-data-dir", maps: [] }),
    );
    assert.equal(report.severity, "blocked");
  });

  test("剧情项目未初始化 → needs-attention 并建议 declare-story-project", () => {
    const report = aggregateOnboardingStatus(
      baseInput({ storyProject: { initialized: false } }),
    );
    assert.equal(report.severity, "needs-attention");
    assert.equal(report.storyProject.initialized, false);
    const declare = report.recommendedActions.find((a) => a.type === "declare-story-project");
    assert.ok(declare);
  });

  test("待放置 draft 契约 → 建议 await-placement", () => {
    const report = aggregateOnboardingStatus(
      baseInput({
        storyProject: { initialized: true, mode: "original" },
        awaitPlacementCount: 2,
      }),
    );
    const awaitPlacement = report.recommendedActions.find((a) => a.type === "await-placement");
    assert.ok(awaitPlacement);
    assert.equal(awaitPlacement?.count, 2);
    assert.equal(report.awaitPlacement.count, 2);
  });

  test("注册表空 → 有事件的地图全被标疑似新增", () => {
    const report = aggregateOnboardingStatus(
      baseInput({
        registryMapIds: [],
        maps: [
          { id: 1, name: "村庄", eventCount: 2 },
          { id: 2, name: "空图", eventCount: 0 },
        ],
      }),
    );
    // 有事件且无契约指向 → 疑似新增；空图不计入
    assert.equal(report.maps.suspectedNew.length, 1);
    assert.equal(report.maps.suspectedNew[0].mapId, 1);
    assert.ok(report.recommendedActions.some((a) => a.type === "confirm-new-maps"));
  });
});


