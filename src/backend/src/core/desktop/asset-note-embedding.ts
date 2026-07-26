/**
 * Embedded asset notes: keep the user's note inside the media file itself so it
 * travels with the file (copy/export), while rmmv.db stays the query index.
 *
 * Formats:
 *  - PNG: a `tEXt` chunk with keyword `RPGAgentMeta`, inserted before IEND.
 *    The value is ASCII-escaped JSON `{"v":1,"note":"..."}` (tEXt is Latin-1 only).
 *  - OGG (Vorbis): a user comment `RPGAGENT_META=<json>` in the comment header.
 *    The header pages are re-laced and every following page is renumbered with
 *    a fresh CRC, so the whole file is rewritten consistently.
 *  - Everything else is unsupported here and lives in the DB only.
 */

export interface EmbeddedAssetMeta {
  v: 1;
  note: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TEXT_KEYWORD = 'RPGAgentMeta';
const OGG_META_KEY = 'RPGAGENT_META';

/** File types whose notes can be embedded in-place. */
export function supportsEmbeddedAssetNote(fileName: string): boolean {
  const lower = String(fileName || '').toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.ogg');
}

function encodeMeta(note: string): string {
  const json = JSON.stringify({ v: 1, note } satisfies EmbeddedAssetMeta);
  // Escape non-ASCII so the payload survives Latin-1 storage (PNG tEXt).
  return json.replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function decodeMeta(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as EmbeddedAssetMeta;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.note !== 'string') return null;
    return parsed.note;
  } catch {
    return null;
  }
}

// ── PNG (CRC-32, reflected, zlib polynomial) ──

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngChunk {
  type: string;
  data: Buffer;
}

function parsePngChunks(file: Buffer): PngChunk[] | null {
  if (file.length < PNG_SIGNATURE.length || !file.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > file.length) return null;
    chunks.push({ type, data: file.subarray(offset + 8, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 || chunks[chunks.length - 1]!.type !== 'IEND') return null;
  return chunks;
}

function serializePngChunk(chunk: PngChunk): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(chunk.type, 'latin1'), chunk.data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(typeAndData), 0);
  return Buffer.concat([header, typeAndData, crc]);
}

function pngMetaChunkNote(chunk: PngChunk): string | null {
  const separator = chunk.data.indexOf(0);
  if (separator < 0) return null;
  if (chunk.data.toString('latin1', 0, separator) !== PNG_TEXT_KEYWORD) return null;
  return decodeMeta(chunk.data.toString('latin1', separator + 1));
}

function readPngNote(file: Buffer): string | null {
  const chunks = parsePngChunks(file);
  if (!chunks) return null;
  for (const chunk of chunks) {
    if (chunk.type !== 'tEXt') continue;
    const note = pngMetaChunkNote(chunk);
    if (note !== null) return note;
  }
  return null;
}

function writePngNote(file: Buffer, note: string): Buffer | null {
  const chunks = parsePngChunks(file);
  if (!chunks) return null;
  const kept = chunks.filter((chunk) => !(chunk.type === 'tEXt' && pngMetaChunkNote(chunk) !== null));
  if (note.trim()) {
    const data = Buffer.concat([
      Buffer.from(PNG_TEXT_KEYWORD, 'latin1'),
      Buffer.from([0]),
      Buffer.from(encodeMeta(note), 'latin1'),
    ]);
    kept.splice(kept.length - 1, 0, { type: 'tEXt', data });
  }
  return Buffer.concat([PNG_SIGNATURE, ...kept.map(serializePngChunk)]);
}

// ── OGG (CRC-32, non-reflected, poly 0x04C11DB7, init/xorout 0) ──

