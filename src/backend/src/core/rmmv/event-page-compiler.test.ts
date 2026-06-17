import { test } from "node:test";
import assert from "node:assert";
import { compileCommands, decompileCommands, normalizeCommands } from "./event-page-compiler.ts";

interface Cmd {
  kind: string;
  [key: string]: unknown;
}

interface RawCompiledCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

function codesOf(commands: Cmd[]): number[] {
  return compileCommands(commands as never, null, "").map((c) => c.code);
}

function roundTrip(raw: RawCompiledCommand[]): { ast: Cmd[]; compiled: { code: number; indent: number; parameters: unknown[] }[]; unsupported: string[] } {
  const unsupported: string[] = [];
  const ast = decompileCommands(raw as never, {
    onUnsupportedReason: (reason) => unsupported.push(reason),
  }) as unknown as Cmd[];
  const compiled = compileCommands(ast, null, "");
  return { ast, compiled, unsupported };
}

test("change-gold compiles to code 125 with operation/value", () => {
  const codes = codesOf([{ kind: "change-gold", operation: "increase", value: 100 }]);
  assert.ok(codes.includes(125), "expected gold change command 125");
  const compiled = compileCommands([{ kind: "change-gold", operation: "decrease", value: 50 }] as never, null, "");
  const gold = compiled.find((c) => c.code === 125)!;
  assert.deepStrictEqual(gold.parameters, [1, 0, 50], "decrease → op=1, constant operand");
});

test("change-items compiles to code 126", () => {
  const compiled = compileCommands([{ kind: "change-items", itemId: 3, operation: "increase", value: 2 }] as never, null, "");
  const item = compiled.find((c) => c.code === 126)!;
  assert.deepStrictEqual(item.parameters, [3, 0, 0, 2]);
});

test("normalizeCommands rewrites change-items operation aliases (add/gain/0)", () => {
  for (const [operation, expectedOp] of [["add", 0], ["gain", 0], [0, 0], ["remove", 1], [1, 1]] as const) {
    const { commands } = normalizeCommands([{ kind: "change-items", itemId: 5, operation, value: 2 }]);
    const compiled = compileCommands(commands as never, null, "");
    const item = compiled.find((c) => c.code === 126)!;
    assert.deepStrictEqual(item.parameters, [5, expectedOp, 0, 2], `operation=${String(operation)}`);
  }
});

test("compileCommands normalizes give-item kind with add operation at placement time", () => {
  const compiled = compileCommands([{ kind: "give-item", itemId: 7, operation: "give", value: 1 }] as never, null, "");
  const item = compiled.find((c) => c.code === 126)!;
  assert.deepStrictEqual(item.parameters, [7, 0, 0, 1]);
});

test("normalizeCommands rewrites string/boolean/op-field operation variants", () => {
  for (const [operation, expectedOp] of [["0", 0], ["1", 1], [true, 0], [false, 1]] as const) {
    const { commands } = normalizeCommands([{ kind: "change-items", itemId: 2, operation, value: 1 }]);
    const compiled = compileCommands(commands as never, null, "");
    const item = compiled.find((c) => c.code === 126)!;
    assert.deepStrictEqual(item.parameters, [2, expectedOp, 0, 1], `operation=${String(operation)}`);
  }
  const { commands: fromOp } = normalizeCommands([{ kind: "change-items", itemId: 4, op: "add", value: 3 }]);
  assert.strictEqual((fromOp[0] as Cmd).operation, "increase");
});

