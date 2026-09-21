import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { androidAudioConversionArguments, assertAndroidAudioConfirmation, inspectAndroidAudio, prepareAndroidAudio, readAudioInfo } from './game-android-audio-service.ts';
import { managedFfmpegPath, managedFfprobePath } from './game-media-tools-service.ts';
import { GameBuildProcessCanceledError } from './game-build-process-service.ts';

test('Android audio preparation plans only missing pairs and rejects stale or absent confirmation', () => {
  fixture(({ root, project, write }) => {
    write('audio/se/示例.ogg', 'source');
    write('audio/se/Complete.ogg', 'source');
    write('audio/se/Complete.m4a', 'keep');
    write('audio/se/Empty.ogg', 'source');
    write('audio/se/Empty.m4a', '');
    const result = inspectAndroidAudio(root, project, 'rpg-maker-mv', false);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.preparation?.files.map(file => file.targetPath), ['audio/se/Empty.m4a', 'audio/se/示例.m4a']);
    assert.equal(result.preparation?.toolsReady, false);
    assert.throws(() => assertAndroidAudioConfirmation(result.preparation), /Confirm Android audio/);
    assert.throws(() => assertAndroidAudioConfirmation(result.preparation, result.preparation!.id), /FFmpeg and FFprobe/);
    for (const executable of [managedFfmpegPath(root), managedFfprobePath(root)]) {
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, 'test executable placeholder', 'utf8');
    }
    const ready = inspectAndroidAudio(root, project, 'rpg-maker-mv', false).preparation!;
    assert.equal(ready.id, result.preparation!.id);
    assert.doesNotThrow(() => assertAndroidAudioConfirmation(ready, ready.id));
    write('audio/se/Another.ogg', 'source');
    const changed = inspectAndroidAudio(root, project, 'rpg-maker-mv', false).preparation!;
    assert.throws(() => assertAndroidAudioConfirmation(changed, ready.id), /Confirm Android audio/);
    assert.equal(fs.existsSync(path.join(project, 'audio/se/示例.m4a')), false);
    assert.equal(fs.readFileSync(path.join(project, 'audio/se/Complete.m4a'), 'utf8'), 'keep');
  });
});

test('Android audio preparation refuses encrypted inputs and leaves MZ untouched', () => {
  fixture(({ root, project, write }) => {
    write('audio/bgm/Sample.rpgmvo', 'encrypted fixture');
    const result = inspectAndroidAudio(root, project, 'rpg-maker-mv', true);
    assert.match(result.blockers.join(), /Encrypted Android mobile audio/);
    assert.equal(result.preparation, undefined);
    assert.equal(inspectAndroidAudio(root, project, 'rpg-maker-mv', false).preparation, undefined);
    assert.deepEqual(inspectAndroidAudio(root, project, 'rpg-maker-mz', false), { blockers: [] });
  });
});

test('Android audio preparation checks cancellation and refuses the original project as its destination', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-audio-safety-'));
  try {
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data/System.json'), '{}', 'utf8');
    await assert.rejects(prepareAndroidAudio(root, root, root, 'unconfirmed', { isCanceled: () => true }), GameBuildProcessCanceledError);
    await assert.rejects(prepareAndroidAudio(root, root, root, 'unconfirmed'), /separate build copy/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Android audio metadata preserves loop samples and rejects invalid or conflicting tags', () => {
  const probe = (tags: Record<string, string>, formatTags: Record<string, string> = {}) => JSON.stringify({
    streams: [{ codec_type: 'audio', codec_name: 'vorbis', sample_rate: '44100', channels: 2, tags }], format: { tags: formatTags },
  });
  const info = readAudioInfo(probe({ LOOPSTART: '22050', LOOPLENGTH: '441000' }));
  assert.equal(info.loopStart, 22050);
  assert.equal(info.loopLength, 441000);
  const root = path.join(os.tmpdir(), 'sample-audio-args');
  const input = path.join(root, '示例.ogg');
  const output = path.join(root, '示例.m4a');
  const args = androidAudioConversionArguments(input, output, info);
  assert.equal(args[args.indexOf('-movie_timescale') + 1], '44100');
  assert.equal(args[args.indexOf('-ar') + 1], '44100');
  assert.ok(args.includes('comment=LOOPSTART=22050\nLOOPLENGTH=441000'));
  assert.ok(args.includes('-n'));
  assert.ok(!args.includes('-y'));
  assert.equal(args.at(-1), output);
  for (const value of ['-1', 'NaN', '1.5', '9007199254740992']) assert.throws(() => readAudioInfo(probe({ LOOPSTART: value })), /invalid LOOPSTART/);
  assert.throws(() => readAudioInfo(probe({ LOOPSTART: '1' }, { loopstart: '2' })), /conflicting metadata/);
  assert.throws(() => readAudioInfo('{"streams":[]}'), /exactly one audio stream/);
});

function fixture(run: (input: { root: string; project: string; write: (file: string, value: string) => void }) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-audio-plan-'));
  const project = path.join(root, 'project');
  const write = (file: string, value: string) => {
    const destination = path.join(project, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, value, 'utf8');
  };
  try { write('data/System.json', '{}'); run({ root, project, write }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
