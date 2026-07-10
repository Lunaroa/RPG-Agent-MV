import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readJson, writeJson } from "./json.ts";

test("RMMV MCP stdio exposes editor tools with truthful annotations", async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-mcp-server-"));
  const project = createProjectFixture(workflowRoot);
  const client = new Client({ name: "rmmv-mcp-test", version: "1.0.0" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.AGENT_RPG_ROOT = workflowRoot;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", path.join(import.meta.dirname, "rmmv-mcp-server.ts")],
    env,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));

    assert.deepEqual([...tools.keys()].sort(), ["RmmvEvent", "RmmvMap", "RmmvMemory", "RmmvReadContext", "RmmvStage", "RmmvWorkflow"]);
    assert.equal(tools.get("RmmvMemory")?.annotations?.readOnlyHint, false);
    assert.equal(tools.get("RmmvReadContext")?.annotations?.readOnlyHint, true);
    assert.equal(tools.get("RmmvMap")?.annotations?.readOnlyHint, false);
    assert.equal(tools.get("RmmvMap")?.annotations?.destructiveHint, true);
    assert.equal(tools.get("RmmvEvent")?.annotations?.readOnlyHint, false);
    // 工作流发起工具：本身标记会写（readOnlyHint:false，确保只读子 agent 拿不到、不套娃），
    // schema 收 AI 现写的脚本而非预设名。
    assert.equal(tools.get("RmmvWorkflow")?.annotations?.readOnlyHint, false);
    const workflowSchema = JSON.stringify(tools.get("RmmvWorkflow")?.inputSchema || {});
    assert.match(workflowSchema, /script/);
    assert.match(workflowSchema, /summary/);
    assert.doesNotMatch(workflowSchema, /writing-review/);
    assert.match(tools.get("RmmvWorkflow")?.description || "", /read-only/i);
    // 待放置事件登记工具：会写（readOnlyHint:false），只登记不放置，schema 只暴露 validate/register。
    assert.equal(tools.get("RmmvStage")?.annotations?.readOnlyHint, false);
    const stageSchema = JSON.stringify(tools.get("RmmvStage")?.inputSchema || {});
    assert.match(stageSchema, /stage\.register/);
    assert.doesNotMatch(stageSchema, /stage\.adopt|editor|patch/);
    assert.match(tools.get("RmmvStage")?.description || "", /never places|NEVER places/i);
    const memorySchema = JSON.stringify(tools.get("RmmvMemory")?.inputSchema || {});
    assert.match(memorySchema, /memory\.read-profile/);
    assert.match(memorySchema, /memory\.write-profile/);
    assert.match(memorySchema, /progress\.write/);
    const eventSchema = JSON.stringify(tools.get("RmmvEvent")?.inputSchema || {});
    assert.match(eventSchema, /rmmvTarget/);
    assert.match(eventSchema, /implementation/);
    assert.match(tools.get("RmmvEvent")?.description || "", /desktop map canvas/i);
    assert.match(tools.get("RmmvEvent")?.description || "", /Never use editor\.update/i);

    const mapData = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "mapData", project, mapId: 1 },
    }));
    assert.equal(mapData.data.map.width, 2);

    const assetInventory = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "assetInventory", project },
    }));
    assert.equal(assetInventory.data.summary.animations.total, 0);

    const pluginInventory = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "pluginInventory", project },
    }));
    assert.equal(pluginInventory.data.summary.installedPlugins, 0);

    // RmmvMemory: write a durable note, then read it back through the path-locked tool.
    const memWrite = parseToolJson(await client.callTool({
      name: "RmmvMemory",
      arguments: { action: "memory.write", project, name: "Elder voice", description: "archaic diction", type: "character", body: "Speaks formally." },
    }));
    assert.match(memWrite.summary, /Saved memory "elder-voice"/);
    const memRead = parseToolJson(await client.callTool({
      name: "RmmvMemory",
      arguments: { action: "memory.read", project, relPath: "topics/elder-voice.md" },
    }));
    assert.match(memRead.summary, /Speaks formally/);
    const profileWrite = parseToolJson(await client.callTool({
      name: "RmmvMemory",
      arguments: { action: "memory.write-profile", project, body: "Prefers concise notes." },
    }));
    assert.match(profileWrite.summary, /Updated the shared author profile/);
    const profileRead = parseToolJson(await client.callTool({
      name: "RmmvMemory",
      arguments: { action: "memory.read-profile", project },
    }));
    assert.match(profileRead.data.content, /Prefers concise notes/);
    const progressWrite = parseToolJson(await client.callTool({
      name: "RmmvMemory",
      arguments: { action: "progress.write", project, sessionId: "runtime-session-1", status: "pass", current: "Finished memory write.", next: "Continue testing." },
    }));
    assert.match(progressWrite.summary, /Updated current progress/);

    const painted = parseToolJson(await client.callTool({
      name: "RmmvMap",
      arguments: {
        action: "paint",
        project,
        mapId: 1,
        edits: [{ x: 0, y: 0, layer: 0, tileId: 7 }],
      },
    }));
    assert.equal(painted.data.changedCells, 1);
    const stagedMapData = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "mapData", project, mapId: 1 },
    }));
    assert.equal(stagedMapData.data.map.data[0], 7);
    assert.equal((readJson(path.join(project, "www", "data", "Map001.json")) as any).data[0], 0);

    await client.callTool({
      name: "RmmvMap",
      arguments: { action: "discardProject", project },
    });
    const discardedMapData = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "mapData", project, mapId: 1 },
    }));
    assert.equal(discardedMapData.data.map.data[0], 0);

    const patchWithoutSpec = await client.callTool({
      name: "RmmvEvent",
      arguments: { action: "patch.apply", project },
    }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    assert.equal(patchWithoutSpec.isError, true);
    assert.match(patchWithoutSpec.content?.[0]?.text || "", /Missing spec/);

    const invalidRegister = await client.callTool({
      name: "RmmvEvent",
      arguments: {
        action: "registry.register",
        project,
        contract: {
          engine: "rpg-maker-mv",
          kind: "EventContract",
          id: "town.elder.intro",
          purpose: "Register should fail without a target.",
          implementation: { commands: [{ kind: "text", text: "Hello" }] },
        },
      },
    }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    assert.equal(invalidRegister.isError, true);
    assert.match(invalidRegister.content?.[0]?.text || "", /rmmvTarget/);

    const validRegister = parseToolJson(await client.callTool({
      name: "RmmvEvent",
      arguments: {
        action: "registry.register",
        project,
        contract: {
          engine: "rpg-maker-mv",
          kind: "EventContract",
          id: "town.elder.intro",
          purpose: "Register a reviewing elder NPC event for manual placement.",
          rmmvTarget: {
            operation: "add-map-event",
            mapId: 1,
            eventName: "EV_ElderIntro",
            trigger: "action-button",
          },
          implementation: {
            commands: [{ kind: "text", text: "The northern road is unsafe." }],
          },
        },
      },
    }));
    assert.equal(validRegister.data.status, "ok");
    assert.equal(validRegister.data.contract.id, "town.elder.intro");
    assert.equal(validRegister.data.contract.status, "reviewing");

    const feedbackSummary = parseToolJson(await client.callTool({
      name: "RmmvEvent",
      arguments: { action: "feedback.summary", project },
    }));
    assert.equal(feedbackSummary.data.total, 0);
  } finally {
    await client.close();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test("RmmvReadContext exposes paginated database catalog and entry reads as read-only", async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-mcp-db-read-"));
  const project = createProjectFixture(workflowRoot);
  const client = new Client({ name: "rmmv-mcp-test", version: "1.0.0" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.AGENT_RPG_ROOT = workflowRoot;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", path.join(import.meta.dirname, "rmmv-mcp-server.ts")],
    env,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const readContext = listed.tools.find((tool) => tool.name === "RmmvReadContext");
    assert.ok(readContext);
    assert.equal(readContext.annotations?.readOnlyHint, true);
    assert.match(readContext.description || "", /dbEntry/);

    const schema = readContext.inputSchema as {
      properties?: Record<string, { enum?: string[]; minimum?: number; maximum?: number }>;
    };
    assert.ok(schema.properties?.action.enum?.includes("dbEntry"));
    assert.deepEqual(schema.properties?.table.enum, [
      "actors", "classes", "skills", "items", "weapons", "armors", "enemies", "troops",
      "states", "animations", "tilesets", "commonEvents", "system", "types", "terms",
    ]);
    assert.equal(schema.properties?.offset.minimum, 0);
    assert.equal(schema.properties?.limit.minimum, 1);
    assert.equal(schema.properties?.limit.maximum, 200);
    assert.ok(schema.properties?.includeUnnamed);

    const catalog = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: {
        action: "dbCatalog",
        project,
        tables: ["system"],
        offset: 0,
        limit: 1,
        includeUnnamed: true,
      },
    }));
    assert.deepEqual(catalog.data.pageInfo.system, {
      total: 1,
      matched: 1,
      offset: 0,
      limit: 1,
      nextOffset: null,
    });

    const entry = parseToolJson(await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "dbEntry", project, table: "system", id: 0 },
    }));
    assert.equal(entry.data.table, "system");
    assert.equal(entry.data.group, "System");
    assert.equal(entry.data.id, 0);
    assert.deepEqual(entry.data.value.switches, [null]);
  } finally {
    await client.close();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test("RMMV MCP stdio exposes localised map errors when mapId is invalid", async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-mcp-server-"));
  const project = createProjectFixture(workflowRoot);
  const client = new Client({ name: "rmmv-mcp-test", version: "1.0.0" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.AGENT_RPG_ROOT = workflowRoot;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", path.join(import.meta.dirname, "rmmv-mcp-server.ts")],
    env,
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const mapNotFound = await client.callTool({
      name: "RmmvReadContext",
      arguments: { action: "mapData", project, mapId: 999 },
    });

    assert.equal(mapNotFound.isError, true);
    const message = mapNotFound.content?.[0]?.text || "";
    assert.match(message, /Map not found: 999/);
    assert.doesNotMatch(message, /outside an IPC request scope/);
  } finally {
    await client.close();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test("stage.register rejects forged placed/verified status (read-only subagent cannot self-place)", async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmmv-mcp-server-"));
  const project = createProjectFixture(workflowRoot);
  const client = new Client({ name: "rmmv-mcp-test", version: "1.0.0" });
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.AGENT_RPG_ROOT = workflowRoot;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-strip-types", path.join(import.meta.dirname, "rmmv-mcp-server.ts")],
    env,
    stderr: "pipe",
  });

  const baseContract = {
    engine: "rpg-maker-mv",
    kind: "EventContract",
    id: "town.elder.intro",
    purpose: "Register a reviewing elder NPC event for manual placement.",
    rmmvTarget: { operation: "add-map-event", mapId: 1, eventName: "EV_ElderIntro", trigger: "action-button" },
    implementation: { commands: [{ kind: "text", text: "The northern road is unsafe." }] },
  };

  try {
    await client.connect(transport);

    // placed 必须被拒：只读子 agent 不能伪造"已放置"身份绕过桌面放置流程。
    const placedRejected = await client.callTool({
      name: "RmmvStage",
      arguments: { action: "stage.register", project, contract: { ...baseContract, status: "placed" } },
    }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    assert.equal(placedRejected.isError, true);
    assert.match(placedRejected.content?.[0]?.text || "", /placed/);

    // verified 同理。
    const verifiedRejected = await client.callTool({
      name: "RmmvStage",
      arguments: { action: "stage.register", project, contract: { ...baseContract, status: "verified" } },
    }) as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
    assert.equal(verifiedRejected.isError, true);
    assert.match(verifiedRejected.content?.[0]?.text || "", /verified/);

    // 正常草稿登记仍可用，落盘状态为 draft/reviewing（add-map-event 默认 reviewing）。
    const draftOk = parseToolJson(await client.callTool({
      name: "RmmvStage",
      arguments: { action: "stage.register", project, contract: { ...baseContract, status: "draft" } },
    }));
    assert.equal(draftOk.data.status, "ok");
    assert.equal(draftOk.data.contract.status, "draft");
  } finally {
    await client.close();
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

function parseToolJson(result: unknown): any {
  const value = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (value.isError) throw new Error(value.content?.[0]?.text || "MCP tool call failed.");
  const content = value.content?.[0];
  if (!content || content.type !== "text" || typeof content.text !== "string") {
    throw new Error("Expected MCP text result.");
  }
  return JSON.parse(content.text);
}

function createProjectFixture(workflowRoot: string): string {
  const project = path.join(workflowRoot, "projects", "Project");
  const dataDir = path.join(project, "www", "data");
  writeJson(path.join(dataDir, "MapInfos.json"), [
    null,
    { id: 1, name: "Start", parentId: 0, order: 1, expanded: true },
  ]);
  writeJson(path.join(dataDir, "Tilesets.json"), [
    null,
    { id: 1, name: "Outside", mode: 1, tilesetNames: [], flags: [] },
  ]);
  writeJson(path.join(dataDir, "System.json"), { switches: [null], variables: [null] });
  writeJson(path.join(dataDir, "Map001.json"), {
    width: 2,
    height: 2,
    tilesetId: 1,
    data: Array(24).fill(0),
    events: [null],
  });
  return project;
}