test("normalizeCommands rewrites DeepSeek-style variants into compilable canonical form", () => {
  // 模拟模型常见的产出变体形态（虚构占位内容）：face 字符串、独立 when 兄弟、set-self-switch、change-gold.amount。
  const raw = [
    { kind: "text", text: "What is this?", face: "FaceA" },
    { kind: "wait", frames: 30 },
    { kind: "choice", choices: ["接受", "拒绝"], cancel: 2 },
    { kind: "when", choice: 1, commands: [
      { kind: "play-se", name: "Decision1" },
      { kind: "change-gold", amount: 100 },
      { kind: "set-self-switch", switch: "A", value: true }
    ] },
    { kind: "when", choice: 2, commands: [
      { kind: "text", text: "Maybe later.", face: "FaceB" },
      { kind: "show-balloon", target: "player", bubble: "..." }
    ] }
  ];
  const { commands } = normalizeCommands(raw);
  // when 折叠后顶层只剩 text/wait/choice 三条。
  assert.deepStrictEqual(commands.map((c) => (c as Cmd).kind), ["text", "wait", "choice"]);
  const choice = commands[2] as Cmd & { choices: { commands: Cmd[] }[]; cancelType: number };
  assert.strictEqual(choice.cancelType, 2, "cancel→cancelType");
  assert.strictEqual(choice.choices[0]!.commands.find((c) => c.kind === "self-switch")!.name, "A", "set-self-switch.switch→self-switch.name");
  // 整体能编译，且关键演出码齐全。
  const codes = codesOf(commands as Cmd[]);
  for (const code of [101, 230, 102, 250, 125, 123, 213]) {
    assert.ok(codes.includes(code), `expected RMMV code ${code} after normalize+compile`);
  }
});

test("normalizeCommands rewrites Mimo-style variants (face object / control-switches / play-se.sound / branch)", () => {
  const raw = [
    { kind: "text", text: "你好。", face: { characterName: "Hero", index: 2 } },
    { kind: "show-choices", choices: ["是", "否"] },
    { kind: "branch", branch: 1, commands: [
      { kind: "control-switches", target: [10, 10], value: true },
      { kind: "play-se", sound: { name: "Decision1", volume: 80 } }
    ] }
  ];
  const { commands } = normalizeCommands(raw);
  const text = commands[0] as Cmd;
  assert.strictEqual(text.faceName, "Hero", "face{}.characterName→faceName");
  assert.strictEqual(text.faceIndex, 2, "face{}.index→faceIndex");
  const choice = commands[1] as Cmd & { choices: { commands: Cmd[] }[] };
  const sw = choice.choices[0]!.commands.find((c) => c.kind === "switch") as Cmd;
  assert.strictEqual(sw.id, 10, "control-switches.target[0]→switch.id");
  const se = choice.choices[0]!.commands.find((c) => c.kind === "play-se") as Cmd;
  assert.strictEqual(se.name, "Decision1", "play-se.sound.name→play-se.name");
  assert.doesNotThrow(() => codesOf(commands as Cmd[]));
});

test("raw MV commands compile standard commands outside the high-level kind set", () => {
  const bgm = { name: "Theme1", volume: 90, pitch: 100, pan: 0 };
  const compiled = compileCommands([
    { kind: "mv-command", code: 103, indent: 0, parameters: [2, 4] },
    { kind: "raw-command", code: 117, indent: 0, parameters: [3] },
    { kind: "raw-command", code: 231, indent: 0, parameters: [1, "Portrait", 0, 0, 12, 16, 100, 100, 255, 0] },
    { kind: "mv-command", code: 241, indent: 0, parameters: [bgm] },
    { kind: "raw-command", code: 302, indent: 0, parameters: [0, 1, 0, 0, false] }
  ] as never, null, "");

  assert.deepStrictEqual(compiled.map((command) => command.code), [103, 117, 231, 241, 302, 0]);
  assert.deepStrictEqual(compiled[0].parameters, [2, 4]);
  assert.deepStrictEqual(compiled[3].parameters, [bgm]);
});

test("raw MV commands validate command code, parameter shape, and move-route commands", () => {
  assert.throws(
    () => compileCommands([{ kind: "raw-command", code: 999, indent: 0, parameters: [] }] as never, null, ""),
    /not a standard RPG Maker MV event command code/
  );
  assert.throws(
    () => compileCommands([{ kind: "mv-command", code: 103, indent: 0, parameters: ["2", 4] }] as never, null, ""),
    /variableId.*integer/
  );
  assert.doesNotThrow(() => compileCommands([{
    kind: "mv-command",
    code: 205,
    indent: 0,
    parameters: [0, { list: [{ code: 14, parameters: [1, -1] }, { code: 0, parameters: [] }], repeat: true, skippable: false, wait: true }]
  }] as never, null, ""));
  assert.throws(
    () => compileCommands([{
      kind: "mv-command",
      code: 205,
      indent: 0,
      parameters: [0, { list: [{ code: 46, parameters: [] }, { code: 0, parameters: [] }], repeat: true, skippable: false, wait: true }]
    }] as never, null, ""),
    /move route command code/
  );
});