const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n << 24;
    for (let k = 0; k < 8; k += 1) {
      c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function oggCrc32(buffer: Buffer): number {
  let crc = 0;
  for (const byte of buffer) {
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc >>> 0;
}

interface OggPage {
  headerType: number;
  granule: Buffer; // 8 bytes, opaque
  serial: number;
  sequence: number;
  segments: number[];
  body: Buffer;
}

function parseOggPages(file: Buffer): OggPage[] | null {
  const pages: OggPage[] = [];
  let offset = 0;
  while (offset < file.length) {
    if (offset + 27 > file.length) return null;
    if (file.toString('latin1', offset, offset + 4) !== 'OggS' || file[offset + 4] !== 0) return null;
    const headerType = file[offset + 5]!;
    const granule = Buffer.from(file.subarray(offset + 6, offset + 14));
    const serial = file.readUInt32LE(offset + 14);
    const sequence = file.readUInt32LE(offset + 18);
    const segmentCount = file[offset + 26]!;
    const tableEnd = offset + 27 + segmentCount;
    if (tableEnd > file.length) return null;
    const segments = [...file.subarray(offset + 27, tableEnd)];
    const bodyLength = segments.reduce((sum, value) => sum + value, 0);
    if (tableEnd + bodyLength > file.length) return null;
    pages.push({
      headerType,
      granule,
      serial,
      sequence,
      segments,
      body: Buffer.from(file.subarray(tableEnd, tableEnd + bodyLength)),
    });
    offset = tableEnd + bodyLength;
  }
  return pages.length > 0 ? pages : null;
}

function serializeOggPage(page: OggPage): Buffer {
  const header = Buffer.alloc(27 + page.segments.length);
  header.write('OggS', 0, 'latin1');
  header[4] = 0;
  header[5] = page.headerType;
  page.granule.copy(header, 6);
  header.writeUInt32LE(page.serial, 14);
  header.writeUInt32LE(page.sequence, 18);
  header.writeUInt32LE(0, 22); // CRC placeholder
  header[26] = page.segments.length;
  for (let i = 0; i < page.segments.length; i += 1) header[27 + i] = page.segments[i]!;
  const full = Buffer.concat([header, page.body]);
  full.writeUInt32LE(oggCrc32(full), 22);
  return full;
}

/** Split laced page bodies back into packets (header pages only, small data). */
function extractPackets(pages: OggPage[]): Buffer[] {
  const packets: Buffer[] = [];
  let current: Buffer[] = [];
  for (const page of pages) {
    let cursor = 0;
    for (const lace of page.segments) {
      current.push(page.body.subarray(cursor, cursor + lace));
      cursor += lace;
      if (lace < 255) {
        packets.push(Buffer.concat(current));
        current = [];
      }
    }
  }
  if (current.length) packets.push(Buffer.concat(current));
  return packets;
}

function lacePacketsIntoPages(packets: Buffer[], serial: number, firstSequence: number): OggPage[] {
  // Lacing values for all packets, concatenated (0-lace terminators included).
  const laces: number[] = [];
  for (const packet of packets) {
    let remaining = packet.length;
    for (;;) {
      const lace = Math.min(remaining, 255);
      laces.push(lace);
      remaining -= lace;
      if (lace < 255) break;
    }
  }
  const body = Buffer.concat(packets);
  const pages: OggPage[] = [];
  let laceIndex = 0;
  let bodyOffset = 0;
  let sequence = firstSequence;
  let continued = false;
  while (laceIndex < laces.length) {
    const pageLaces = laces.slice(laceIndex, laceIndex + 255);
    const pageBodyLength = pageLaces.reduce((sum, value) => sum + value, 0);
    pages.push({
      headerType: continued ? 0x01 : 0x00,
      granule: Buffer.alloc(8), // header pages carry granulepos 0
      serial,
      sequence,
      segments: pageLaces,
      body: Buffer.from(body.subarray(bodyOffset, bodyOffset + pageBodyLength)),
    });
    laceIndex += pageLaces.length;
    bodyOffset += pageBodyLength;
    sequence += 1;
    continued = pageLaces[pageLaces.length - 1] === 255;
  }
  return pages;
}

interface VorbisComments {
  vendor: Buffer;
  comments: Buffer[];
}

function parseVorbisCommentPacket(packet: Buffer): VorbisComments | null {
  if (packet.length < 7 || packet[0] !== 0x03 || packet.toString('latin1', 1, 7) !== 'vorbis') return null;
  let offset = 7;
  if (offset + 4 > packet.length) return null;
  const vendorLength = packet.readUInt32LE(offset);
  offset += 4;
  if (offset + vendorLength > packet.length) return null;
  const vendor = Buffer.from(packet.subarray(offset, offset + vendorLength));
  offset += vendorLength;
  if (offset + 4 > packet.length) return null;
  const count = packet.readUInt32LE(offset);
  offset += 4;
  const comments: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > packet.length) return null;
    const length = packet.readUInt32LE(offset);
    offset += 4;
    if (offset + length > packet.length) return null;
    comments.push(Buffer.from(packet.subarray(offset, offset + length)));
    offset += length;
  }
  return { vendor, comments };
}

