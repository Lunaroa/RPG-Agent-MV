import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readEmbeddedAssetNoteFromBuffer,
  supportsEmbeddedAssetNote,
  writeEmbeddedAssetNoteToBuffer,
} from './asset-note-embedding.ts';

// ── Synthetic fixtures (the parsers do not verify CRCs, so zeroed CRCs are fine) ──

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function syntheticPng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('IDAT', Buffer.from([1, 2, 3, 4])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function oggPage(headerType: number, sequence: number, segments: number[], body: Buffer): Buffer {
  const header = Buffer.alloc(27 + segments.length);
  header.write('OggS', 0, 'latin1');
  header[5] = headerType;
  header.writeUInt32LE(0x1234, 14); // serial
  header.writeUInt32LE(sequence, 18);
  header[26] = segments.length;
  segments.forEach((lace, index) => { header[27 + index] = lace; });
  return Buffer.concat([header, body]);
}

function syntheticOgg(): Buffer {
  const ident = Buffer.concat([Buffer.from('\x01vorbis', 'latin1'), Buffer.alloc(23)]);
  const vendor = Buffer.from('AGENT', 'utf8');
  const comment = Buffer.concat([
    Buffer.from('\x03vorbis', 'latin1'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(vendor.length, 0); return b; })(),
    vendor,
    Buffer.alloc(4), // zero user comments
    Buffer.from([0x01]),
  ]);
  const setup = Buffer.concat([Buffer.from('\x05vorbis', 'latin1'), Buffer.alloc(10)]);
  const audio = Buffer.from([9, 9, 9, 9]);
  return Buffer.concat([
    oggPage(0x02, 0, [ident.length], ident),
    oggPage(0x00, 1, [comment.length, setup.length], Buffer.concat([comment, setup])),
    oggPage(0x00, 2, [audio.length], audio),
    oggPage(0x04, 3, [audio.length], audio),
  ]);
}

test('supportsEmbeddedAssetNote matches png/ogg only', () => {
  assert.equal(supportsEmbeddedAssetNote('hero.PNG'), true);
  assert.equal(supportsEmbeddedAssetNote('bgm.ogg'), true);
  assert.equal(supportsEmbeddedAssetNote('movie.mp4'), false);
  assert.equal(supportsEmbeddedAssetNote('hero.rpgmvp'), false);
});

test('png note roundtrip: write, replace, remove', () => {
  const original = syntheticPng();
  assert.equal(readEmbeddedAssetNoteFromBuffer('a.png', original), null);

  const withNote = writeEmbeddedAssetNoteToBuffer('a.png', original, '主角立绘 v2 · ドラフト');
  assert.ok(withNote);
  assert.equal(readEmbeddedAssetNoteFromBuffer('a.png', withNote), '主角立绘 v2 · ドラフト');

  const replaced = writeEmbeddedAssetNoteToBuffer('a.png', withNote, 'final');
  assert.ok(replaced);
  assert.equal(readEmbeddedAssetNoteFromBuffer('a.png', replaced), 'final');
  // Replacing must not stack chunks: size shrinks back when the note shrinks.
  assert.ok(replaced.length < withNote.length);

  const removed = writeEmbeddedAssetNoteToBuffer('a.png', replaced, '');
  assert.ok(removed);
  assert.equal(readEmbeddedAssetNoteFromBuffer('a.png', removed), null);
  // Same chunk layout as the original (the rewrite only normalizes chunk CRCs).
  assert.equal(removed.length, original.length);
});

test('ogg note roundtrip: write, replace, remove', () => {
  const original = syntheticOgg();
  assert.equal(readEmbeddedAssetNoteFromBuffer('b.ogg', original), null);

  const withNote = writeEmbeddedAssetNoteToBuffer('b.ogg', original, '战斗 BGM，循环点 0:45');
  assert.ok(withNote);
  assert.equal(readEmbeddedAssetNoteFromBuffer('b.ogg', withNote), '战斗 BGM，循环点 0:45');

  const replaced = writeEmbeddedAssetNoteToBuffer('b.ogg', withNote, 'v2');
  assert.ok(replaced);
  assert.equal(readEmbeddedAssetNoteFromBuffer('b.ogg', replaced), 'v2');

  const removed = writeEmbeddedAssetNoteToBuffer('b.ogg', replaced, '');
  assert.ok(removed);
  assert.equal(readEmbeddedAssetNoteFromBuffer('b.ogg', removed), null);
});

test('ogg rewrite keeps page sequences contiguous', () => {
  const withNote = writeEmbeddedAssetNoteToBuffer('b.ogg', syntheticOgg(), 'x')!;
  const sequences: number[] = [];
  let offset = 0;
  while (offset < withNote.length) {
    assert.equal(withNote.toString('latin1', offset, offset + 4), 'OggS');
    sequences.push(withNote.readUInt32LE(offset + 18));
    const segmentCount = withNote[offset + 26]!;
    const segments = [...withNote.subarray(offset + 27, offset + 27 + segmentCount)];
    offset += 27 + segmentCount + segments.reduce((sum, value) => sum + value, 0);
  }
  assert.deepEqual(sequences, sequences.map((_, index) => index));
});

test('unsupported or corrupted input returns null', () => {
  assert.equal(writeEmbeddedAssetNoteToBuffer('a.mp4', Buffer.alloc(16), 'x'), null);
  assert.equal(writeEmbeddedAssetNoteToBuffer('a.png', Buffer.from('not a png'), 'x'), null);
  assert.equal(writeEmbeddedAssetNoteToBuffer('b.ogg', Buffer.from('not an ogg'), 'x'), null);
  assert.equal(readEmbeddedAssetNoteFromBuffer('a.png', Buffer.from('nope')), null);
});