test("decompile->compile round-trip for conditional branches keeps 411/412 structure and nested commands", () => {
  const raw: RawCompiledCommand[] = [
    { code: 111, indent: 0, parameters: [0, 5, 0] },
    { code: 121, indent: 1, parameters: [12, 12, 0] },
    { code: 411, indent: 0, parameters: [] },
    { code: 123, indent: 1, parameters: ["A", 0] },
    { code: 412, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled, unsupported } = roundTrip(raw);
  const branch = ast[0] as Cmd & { kind: string; condition?: unknown; then?: unknown[]; else?: unknown[] };
  assert.equal(branch.kind, "conditional-branch");
  assert.equal((branch.condition as { kind?: string }).kind, "switch");
  assert.deepStrictEqual(branch.then?.length, 1);
  assert.deepStrictEqual(branch.else?.length, 1);
  assert.deepStrictEqual(compiled, raw);
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 121")));
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 123")));
});

test("decompile->compile round-trip keeps empty conditional else markers", () => {
  const raw: RawCompiledCommand[] = [
    { code: 111, indent: 0, parameters: [0, 5, 0] },
    { code: 411, indent: 0, parameters: [] },
    { code: 412, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const branch = ast[0] as Cmd & { else?: unknown[]; hasElse?: boolean };
  assert.equal(branch.kind, "conditional-branch");
  assert.deepStrictEqual(branch.else, []);
  assert.equal(branch.hasElse, true);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip for loops keeps 413 terminator and body", () => {
  const raw: RawCompiledCommand[] = [
    { code: 112, indent: 0, parameters: [] },
    { code: 230, indent: 1, parameters: [20] },
    { code: 413, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  assert.equal((ast[0] as Cmd).kind, "loop");
  assert.deepStrictEqual((ast[0] as { commands?: unknown[] }).commands?.length, 1);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip for choice with choice/cancel branches", () => {
  const raw: RawCompiledCommand[] = [
    { code: 102, indent: 0, parameters: [["接受", "拒绝"], 2, 0, 2, 0] },
    { code: 402, indent: 0, parameters: [0, "接受"] },
    { code: 121, indent: 1, parameters: [12, 12, 0] },
    { code: 402, indent: 0, parameters: [1, "拒绝"] },
    { code: 123, indent: 1, parameters: ["A", 0] },
    { code: 403, indent: 0, parameters: [] },
    { code: 230, indent: 1, parameters: [40] },
    { code: 404, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled, unsupported } = roundTrip(raw);
  const choice = ast[0] as Cmd & { choices?: { commands?: unknown[] }[]; cancelCommands?: unknown[]; cancelType?: number };
  assert.equal(choice.kind, "choice");
  assert.equal(choice.cancelType, 2);
  assert.equal(choice.choices?.length, 2);
  assert.equal(choice.choices?.[0]!.commands?.length, 1);
  assert.equal(choice.choices?.[1]!.commands?.length, 1);
  assert.equal(choice.cancelCommands?.length, 1);
  assert.deepStrictEqual(compiled, raw);
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 121")));
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 123")));
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 230")));
});

test("decompile->compile round-trip keeps empty choice cancel branches", () => {
  const raw: RawCompiledCommand[] = [
    { code: 102, indent: 0, parameters: [["接受", "拒绝"], 2, 0, 2, 0] },
    { code: 402, indent: 0, parameters: [0, "接受"] },
    { code: 402, indent: 0, parameters: [1, "拒绝"] },
    { code: 403, indent: 0, parameters: [] },
    { code: 404, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const choice = ast[0] as Cmd & { cancelCommands?: unknown[]; hasCancelBranch?: boolean };
  assert.equal(choice.kind, "choice");
  assert.deepStrictEqual(choice.cancelCommands, []);
  assert.equal(choice.hasCancelBranch, true);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip for battle branches keeps onWin/onEscape/onLose", () => {
  const raw: RawCompiledCommand[] = [
    { code: 301, indent: 0, parameters: [0, 3, true, false] },
    { code: 601, indent: 0, parameters: [] },
    { code: 230, indent: 1, parameters: [16] },
    { code: 602, indent: 0, parameters: [] },
    { code: 121, indent: 1, parameters: [4, 4, 0] },
    { code: 603, indent: 0, parameters: [] },
    { code: 123, indent: 1, parameters: ["B", 0] },
    { code: 604, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const battle = ast[0] as Cmd & {
    onWin?: unknown[];
    onEscape?: unknown[];
    onLose?: unknown[];
  };
  assert.equal(battle.kind, "battle");
  assert.equal(battle.onWin?.length, 1);
  assert.equal(battle.onEscape?.length, 1);
  assert.equal(battle.onLose?.length, 1);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip keeps empty battle branch markers", () => {
  const raw: RawCompiledCommand[] = [
    { code: 301, indent: 0, parameters: [0, 3, true, true] },
    { code: 601, indent: 0, parameters: [] },
    { code: 602, indent: 0, parameters: [] },
    { code: 603, indent: 0, parameters: [] },
    { code: 604, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const battle = ast[0] as Cmd & {
    onWin?: unknown[];
    onEscape?: unknown[];
    onLose?: unknown[];
    hasWinBranch?: boolean;
    hasEscapeBranch?: boolean;
    hasLoseBranch?: boolean;
  };
  assert.equal(battle.kind, "battle");
  assert.deepStrictEqual(battle.onWin, []);
  assert.deepStrictEqual(battle.onEscape, []);
  assert.deepStrictEqual(battle.onLose, []);
  assert.equal(battle.hasWinBranch, true);
  assert.equal(battle.hasEscapeBranch, true);
  assert.equal(battle.hasLoseBranch, true);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip for shop goods continuation lines", () => {
  const raw: RawCompiledCommand[] = [
    { code: 302, indent: 0, parameters: [0, 1, 0, 100, false] },
    { code: 605, indent: 0, parameters: [0, 2, 0, 200] },
    { code: 605, indent: 0, parameters: [1, 3, 1, 50] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled, unsupported } = roundTrip(raw);
  const shop = ast[0] as Cmd & { goods?: { goodsType?: number; itemId?: number; priceType?: number; price?: number }[] };
  assert.equal(shop.kind, "shop");
  assert.equal(shop.goods?.length, 3);
  assert.deepStrictEqual(compiled, raw);
  assert.deepStrictEqual(unsupported, []);
});

test("decompile->compile round-trip for text keeps face and window parameters", () => {
  const raw: RawCompiledCommand[] = [
    { code: 101, indent: 0, parameters: ["Actor1", 2, 1, 0] },
    { code: 401, indent: 0, parameters: ["Line one"] },
    { code: 401, indent: 0, parameters: ["Line two"] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const text = ast[0] as Cmd & { faceName?: unknown; faceIndex?: unknown; background?: unknown; position?: unknown };
  assert.equal(text.kind, "text");
  assert.equal(text.faceName, "Actor1");
  assert.equal(text.faceIndex, 2);
  assert.equal(text.background, 1);
  assert.equal(text.position, 0);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile->compile round-trip for move route keeps 505 continuation lines when present", () => {
  const route = {
    list: [
      { code: 1, parameters: [] },
      { code: 15, parameters: [12] },
      { code: 0, parameters: [] },
    ],
    repeat: false,
    skippable: true,
    wait: true,
  };
  const raw: RawCompiledCommand[] = [
    { code: 205, indent: 0, parameters: [0, route] },
    { code: 505, indent: 0, parameters: [{ code: 1, parameters: [] }] },
    { code: 505, indent: 0, parameters: [{ code: 15, parameters: [12] }] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled } = roundTrip(raw);
  const moveRoute = ast[0] as Cmd & { continuationCommands?: boolean; route?: unknown[] };
  assert.equal(moveRoute.kind, "move-route");
  assert.equal(moveRoute.continuationCommands, true);
  assert.equal(moveRoute.route?.length, 2);
  assert.deepStrictEqual(compiled, raw);
});

test("decompile keeps unsupported but standard move route commands as raw with reason", () => {
  const route = {
    list: [
      { code: 14, parameters: [1, -1] },
      { code: 0, parameters: [] },
    ],
    repeat: false,
    skippable: true,
    wait: true,
  };
  const raw: RawCompiledCommand[] = [
    { code: 205, indent: 0, parameters: [0, route] },
    { code: 505, indent: 0, parameters: [{ code: 14, parameters: [1, -1] }] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled, unsupported } = roundTrip(raw);
  assert.equal(ast[0]!.kind, "raw-command");
  assert.ok((ast[0] as { reason?: string }).reason?.includes("Unsupported move-route step code 14"));
  assert.equal(ast[1]!.kind, "raw-command");
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported move-route step code 14")));
  assert.deepStrictEqual(compiled, raw);
});

test("decompile does not skip unsupported multiline commands such as script continuations", () => {
  const raw: RawCompiledCommand[] = [
    { code: 355, indent: 0, parameters: ["const a = 1;"] },
    { code: 655, indent: 0, parameters: ["console.log(a);"] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const { ast, compiled, unsupported } = roundTrip(raw);
  assert.equal(ast[0]!.kind, "raw-command");
  assert.equal(ast[1]!.kind, "raw-command");
  assert.ok(unsupported.some((reason) => reason.includes("Unsupported command code 355")));
  assert.deepStrictEqual(compiled, raw);
});

test("decompile preserves unsupported commands as raw with reason", () => {
  const raw: RawCompiledCommand[] = [
    { code: 205, indent: 0, parameters: [0, { list: [{ code: 1, parameters: [] }, { code: 15, parameters: [12] }, { code: 0, parameters: [] }], repeat: false, skippable: true, wait: true }] },
    { code: 356, indent: 0, parameters: ["Test:Open"] },
    { code: 117, indent: 0, parameters: [9] },
    { code: 1176 as any, indent: 0, parameters: ["unknown"] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const unsupported: string[] = [];
  const ast = decompileCommands(raw as never, {
    onUnsupportedReason: (reason) => unsupported.push(reason),
  }) as unknown as Cmd[];
  assert.equal(ast[0]!.kind, "move-route");
  assert.equal(ast[1]!.kind, "plugin");
  assert.equal(ast[2]!.kind, "common-event");
  assert.equal(ast[3]!.kind, "raw-command");
  assert.equal((ast[3] as { reason?: string }).reason !== undefined, true);
  assert.ok((ast[3] as { reason?: string }).reason!.length > 0);
  assert.ok(unsupported[0].includes("1176"));
});

test("decompile preserves unsupported branch-nested raw commands with explicit reason", () => {
  const raw: RawCompiledCommand[] = [
    { code: 111, indent: 0, parameters: [0, 8, 0] },
    { code: 999, indent: 1, parameters: [] },
    { code: 412, indent: 0, parameters: [] },
    { code: 0, indent: 0, parameters: [] },
  ];
  const unsupported: string[] = [];
  const ast = decompileCommands(raw as never, {
    onUnsupportedReason: (reason) => unsupported.push(reason),
  }) as unknown as Cmd[];
  const branch = ast[0] as Cmd & { then?: unknown[] };
  assert.equal(branch.kind, "conditional-branch");
  const nested = branch.then?.[0] as { kind?: string; reason?: string };
  assert.equal(nested?.kind, "raw-command");
  assert.equal(typeof nested?.reason, "string");
  assert.ok(unsupported.length >= 1);
  assert.ok(nested.reason && nested.reason.length > 0);
});
