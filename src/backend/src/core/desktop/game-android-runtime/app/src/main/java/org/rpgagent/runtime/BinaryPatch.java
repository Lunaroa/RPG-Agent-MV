package org.rpgagent.runtime;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class BinaryPatch {
    private static final byte[] MAGIC = "RPGAGENTBD1\n".getBytes(StandardCharsets.US_ASCII);
    private static final int BLOCK_SIZE = 64 * 1024;
    private static final int MAX_HEADER_BYTES = 16 * 1024 * 1024;

    private BinaryPatch() {}

    static void apply(File base, File patch, File target) throws IOException, JSONException {
        try (RandomAccessFile input = new RandomAccessFile(patch, "r")) {
            byte[] magic = new byte[MAGIC.length];
            input.readFully(magic);
            if (!Arrays.equals(magic, MAGIC)) throw new IOException("Binary patch has an invalid header.");
            int headerLength = readLittleEndianInt(input);
            if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES || MAGIC.length + 4L + headerLength > input.length()) {
                throw new IOException("Binary patch header is truncated or too large.");
            }
            byte[] headerBytes = new byte[headerLength];
            input.readFully(headerBytes);
            long payloadStart = input.getFilePointer();
            JSONObject header = new JSONObject(new String(headerBytes, StandardCharsets.UTF_8));
            validateHeader(header);
            String expectedBase = header.isNull("baseSha256") ? null : header.getString("baseSha256");
            String actualBase = base != null && base.isFile() ? RuntimeFiles.sha256(base) : null;
            if (expectedBase == null ? actualBase != null : !expectedBase.equalsIgnoreCase(actualBase)) {
                throw new IOException("Binary patch baseline SHA-256 does not match.");
            }
            long targetBytes = header.getLong("targetBytes");
            File parent = target.getParentFile();
            if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("Could not create patch target directory.");
            try (RandomAccessFile output = new RandomAccessFile(target, "rw")) {
                output.setLength(targetBytes);
                if (base != null && base.isFile()) copyBase(base, output, targetBytes);
                JSONArray chunks = header.getJSONArray("chunks");
                long previousEnd = 0;
                for (int index = 0; index < chunks.length(); index += 1) {
                    JSONObject chunk = chunks.getJSONObject(index);
                    long offset = chunk.getLong("offset");
                    long length = chunk.getLong("length");
                    long payloadOffset = chunk.getLong("payloadOffset");
                    if (offset < previousEnd || length <= 0 || payloadOffset < 0 || offset + length > targetBytes
                        || payloadStart + payloadOffset + length > input.length()) {
                        throw new IOException("Binary patch contains an invalid chunk range.");
                    }
                    input.seek(payloadStart + payloadOffset);
                    output.seek(offset);
                    copyRange(input, output, length);
                    previousEnd = offset + length;
                }
                output.getFD().sync();
            }
            if (!RuntimeFiles.sha256(target).equalsIgnoreCase(header.getString("targetSha256"))) {
                throw new IOException("Binary patch target SHA-256 verification failed.");
            }
        }
    }

    private static void validateHeader(JSONObject header) throws JSONException, IOException {
        if (header.optInt("schemaVersion", 0) != 1 || !"changed-blocks-v1".equals(header.optString("algorithm"))
            || header.optInt("blockSize", 0) != BLOCK_SIZE || header.optLong("targetBytes", -1) < 0
            || !header.optString("targetSha256").matches("(?i)[a-f0-9]{64}")
            || !(header.has("baseSha256") && (header.isNull("baseSha256")
                || header.optString("baseSha256").matches("(?i)[a-f0-9]{64}")))
            || header.optJSONArray("chunks") == null) {
            throw new IOException("Binary patch metadata is invalid.");
        }
    }

    private static int readLittleEndianInt(RandomAccessFile input) throws IOException {
        int first = input.read();
        int second = input.read();
        int third = input.read();
        int fourth = input.read();
        if ((first | second | third | fourth) < 0) throw new IOException("Binary patch header is truncated.");
        return first | (second << 8) | (third << 16) | (fourth << 24);
    }

    private static void copyBase(File base, RandomAccessFile output, long maximum) throws IOException {
        try (InputStream input = new FileInputStream(base)) {
            byte[] buffer = new byte[64 * 1024];
            long remaining = maximum;
            int count;
            while (remaining > 0 && (count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining))) >= 0) {
                output.write(buffer, 0, count);
                remaining -= count;
            }
        }
    }

    private static void copyRange(RandomAccessFile input, RandomAccessFile output, long length) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long remaining = length;
        while (remaining > 0) {
            int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
            if (count < 0) throw new IOException("Binary patch payload is truncated.");
            output.write(buffer, 0, count);
            remaining -= count;
        }
    }
}
