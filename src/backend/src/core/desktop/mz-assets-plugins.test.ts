import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { bootstrapDatabase } from "../db/bootstrap.ts";
import { closeDatabase } from "../db/pool.ts";
import { readJson, writeJson } from "../rmmv/json.ts";
import { RPG_MAKER_MZ_ENGINE_FILES } from "../rmmv/rpg-maker-engine.ts";
import {
  buildStagedAwareAssetInventory,
  importLocalAssetFiles,
  renameAsset,
} from "./asset-management-service.ts";
import { buildAssetReferenceGraph } from "./asset-reference-graph-service.ts";
import { buildProjectAssetCategoryTree, listProjectAssetCategory } from "./project-asset-browser-service.ts";
import { readPluginConfiguration, updatePluginParameters, validatePluginConfiguration } from "./plugin-management-service.ts";
import { withTestLanguage } from "../i18n/with-test-language.ts";

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

  test("importLocalAssetFiles writes immediately under MZ img/faces without www prefix", () => {
    fs.mkdirSync(path.join(project, "img", "faces"), { recursive: true });
    fs.writeFileSync(path.join(project, "img", "faces", "Actor1.png"), "face-before");
    const beforeTree = buildProjectAssetCategoryTree(root, project);
    const facesNode = findCategoryNode(beforeTree.nodes, "faces");
    assert.ok(facesNode);
    const beforeCount = facesNode.entryCount;

    const localFile = path.join(root, "import-source", "SandboxFace.png");
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, "sandbox-face-bytes");

    const batch = importLocalAssetFiles(root, project, {
      category: "faces",
      files: [{ sourceFile: localFile }],
    });
    assert.equal(batch.results.length, 1);
    assert.equal(batch.results[0]?.status, "imported");
    assert.equal(batch.results[0]?.relativePath, "img/faces/SandboxFace.png");

    const target = path.join(project, "img", "faces", "SandboxFace.png");
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.readFileSync(target, "utf8"), "sandbox-face-bytes");
    assert.equal(fs.existsSync(path.join(project, "www", "img", "faces", "SandboxFace.png")), false);

    const listing = listProjectAssetCategory(root, project, "faces");
    assert.equal(listing.entries.some((entry) => entry.name === "SandboxFace"), true);
    const afterTree = buildProjectAssetCategoryTree(root, project);
    const afterFaces = findCategoryNode(afterTree.nodes, "faces");
    assert.ok(afterFaces);
    assert.equal(afterFaces.entryCount, beforeCount + 1);

    const badFile = path.join(root, "import-source", "Bad.txt");
    fs.writeFileSync(badFile, "nope");
    const rejected = withTestLanguage(() => importLocalAssetFiles(root, project, {
      category: "faces",
      files: [{ sourceFile: badFile }],
    }));
    assert.equal(rejected.results[0]?.status, "failed");
    assert.match(rejected.results[0]?.error || "", /脸图/);
    assert.doesNotMatch(rejected.results[0]?.error || "", /\bfaces\b/);
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
    assert.equal(fs.existsSync(path.join(project, "effects", "battle", "Spark.efkefc")), false);
    assert.equal(fs.existsSync(path.join(project, "effects", "battle", "SparkRenamed.efkefc")), true);

    const sourceAnimations = readJson(path.join(project, "data", "Animations.json")) as Array<{ effectName?: string } | null>;
    assert.equal(sourceAnimations[1]?.effectName, "battle/SparkRenamed");
    const sourcePlugin = readPluginConfiguration(root, project).plugins.find((entry) => entry.name === "tools/SamplePlugin");
    assert.equal(sourcePlugin?.parameters.effect, "effects/battle/SparkRenamed.efkefc");
    assert.match(fs.readFileSync(path.join(project, "js", "plugins.js"), "utf8"), /effects\/battle\/SparkRenamed\.efkefc/);

    const renamedPicture = renameAsset(root, project, {
      scope: "project",
      category: "pictures",
      relativePath: "img/pictures/ui/Portrait.png",
    }, "ui/PortraitRenamed");
    assert.equal(renamedPicture.name, "ui/PortraitRenamed");
    assert.match(fs.readFileSync(path.join(project, "js", "plugins", "tools", "SamplePlugin.js"), "utf8"), /ui\/PortraitRenamed/);
    const sourceItems = readJson(path.join(project, "data", "Items.json")) as Array<{ note?: string } | null>;
    assert.equal(sourceItems[1]?.note, "<SampleImage:ui/PortraitRenamed>");
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
  * @on Enabled
  * @off Disabled
  * @default true
  *
  * @param enabledList
  * @type boolean[]
  * @on Enabled
  * @off Disabled
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
 * @param portraits
 * @type file[]
 * @dir img/pictures/
 *
 * @param actorId
 * @type actor
 *
 * @param classId
 * @type class
 *
 * @param skillId
 * @type skill
 *
 * @param itemId
 * @type item
 *
 * @param weaponId
 * @type weapon
 *
 * @param armorId
 * @type armor
 *
 * @param enemyId
 * @type enemy
 *
 * @param troopId
 * @type troop
 *
 * @param stateId
 * @type state
 *
 * @param animationId
 * @type animation
 *
 * @param tilesetId
 * @type tileset
 *
 * @param commonEventId
 * @type common_event
 *
 * @param switchId
 * @type switch
 *
 * @param variableId
 * @type variable
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
 *
 * @param unsupportedImage
 * @type image
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
    assert.deepEqual(fields.enabled.options, [
      { label: "Enabled", value: "true" },
      { label: "Disabled", value: "false" },
    ]);
    assert.equal(fields.enabledList.item?.kind, "boolean");
    assert.deepEqual(fields.enabledList.item?.options, [
      { label: "Enabled", value: "true" },
      { label: "Disabled", value: "false" },
    ]);
    assert.deepEqual(fields.mode.options?.map((option) => option.value), ["first", "second"]);
    assert.equal(fields.preset.kind, "combo");
    assert.deepEqual(fields.preset.options?.map((option) => option.value), ["Suggested"]);
    assert.equal(fields.title.parent, "root");
    assert.equal(fields.portrait.kind, "file");
    assert.equal(fields.portrait.directory, "img/pictures");
    assert.equal(fields.portraits.item?.kind, "file");
    assert.equal(fields.portraits.item?.directory, "img/pictures/");
    assert.deepEqual(
      Object.fromEntries([
        "actorId",
        "classId",
        "skillId",
        "itemId",
        "weaponId",
        "armorId",
        "enemyId",
        "troopId",
        "stateId",
        "animationId",
        "tilesetId",
        "commonEventId",
        "switchId",
        "variableId",
      ].map((key) => [key, fields[key].databaseTable])),
      {
        actorId: "Actors",
        classId: "Classes",
        skillId: "Skills",
        itemId: "Items",
        weaponId: "Weapons",
        armorId: "Armors",
        enemyId: "Enemies",
        troopId: "Troops",
        stateId: "States",
        animationId: "Animations",
        tilesetId: "Tilesets",
        commonEventId: "CommonEvents",
        switchId: "System.switches",
        variableId: "System.variables",
      },
    );
    assert.equal(fields.mapId.kind, "map");
    assert.equal(fields.point.kind, "location");
    assert.equal(fields.rows.item?.kind, "struct");
    assert.equal(fields.nested.item?.kind, "array");
    assert.equal(fields.mystery.editable, false);
    assert.equal(fields.unsupportedImage.editable, false);
    assert.match(fields.unsupportedImage.unsupportedReason || "", /@type image/);
    assert.equal(config.validation.ok, true);
    assert.throws(
      () => updatePluginParameters(root, project, 1, { mystery: "changed" }),
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

function findCategoryNode(
  nodes: Array<{ id: string; entryCount: number; children?: Array<{ id: string; entryCount: number }> }>,
  id: string,
): { id: string; entryCount: number } | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const child = findCategoryNode(node.children, id);
      if (child) return child;
    }
  }
  return null;
}

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
    advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
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
