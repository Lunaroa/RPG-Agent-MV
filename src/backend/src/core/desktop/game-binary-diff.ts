import crypto from 'node:crypto';

const MAGIC = Buffer.from('RPGAGENTBD1\n', 'ascii');
const BLOCK_SIZE = 64 * 1024;

interface BinaryPatchChunk {
  offset: number;
  length: number;
  payloadOffset: number;
}

export interface BinaryPatchHeader {
  schemaVersion: 1;
  algorithm: 'changed-blocks-v1';
  blockSize: number;
  baseSha256: string | null;
  targetSha256: string;
  targetBytes: number;
  chunks: BinaryPatchChunk[];
}

export function createBinaryPatch(base: Buffer | null, target: Buffer): Buffer {
  const chunks: BinaryPatchChunk[] = [];
  const payload: Buffer[] = [];
  let payloadOffset = 0;
  for (let offset = 0; offset < target.byteLength; offset += BLOCK_SIZE) {
    const targetBlock = target.subarray(offset, Math.min(offset + BLOCK_SIZE, target.byteLength));
    const baseBlock = base?.subarray(offset, Math.min(offset + targetBlock.byteLength, base.byteLength));
    if (baseBlock && baseBlock.byteLength === targetBlock.byteLength && baseBlock.equals(targetBlock)) continue;
    chunks.push({ offset, length: targetBlock.byteLength, payloadOffset });
    payload.push(targetBlock);
    payloadOffset += targetBlock.byteLength;
  }
  const header: BinaryPatchHeader = {
    schemaVersion: 1,
    algorithm: 'changed-blocks-v1',
    blockSize: BLOCK_SIZE,
    baseSha256: base ? sha256(base) : null,
    targetSha256: sha256(target),
    targetBytes: target.byteLength,
    chunks,
  };
  const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8');
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32LE(headerBuffer.byteLength, 0);
  return Buffer.concat([MAGIC, headerLength, headerBuffer, ...payload]);
}

export function applyBinaryPatch(base: Buffer | null, patch: Buffer): Buffer {
  if (patch.byteLength < MAGIC.byteLength + 4 || !patch.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error('Binary patch has an invalid header.');
  }
  const headerLength = patch.readUInt32LE(MAGIC.byteLength);
  const headerStart = MAGIC.byteLength + 4;
  const payloadStart = headerStart + headerLength;
  if (payloadStart > patch.byteLength) throw new Error('Binary patch header is truncated.');
  const header = JSON.parse(patch.subarray(headerStart, payloadStart).toString('utf8')) as BinaryPatchHeader;
  validateHeader(header);
  const actualBaseHash = base ? sha256(base) : null;
  if (actualBaseHash !== header.baseSha256) throw new Error('Binary patch baseline SHA-256 does not match.');
  const target = Buffer.alloc(header.targetBytes);
  if (base) base.copy(target, 0, 0, Math.min(base.byteLength, target.byteLength));
  let previousEnd = 0;
  for (const chunk of header.chunks) {
    if (!Number.isSafeInteger(chunk.offset) || !Number.isSafeInteger(chunk.length) || !Number.isSafeInteger(chunk.payloadOffset)
      || chunk.offset < previousEnd || chunk.length <= 0 || chunk.payloadOffset < 0
      || chunk.offset + chunk.length > target.byteLength
      || payloadStart + chunk.payloadOffset + chunk.length > patch.byteLength) {
      throw new Error('Binary patch contains an invalid chunk range.');
    }
    patch.copy(
      target,
      chunk.offset,
      payloadStart + chunk.payloadOffset,
      payloadStart + chunk.payloadOffset + chunk.length,
    );
    previousEnd = chunk.offset + chunk.length;
  }
  if (sha256(target) !== header.targetSha256) throw new Error('Binary patch target SHA-256 verification failed.');
  return target;
}

export function readBinaryPatchHeader(patch: Buffer): BinaryPatchHeader {
  if (patch.byteLength < MAGIC.byteLength + 4 || !patch.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error('Binary patch has an invalid header.');
  }
  const length = patch.readUInt32LE(MAGIC.byteLength);
  const start = MAGIC.byteLength + 4;
  if (start + length > patch.byteLength) throw new Error('Binary patch header is truncated.');
  const header = JSON.parse(patch.subarray(start, start + length).toString('utf8')) as BinaryPatchHeader;
  validateHeader(header);
  return header;
}

function validateHeader(header: BinaryPatchHeader): void {
  if (!header || header.schemaVersion !== 1 || header.algorithm !== 'changed-blocks-v1'
    || header.blockSize !== BLOCK_SIZE || !Array.isArray(header.chunks)
    || !Number.isSafeInteger(header.targetBytes) || header.targetBytes < 0
    || !/^[a-f0-9]{64}$/i.test(header.targetSha256)
    || !(header.baseSha256 === null || /^[a-f0-9]{64}$/i.test(header.baseSha256))) {
    throw new Error('Binary patch metadata is invalid.');
  }
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