function serializeVorbisCommentPacket(vendor: Buffer, comments: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from('\x03vorbis', 'latin1')];
  const vendorLength = Buffer.alloc(4);
  vendorLength.writeUInt32LE(vendor.length, 0);
  parts.push(vendorLength, vendor);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(comments.length, 0);
  parts.push(count);
  for (const comment of comments) {
    const length = Buffer.alloc(4);
    length.writeUInt32LE(comment.length, 0);
    parts.push(length, comment);
  }
  parts.push(Buffer.from([0x01])); // framing bit
  return Buffer.concat(parts);
}

function isMetaComment(comment: Buffer): boolean {
  const prefix = `${OGG_META_KEY}=`;
  return comment.length >= prefix.length
    && comment.toString('utf8', 0, prefix.length).toUpperCase() === prefix;
}

/** Locate the pages holding the comment+setup headers for the first logical stream. */
function splitOggSections(pages: OggPage[]): {
  identPage: OggPage;
  headerPages: OggPage[];
  restPages: OggPage[];
} | null {
  const identPage = pages[0];
  if (!identPage || (identPage.headerType & 0x02) === 0) return null;
  const serial = identPage.serial;
  const headerPages: OggPage[] = [];
  let index = 1;
  let packetsClosed = 0;
  while (index < pages.length && packetsClosed < 2) {
    const page = pages[index]!;
    if (page.serial !== serial) return null; // multiplexed streams are out of scope
    headerPages.push(page);
    for (const lace of page.segments) {
      if (lace < 255) packetsClosed += 1;
    }
    index += 1;
  }
  if (packetsClosed < 2) return null;
  return { identPage, headerPages, restPages: pages.slice(index) };
}

function readOggNote(file: Buffer): string | null {
  const pages = parseOggPages(file);
  if (!pages) return null;
  const sections = splitOggSections(pages);
  if (!sections) return null;
  const [commentPacket] = extractPackets(sections.headerPages);
  if (!commentPacket) return null;
  const parsed = parseVorbisCommentPacket(commentPacket);
  if (!parsed) return null;
  for (const comment of parsed.comments) {
    if (!isMetaComment(comment)) continue;
    return decodeMeta(comment.toString('utf8', OGG_META_KEY.length + 1));
  }
  return null;
}

function writeOggNote(file: Buffer, note: string): Buffer | null {
  const pages = parseOggPages(file);
  if (!pages) return null;
  const sections = splitOggSections(pages);
  if (!sections) return null;
  const headerPackets = extractPackets(sections.headerPages);
  if (headerPackets.length < 2) return null;
  const parsed = parseVorbisCommentPacket(headerPackets[0]!);
  if (!parsed) return null;

  const comments = parsed.comments.filter((comment) => !isMetaComment(comment));
  if (note.trim()) {
    comments.push(Buffer.from(`${OGG_META_KEY}=${JSON.stringify({ v: 1, note } satisfies EmbeddedAssetMeta)}`, 'utf8'));
  }
  const nextCommentPacket = serializeVorbisCommentPacket(parsed.vendor, comments);
  const nextHeaderPages = lacePacketsIntoPages(
    [nextCommentPacket, ...headerPackets.slice(1)],
    sections.identPage.serial,
    sections.identPage.sequence + 1,
  );

  // Renumber the audio pages so the sequence stays contiguous; CRCs are recomputed on serialize.
  let sequence = sections.identPage.sequence + 1 + nextHeaderPages.length;
  const renumbered = sections.restPages.map((page) => {
    const next = { ...page, sequence };
    sequence += 1;
    return next;
  });

  return Buffer.concat([
    serializeOggPage(sections.identPage),
    ...nextHeaderPages.map(serializeOggPage),
    ...renumbered.map(serializeOggPage),
  ]);
}

// ── Public buffer-level API ──

/** Read the embedded note from a PNG/OGG buffer; null when absent or unsupported. */
export function readEmbeddedAssetNoteFromBuffer(fileName: string, file: Buffer): string | null {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return readPngNote(file);
  if (lower.endsWith('.ogg')) return readOggNote(file);
  return null;
}

/**
 * Produce a new buffer with the note embedded (or removed when the note is blank).
 * Returns null when the format is unsupported or the file cannot be parsed safely.
 */
export function writeEmbeddedAssetNoteToBuffer(fileName: string, file: Buffer, note: string): Buffer | null {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.png')) return writePngNote(file, note);
  if (lower.endsWith('.ogg')) return writeOggNote(file, note);
  return null;
}
