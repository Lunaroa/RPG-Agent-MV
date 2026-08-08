import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandDisplay, type MvCommand } from './useEventEditor.ts';

// Regression coverage for the "stray digits" bug: command codes that previously
// fell through to `commandDisplay`'s generic fallback dumped raw
// `JSON.stringify(parameters)` after the label (e.g. "Change Transparency: [1]").
// Each code below must now render an RM-native, human-readable summary instead.
const cmd = (code: number, parameters: unknown[]): MvCommand => ({ code, indent: 0, parameters });

describe('commandDisplay renders RM-native summaries (no raw param dump)', () => {
  test('Change Transparency (211) shows ON/OFF, not [1]', () => {
    assert.equal(commandDisplay(cmd(211, [0])).label, '◆Change Transparency: ON');
    assert.equal(commandDisplay(cmd(211, [1])).label, '◆Change Transparency: OFF');
  });

  test('Change Items (126) shows item id + operation + amount, not [1,0,0,1]', () => {
    assert.equal(commandDisplay(cmd(126, [1, 0, 0, 1])).label, '◆Change Items: #1, Increase 1');
    assert.equal(commandDisplay(cmd(126, [3, 1, 0, 2])).label, '◆Change Items: #3, Decrease 2');
  });

  test('Change Weapons/Armors (127/128) reuse the operand rendering', () => {
    assert.equal(commandDisplay(cmd(127, [1, 0, 0, 1, false])).label, '◆Change Weapons: #1, Increase 1');
    assert.equal(commandDisplay(cmd(128, [1, 0, 0, 1, false])).label, '◆Change Armors: #1, Increase 1');
  });

  test('Change Party Member (129) shows actor + add/remove', () => {
    assert.equal(commandDisplay(cmd(129, [1, 0, false])).label, '◆Change Party Member: #1, Add');
  });

  test('Actor stat commands (311/312/313/315/316/317/318/326) target Entire Party / Fixed Actor', () => {
    assert.equal(commandDisplay(cmd(311, [0, 0, 0, 0, 50, false])).label, '◆Change HP: Entire Party, Increase 50');
    assert.equal(commandDisplay(cmd(312, [0, 2, 0, 0, 30])).label, '◆Change MP: Actor #2, Increase 30');
    assert.equal(commandDisplay(cmd(326, [1, 3, 1, 0, 10])).label, '◆Change TP: Party Member #3, Decrease 10');
    assert.equal(commandDisplay(cmd(313, [0, 1, 0, 4])).label, '◆Change State: Actor #1, Add #4');
    assert.equal(commandDisplay(cmd(315, [1, 1, 0, 0, 100, false])).label, '◆Change EXP: Party Member #1, Increase 100');
    assert.equal(commandDisplay(cmd(316, [1, 1, 1, 0, 1, false])).label, '◆Change Level: Party Member #1, Decrease 1');
    assert.equal(commandDisplay(cmd(317, [1, 1, 2, 0, 0, 5])).label, '◆Change Parameter: Party Member #1, Attack, Increase 5');
    assert.equal(commandDisplay(cmd(318, [0, 1, 1, 8])).label, '◆Change Skill: Actor #1, Forget #8');
  });

  test('Change Equipment (319) uses slot label', () => {
    assert.equal(commandDisplay(cmd(319, [1, 0, 3])).label, '◆Change Equipment: #1, Weapon #3');
    assert.equal(commandDisplay(cmd(319, [1, 2, 5])).label, '◆Change Equipment: #1, Head #5');
  });

  test('Change Name/Class/Nickname/Profile/Images (320/321/322/324/325)', () => {
    assert.equal(commandDisplay(cmd(320, [1, 'Harold'])).label, '◆Change Name: #1, Harold');
    assert.equal(commandDisplay(cmd(321, [1, 1, false])).label, '◆Change Class: #1, class #1');
    assert.equal(commandDisplay(cmd(324, [1, 'Hal'])).label, '◆Change Nickname: #1, Hal');
    assert.equal(commandDisplay(cmd(325, [1, 'A hero.'])).label, '◆Change Profile: #1, A hero.');
    assert.equal(commandDisplay(cmd(322, [1, 'Actor1', 0, 'Actor1', 0, ''])).label, '◆Change Actor Images: #1, Actor1(0), Actor1(0)');
  });

  test('Message group (103/104/105)', () => {
    assert.equal(commandDisplay(cmd(103, [1, 4])).label, '◆Input Number: Variable #1, 4 digits');
    assert.equal(commandDisplay(cmd(104, [1, 2])).label, '◆Select Item: Variable #1, Key Item');
    assert.equal(commandDisplay(cmd(105, [2, false])).label, '◆Show Scrolling Text: speed 2');
  });

  test('Control Timer (124) start/stop + seconds', () => {
    assert.equal(commandDisplay(cmd(124, [0, 60])).label, '◆Control Timer: Start 60s');
    assert.equal(commandDisplay(cmd(124, [1, 0])).label, '◆Control Timer: Stop');
  });

  test('Movement group (202/203/204)', () => {
    assert.equal(commandDisplay(cmd(202, [0, 0, 1, 5, 10])).label, '◆Set Vehicle Location: Boat, (5,10)');
    assert.equal(commandDisplay(cmd(203, [0, 0, 5, 10, 0])).label, '◆Set Event Location: This Event, (5,10)');
    assert.equal(commandDisplay(cmd(203, [0, 1, 1, 2, 0]), { variables: ['', 'Map X', 'Map Y'] }).label, '◆Set Event Location: This Event, ({0001 Map X},{0002 Map Y})');
    assert.equal(commandDisplay(cmd(204, [2, 1, 4, false])).label, '◆Scroll Map: Down, 1 (speed 4)');
  });

  test('Change Player Followers (216) ON/OFF', () => {
    assert.equal(commandDisplay(cmd(216, [0])).label, '◆Change Player Followers: ON');
    assert.equal(commandDisplay(cmd(216, [1])).label, '◆Change Player Followers: OFF');
  });

  test('Picture group (233/234/235)', () => {
    assert.equal(commandDisplay(cmd(233, [1, 5])).label, '◆Rotate Picture: #1, speed 5');
    assert.equal(commandDisplay(cmd(234, [1, [0, 0, 0, 0], 60, true])).label, '◆Tint Picture: #1');
    assert.equal(commandDisplay(cmd(235, [1])).label, '◆Erase Picture: #1');
  });

  test('Set Weather Effect (236) translates type strings', () => {
    assert.equal(commandDisplay(cmd(236, ['none', 5, 60, true])).label, '◆Set Weather Effect: None, power 5');
    assert.equal(commandDisplay(cmd(236, ['rain', 5, 60, true])).label, '◆Set Weather Effect: Rain, power 5');
    assert.equal(commandDisplay(cmd(236, ['storm', 8, 60, true])).label, '◆Set Weather Effect: Storm, power 8');
    assert.equal(commandDisplay(cmd(236, ['snow', 3, 60, true])).label, '◆Set Weather Effect: Snow, power 3');
  });

  test('Audio/Video group (241/242/245/246/249/261) summarises audio objects', () => {
    const audio = { name: 'Theme', volume: 90, pitch: 100, pan: 0 };
    assert.equal(commandDisplay(cmd(241, [audio])).label, '◆Play BGM: Theme (V90 P100)');
    assert.equal(commandDisplay(cmd(242, [10])).label, '◆Fadeout BGM: 10s');
    assert.equal(commandDisplay(cmd(245, [audio])).label, '◆Play BGS: Theme (V90 P100)');
    assert.equal(commandDisplay(cmd(246, [10])).label, '◆Fadeout BGS: 10s');
    assert.equal(commandDisplay(cmd(249, [audio])).label, '◆Play ME: Theme (V90 P100)');
    assert.equal(commandDisplay(cmd(261, ['intro.mp4'])).label, '◆Play Movie: intro.mp4');
  });

  test('Scene Control group (301/302/303)', () => {
    assert.equal(commandDisplay(cmd(301, [0, 1, true, false])).label, '◆Battle Processing: Direct #1');
    assert.equal(commandDisplay(cmd(301, [1, 2, true, false]), { variables: ['', 'Unused', 'Troop ID'] }).label, '◆Battle Processing: Variable {0002 Troop ID}');
    assert.equal(commandDisplay(cmd(302, [0, 1, 0, 0, false])).label, '◆Shop Processing');
    assert.equal(commandDisplay(cmd(303, [1, 8])).label, '◆Name Input Processing: #1, 8 chars');
  });

  test('System Settings group (132/133/134-137/138/139/140/323)', () => {
    const audio = { name: 'Battle', volume: 90, pitch: 100, pan: 0 };
    assert.equal(commandDisplay(cmd(132, [audio])).label, '◆Change Battle BGM: Battle (V90 P100)');
    assert.equal(commandDisplay(cmd(133, [audio])).label, '◆Change Victory ME: Battle (V90 P100)');
    assert.equal(commandDisplay(cmd(139, [audio])).label, '◆Change Defeat ME: Battle (V90 P100)');
    assert.equal(commandDisplay(cmd(140, [0, audio])).label, '◆Change Vehicle BGM: Boat, Battle (V90 P100)');
    assert.equal(commandDisplay(cmd(134, [0])).label, '◆Change Save Access: Disable');
    assert.equal(commandDisplay(cmd(135, [1])).label, '◆Change Menu Access: Enable');
    assert.equal(commandDisplay(cmd(136, [0])).label, '◆Change Encounter: Disable');
    assert.equal(commandDisplay(cmd(137, [1])).label, '◆Change Formation Access: Enable');
    assert.equal(commandDisplay(cmd(138, [[0, 0, 0, 0]])).label, '◆Change Window Color');
    assert.equal(commandDisplay(cmd(323, [0, 'Vehicle', 0])).label, '◆Change Vehicle Image: Boat, Vehicle(0)');
  });

  test('Map group (281/282/283/284/285)', () => {
    assert.equal(commandDisplay(cmd(281, [0])).label, '◆Change Map Name Display: ON');
    assert.equal(commandDisplay(cmd(282, [1])).label, '◆Change Tileset: #1');
    assert.equal(commandDisplay(cmd(283, ['bg1', 'bg2'])).label, '◆Change Battle Back: bg1/bg2');
    assert.equal(commandDisplay(cmd(284, ['p', false, false, 0, 0])).label, '◆Change Parallax: p');
    assert.equal(commandDisplay(cmd(285, [1, 0, 0, 0, 0])).label, '◆Get Location Info: Variable #1, Terrain Tag, (0,0)');
    assert.equal(commandDisplay(cmd(285, [1, 5, 1, 1, 2]), { variables: ['', 'Map X', 'Map Y'] }).label, '◆Get Location Info: Variable #1, Region ID, ({0001 Map X},{0002 Map Y})');
  });

  test('Battle group (331-337/339/342) renders enemy index', () => {
    assert.equal(commandDisplay(cmd(331, [-1, 0, 0, 100, false])).label, '◆Change Enemy HP: All Enemies, Increase 100');
    assert.equal(commandDisplay(cmd(332, [0, 0, 0, 50])).label, '◆Change Enemy MP: #1, Increase 50');
    assert.equal(commandDisplay(cmd(342, [0, 1, 0, 10])).label, '◆Change Enemy TP: #1, Decrease 10');
    assert.equal(commandDisplay(cmd(333, [-1, 0, 1])).label, '◆Change Enemy State: All Enemies, Add #1');
    assert.equal(commandDisplay(cmd(334, [-1])).label, '◆Enemy Recover All: All Enemies');
    assert.equal(commandDisplay(cmd(335, [0])).label, '◆Enemy Appear: #1');
    assert.equal(commandDisplay(cmd(336, [0, 1])).label, '◆Enemy Transform: #1, #1');
    assert.equal(commandDisplay(cmd(337, [-1, 1, false])).label, '◆Show Battle Animation: All Enemies, anim #1');
    assert.equal(commandDisplay(cmd(339, [0, 0, 1, -1])).label, '◆Force Action: Enemy #1, skill #1');
    assert.equal(commandDisplay(cmd(339, [1, 2, 1, -1])).label, '◆Force Action: Actor #2, skill #1');
  });

  test('Script (355) shows the script text', () => {
    assert.equal(commandDisplay(cmd(355, ['console.log(1)'])).label, '◆Script: console.log(1)');
  });

  test('zh-CN renders the reported "更改透明状态" case without numeric tail', () => {
    assert.equal(commandDisplay(cmd(211, [0]), null, 'zh-CN').label, '◆更改透明状态：开');
    assert.equal(commandDisplay(cmd(126, [1, 0, 0, 1]), null, 'zh-CN').label, '◆增减物品：#1，增加 1');
  });
});
