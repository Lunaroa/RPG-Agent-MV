import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import { buildStagedAwareAssetInventory, renameAsset } from "./asset-management-service.ts";
import { buildAssetReferenceGraph } from "./asset-reference-graph-service.ts";
import { readPluginConfiguration, updatePluginParameters, validatePluginConfiguration } from "./plugin-management-service.ts";
import { getProjectFileForRead } from "./staging-service.ts";

describe("MZ nested assets and plugin declarations", { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rpg-agent-mz-assets-"));
    project = path.join(root, "projects", "sample");
    writeMZProject(project);
    await bootstrapDatabase(root, {
      dbPath: path.join(root, "data", "test.db"),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("tracks and safely renames nested pictures and particle effects", () => {
    const graph = buildAssetReferenceGraph(root, project);
    assert.equal(graph.assets.some((asset) => asset.category === "pictures" && asset.name === "ui/Portrait"), true);
    assert.equal(graph.references.some((reference) => reference.category === "pictures" && reference.name === "ui/Portrait"), true);
    assert.equal(graph.assets.some((asset) => asset.category === "effects" && asset.name === "battle/Spark"), true);
    assert.equal(graph.references.some((reference) => reference.category === "effects" && reference.name === "battle/Spark"), true);
    assert.equal(graph.references.some((reference) => (
      reference.category === "pictures"
      && reference.name === "ui/Portrait"
      && reference.source === "Plugin parameter"
    )), true);
    assert.equal(graph.references.some((reference) => (
      reference.category === "pictures"
      && reference.name === "ui/Portrait"
      && reference.source.startsWith("Plugin note declaration")
    )), true);
    assert.equal(graph.references.some((reference) => (
      reference.category === "effects"
      && reference.name === "battle/Spark"
      && reference.source === "Plugin parameter"
    )), true);

    const inventory = buildStagedAwareAssetInventory(root, project);
    assert.deepEqual(inventory.effects.names, ["battle/Spark"]);
    assert.equal(inventory.animations[0]?.kind, "particle");
    assert.deepEqual(inventory.animations[0]?.missingEffects, []);
    assert.equal(inventory.summary.animations.withMissingEffects, 0);

    const renamed = renameAsset(root, project, {
      scope: "project",
      category: "effects",
      relativePath: "effects/battle/Spark.efkefc",
    }, "battle/SparkRenamed");
    assert.equal(renamed.name, "battle/SparkRenamed");
    assert.equal(fs.existsSync(path.join(project, "effects", "battle", "Spark.efkefc")), true);
    assert.equal(getProjectFileForRead(root, project, "effects/battle/Spark.efkefc"), null);
    assert.ok(getProjectFileForRead(root, project, "effects/battle/SparkRenamed.efkefc"));

    const stagedAnimationsFile = getProjectFileForRead(root, project, "data/Animations.json");
    const stagedAnimations = readJson(stagedAnimationsFile!) as Array<{ effectName?: string } | null>;
    assert.equal(stagedAnimations[1]?.effectName, "battle/SparkRenamed");
    const stagedPlugin = readPluginConfiguration(root, project).plugins.find((entry) => entry.name === "tools/SamplePlugin");
    assert.equal(stagedPlugin?.parameters.effect, "effects/battle/SparkRenamed.efkefc");
    const sourceAnimations = readJson(path.join(project, "data", "Animations.json")) as Array<{ effectName?: string } | null>;
    assert.equal(sourceAnimations[1]?.effectName, "battle/Spark");
    assert.match(fs.readFileSync(path.join(project, "js", "plugins.js"), "utf8"), /effects\/battle\/Spark\.efkefc/);

    const renamedPicture = renameAsset(root, project, {
      scope: "project",
      category: "pictures",
      relativePath: "img/pictures/ui/Portrait.png",
    }, "ui/PortraitRenamed");
    assert.equal(renamedPicture.name, "ui/PortraitRenamed");
    const stagedPluginSource = getProjectFileForRead(root, project, "js/plugins/tools/SamplePlugin.js");
    assert.match(fs.readFileSync(stagedPluginSource!, "utf8"), /ui\/PortraitRenamed/);
    assert.match(fs.readFileSync(path.join(project, "js", "plugins", "tools", "SamplePlugin.js"), "utf8"), /ui\/Portrait/);
    const stagedItemsFile = getProjectFileForRead(root, project, "data/Items.json");
    const stagedItems = readJson(stagedItemsFile!) as Array<{ note?: string } | null>;
    assert.equal(stagedItems[1]?.note, "<SampleImage:ui/PortraitRenamed>");
    const sourceItems = readJson(path.join(project, "data", "Items.json")) as Array<{ note?: string } | null>;
    assert.equal(sourceItems[1]?.note, "<SampleImage:ui/Portrait>");
  });

  test("summarizes missing MZ particle effects separately from compatibility sheets", () => {
    fs.unlinkSync(path.join(project, "effects", "battle", "Spark.efkefc"));

    const inventory = buildStagedAwareAssetInventory(root, project);

    assert.equal(inventory.summary.animations.withMissingEffects, 1);
    assert.equal(inventory.summary.animations.withMissingSheets, 0);
    assert.deepEqual(inventory.animations[0]?.missingEffects, ["battle/Spark"]);
  });

  test("parses nested MZ plugin targets, commands and argument declarations", () => {
    const config = readPluginConfiguration(root, project);
    const plugin = config.plugins.find((entry) => entry.name === "tools/SamplePlugin");
    assert.ok(plugin);
    assert.equal(plugin.fileExists, true);
    assert.deepEqual(plugin.targets, ["MZ"]);
    assert.deepEqual(plugin.dependencies?.requiredAssets, ["img/pictures/ui/Portrait"]);
    assert.deepEqual(plugin.dependencies?.noteAssets, [{
      parameter: "SampleImage",
      directory: "img/pictures",
      type: "file",
      data: "items",
    }]);
    assert.equal(config.pluginFiles.some((file) => file.fileName === "tools/SamplePlugin.js"), true);

    const command = plugin.commandHints.find((hint) => hint.command === "openPanel");
    assert.equal(command?.source, "mz-command-header");
    assert.equal(command?.displayName, "Open Panel");
    assert.equal(command?.evidence, "* @command openPanel");
    assert.equal(plugin.commandHints.some((hint) => hint.command === "localizedPanel"), false);
    assert.deepEqual(command?.arguments, [{
      name: "actorId",
      key: "actorId",
      label: "Actor",
      description: "Actor used by the sample command.",
      kind: "database",
      rawType: "actor",
      databaseTable: "Actors",
      defaultValue: "1",
    }]);
    assert.equal(config.validation.ok, true);

    writePlugin(path.join(project, "js", "plugins", "legacy", "OnlyMV.js"), `/*:
 * @target MV
 * @plugindesc MV-only sample.
 */
`);
    writePluginsJs(project, [{ name: "legacy/OnlyMV", status: true, description: "MV only", parameters: {} }]);
    const validation = validatePluginConfiguration(root, project);
    assert.equal(validation.ok, false);
    assert.equal(validation.issues.some((issue) => issue.code === "plugin-engine-target-mismatch"), true);
  });

  test("parses official parameter types and validates dependencies without rewriting unsupported values", () => {
    writePlugin(path.join(project, "js", "plugins", "BasePlugin.js"), `/*:
 * @target MZ
 * @plugindesc Base sample.
 */
`);
    writePlugin(path.join(project, "js", "plugins", "LastPlugin.js"), `/*:
 * @target MZ
 * @plugindesc Last sample.
 */
`);
    writePlugin(path.join(project, "js", "plugins", "TypedPlugin.js"), `/*:
 * @target MZ
 * @plugindesc Typed sample.
 * @base BasePlugin
 * @orderAfter BasePlugin
 * @orderBefore LastPlugin
 * @requiredAssets img/pictures/ui/Portrait
 *
  * @param root
  * @type string
  * @default Root
  *
  * @param title
  * @type string
  * @parent root
 * @default Sample
 *
 * @param details
 * @type multiline_string
 *
  * @param amount
  * @type number
 * @min 0
 * @max 10
  * @decimals 2
  *
  * @param enabled
  * @type boolean
  * @default true
  *
  * @param mode
  * @type select
  * @option First
  * @value first
  * @option Second
  * @value second
  *
  * @param preset
  * @type combo
  * @option Suggested
  *
 * @param portrait
 * @type file
 * @dir img/pictures
 *
 * @param actorId
 * @type actor
 *
 * @param mapId
 * @type map
 *
 * @param point
 * @type location
 *
 * @param rows
 * @type struct<Row>[]
 *
 * @param nested
 * @type number[][]
 *
 * @param mystery
 * @type custom_type
 */
/*~struct~Row:
 * @param enabled
 * @type boolean
 * @default true
 */
`);
    writePluginsJs(project, [
      { name: "BasePlugin", status: true, description: "", parameters: {} },
      { name: "TypedPlugin", status: true, description: "", parameters: { mystery: "keep" } },
      { name: "LastPlugin", status: true, description: "", parameters: {} },
    ]);

    const config = readPluginConfiguration(root, project);
    const plugin = config.plugins.find((entry) => entry.name === "TypedPlugin")!;
    assert.deepEqual(plugin.dependencies, {
      base: ["BasePlugin"],
      orderAfter: ["BasePlugin"],
      orderBefore: ["LastPlugin"],
      requiredAssets: ["img/pictures/ui/Portrait"],
      noteAssets: [],
    });
    const fields = Object.fromEntries((plugin.parameterSchema?.fields || []).map((field) => [field.key, field]));
    assert.equal(fields.details.kind, "multiline");
    assert.equal(fields.amount.decimals, 2);
    assert.equal(fields.enabled.kind, "boolean");
    assert.deepEqual(fields.mode.options?.map((option) => option.value), ["first", "second"]);
    assert.equal(fields.preset.kind, "combo");
    assert.deepEqual(fields.preset.options?.map((option) => option.value), ["Suggested"]);
    assert.equal(fields.title.parent, "root");
    assert.equal(fields.portrait.kind, "file");
    assert.equal(fields.portrait.directory, "img/pictures");
    assert.equal(fields.actorId.databaseTable, "Actors");
    assert.equal(fields.mapId.kind, "map");
    assert.equal(fields.point.kind, "location");
    assert.equal(fields.rows.item?.kind, "struct");
    assert.equal(fields.nested.item?.kind, "array");
    assert.equal(fields.mystery.editable, false);
    assert.equal(config.validation.ok, true);
    assert.throws(
      () => updatePluginParameters(root, project, "TypedPlugin", { mystery: "changed" }),
      /must be preserved unchanged/,
    );

    writePluginsJs(project, [
      { name: "TypedPlugin", status: true, description: "", parameters: { mystery: "keep" } },
      { name: "BasePlugin", status: true, description: "", parameters: {} },
      { name: "LastPlugin", status: true, description: "", parameters: {} },
    ]);
    assert.equal(validatePluginConfiguration(root, project).issues.some((issue) => issue.code === "plugin-base-order-invalid"), true);
  });
});

function writeMZProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "game.rmmzproject"), "RPGMZ", "utf8");
  for (const relative of RPG_MAKER_MZ_ENGINE_FILES) {
    const file = path.join(project, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const content = relative === "js/rmmz_core.js"
      ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
      : relative === "package.json"
        ? '{"main":"index.html"}'
        : "";
    fs.writeFileSync(file, content, "utf8");
  }
  for (const directory of ["audio", "fonts", "img/pictures/ui", "movies", "effects/battle", "js/plugins/tools"]) {
    fs.mkdirSync(path.join(project, ...directory.split("/")), { recursive: true });
  }
  fs.writeFileSync(path.join(project, "img", "pictures", "ui", "Portrait.png"), "png", "utf8");
  fs.writeFileSync(path.join(project, "effects", "battle", "Spark.efkefc"), "effect", "utf8");

  writeJson(path.join(project, "data", "System.json"), {
    tileSize: 48,
    faceSize: 144,
    iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624 },
  });
  writeJson(path.join(project, "data", "Animations.json"), [null, {
    id: 1,
    name: "Sample Particle",
    effectName: "battle/Spark",
    flashTimings: [],
    soundTimings: [],
  }]);
  writeJson(path.join(project, "data", "MapInfos.json"), [null, { id: 1, name: "Sample Map" }]);
  writeJson(path.join(project, "data", "Items.json"), [null, {
    id: 1,
    name: "Sample Item",
    note: "<SampleImage:ui/Portrait>",
  }]);
  writeJson(path.join(project, "data", "Map001.json"), {
    width: 1,
    height: 1,
    tilesetId: 0,
    data: Array(6).fill(0),
    events: [null, {
      id: 1,
      name: "Sample Event",
      pages: [{
        image: { characterName: "", characterIndex: 0 },
        list: [
          { code: 231, indent: 0, parameters: [1, "ui/Portrait", 0, 0, 0, 0, 100, 100, 255, 0] },
          { code: 0, indent: 0, parameters: [] },
        ],
      }],
    }],
  });

  writePlugin(path.join(project, "js", "plugins", "tools", "SamplePlugin.js"), `/*:ja
 * @target MZ
 * @plugindesc Localized command sample.
 * @command localizedPanel
 * @text Localized Panel
 */
/*:
 * @target MZ
 * @plugindesc MZ command sample.
 * @requiredAssets img/pictures/ui/Portrait
 * @noteParam SampleImage
 * @noteDir img/pictures
 * @noteType file
 * @noteData items
 *
 * @command openPanel
 * @text Open Panel
 *
 * @arg actorId
 * @text Actor
 * @desc Actor used by the sample command.
 * @type actor
 * @default 1
 */
`);
  writePluginsJs(project, [{
    name: "tools/SamplePlugin",
    status: true,
    description: "MZ command sample",
    parameters: {
      portrait: "img/pictures/ui/Portrait.png",
      effect: "effects/battle/Spark.efkefc",
    },
  }]);
}

function writePlugin(file: string, source: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, "utf8");
}

function writePluginsJs(project: string, plugins: unknown[]): void {
  fs.writeFileSync(
    path.join(project, "js", "plugins.js"),
    `var $plugins =\n${JSON.stringify(plugins, null, 2)};\n`,
    "utf8",
  );
}
