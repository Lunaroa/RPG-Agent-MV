package org.rpgagent.runtime;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class ContentUpdateManager {
    private final ContentStateStore state;

    ContentUpdateManager(ContentStateStore state) {
        this.state = state;
    }

    void install(String payloadText, UpdateProgressListener progress) throws IOException, JSONException {
        JSONObject payload = new JSONObject(payloadText);
        JSONObject pkg = requireObject(payload, "pkg");
        JSONObject release = requireObject(payload, "release");
        if (!"android".equals(pkg.optString("platform")) || !"content".equals(pkg.optString("delivery"))) {
            throw new IOException("The selected update is not an Android content package.");
        }
        String packageType = pkg.optString("packageType");
        if (!packageType.equals("full") && !packageType.equals("file-delta") && !packageType.equals("binary-diff")) {
            throw new IOException("The Android content package type is unsupported.");
        }
        String releaseId = requireId(release, "releaseId");
        String version = release.optString("version", "");
        if (!version.matches("\\d+\\.\\d+\\.\\d+(?: *-[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)*)?")) {
            throw new IOException("The Android release version is invalid.");
        }
        String packageUrl = requireHttpUrl(payload.optString("packageUrl"));
        JSONArray packageFiles = requireArray(pkg, "packageFiles");
        JSONArray targetFiles = requireArray(pkg, "targetFiles");
        JSONArray deletedFiles = requireArray(pkg, "deletedFiles");
        String currentReleaseId = state.currentReleaseId();
        if (!packageType.equals("full") && !currentReleaseId.equals(pkg.optString("baseReleaseId"))) {
            throw new IOException("This update requires a different installed content baseline.");
        }

        File work = state.createStagingDirectory();
        File downloaded = new File(work, "package");
        File target = new File(work, "game");
        try {
            if (!downloaded.mkdirs()) throw new IOException("Could not create the update download directory.");
            long expectedBytes = pkg.optLong("bytes", -1);
            downloadPackage(packageUrl, packageFiles, expectedBytes, pkg.optString("sha256"), downloaded, progress);
            progress.onProgress("verifying", expectedBytes, expectedBytes, 0, null);
            JSONObject manifest = readManifest(downloaded);
            validateManifest(manifest, releaseId, packageType, pkg.optString("baseReleaseId"), targetFiles, deletedFiles);

            if (packageType.equals("full")) {
                if (!target.mkdirs()) throw new IOException("Could not create the new content directory.");
            } else {
                state.copyCurrentContentTo(target);
            }
            applyDeletions(target, deletedFiles);
            if (packageType.equals("binary-diff")) applyBinaryPatches(target, downloaded, manifest);
            else applyCompleteFiles(target, downloaded, targetFiles);
            verifyTarget(target, targetFiles);
            state.activate(target, releaseId, version);
            progress.onProgress("complete", expectedBytes, expectedBytes, 0, null);
        } finally {
            if (work.exists()) RuntimeFiles.deleteRecursively(work);
        }
    }

    private static void downloadPackage(
        String packageUrl,
        JSONArray entries,
        long expectedBytes,
        String expectedSha256,
        File destination,
        UpdateProgressListener progress
    ) throws IOException, JSONException {
        if (expectedBytes < 0 || !expectedSha256.matches("(?i)[a-f0-9]{64}")) {
            throw new IOException("The content package size or SHA-256 is invalid.");
        }
        List<JSONObject> files = jsonObjects(entries);
        MessageDigest directoryDigest = RuntimeFiles.sha256Digest();
        long total = 0;
        long startedAt = android.os.SystemClock.elapsedRealtime();
        Set<String> paths = new HashSet<>();
        for (JSONObject entry : files) {
            String relativePath = requireFileEntry(entry, paths);
            long bytes = entry.getLong("bytes");
            String sha256 = entry.getString("sha256").toLowerCase(java.util.Locale.ROOT);
            File target = RuntimeFiles.safeFile(destination, relativePath);
            downloadFile(childUrl(packageUrl, relativePath), target, bytes, sha256, total, expectedBytes, startedAt, progress);
            total += bytes;
            directoryDigest.update((relativePath + "\0" + bytes + "\0" + sha256 + "\n").getBytes(StandardCharsets.UTF_8));
        }
        if (total != expectedBytes || !RuntimeFiles.hex(directoryDigest.digest()).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("The downloaded Android content package failed directory verification.");
        }
    }

    private static void downloadFile(
        String url,
        File destination,
        long expectedBytes,
        String expectedSha256,
        long alreadyReceived,
        long packageBytes,
        long startedAt,
        UpdateProgressListener progress
    ) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setUseCaches(false);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("Update download returned HTTP " + status + ".");
        }
        File parent = destination.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("Could not create update download directory.");
        MessageDigest digest = RuntimeFiles.sha256Digest();
        long bytes = 0;
        try (InputStream input = new BufferedInputStream(connection.getInputStream()); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                bytes += count;
                if (bytes > expectedBytes) throw new IOException("An update file is larger than declared.");
                output.write(buffer, 0, count);
                digest.update(buffer, 0, count);
                long completed = alreadyReceived + bytes;
                long elapsed = Math.max(1, android.os.SystemClock.elapsedRealtime() - startedAt);
                progress.onProgress("downloading", completed, packageBytes, completed * 1000 / elapsed, null);
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }
        if (bytes != expectedBytes || !RuntimeFiles.hex(digest.digest()).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("A downloaded Android update file failed SHA-256 verification.");
        }
    }

    private static JSONObject readManifest(File downloaded) throws IOException, JSONException {
        File file = RuntimeFiles.safeFile(downloaded, ".rpg-agent/release-package.json");
        if (!file.isFile()) throw new IOException("The Android update package manifest is missing.");
        try (InputStream input = new java.io.FileInputStream(file)) {
            return new JSONObject(RuntimeFiles.readText(input));
        }
    }

    private static void validateManifest(
        JSONObject manifest,
        String releaseId,
        String packageType,
        String baseReleaseId,
        JSONArray targetFiles,
        JSONArray deletedFiles
    ) throws IOException, JSONException {
        if (manifest.optInt("schemaVersion", 0) != 1 || !releaseId.equals(manifest.optString("releaseId"))
            || !"android".equals(manifest.optString("target")) || !packageType.equals(manifest.optString("packageType"))
            || (!packageType.equals("full") && !baseReleaseId.equals(manifest.optString("baseReleaseId")))) {
            throw new IOException("The Android package manifest does not match the selected release.");
        }
        if (!canonicalFiles(targetFiles).equals(canonicalFiles(requireArray(manifest, "targetFiles")))
            || !canonicalStrings(deletedFiles).equals(canonicalStrings(requireArray(manifest, "deletedFiles")))) {
            throw new IOException("The Android package manifest does not match the release index.");
        }
    }

    private static void applyCompleteFiles(File target, File downloaded, JSONArray targetFiles) throws IOException, JSONException {
        for (JSONObject entry : jsonObjects(targetFiles)) {
            String relativePath = entry.getString("path");
            File supplied = RuntimeFiles.safeFile(downloaded, relativePath);
            if (supplied.isFile()) RuntimeFiles.copyFile(supplied, RuntimeFiles.safeFile(target, relativePath));
        }
    }

    private static void applyBinaryPatches(File target, File downloaded, JSONObject manifest) throws IOException, JSONException {
        JSONArray patches = requireArray(manifest, "patches");
        for (JSONObject patch : jsonObjects(patches)) {
            String targetPath = patch.getString("targetPath");
            String patchPath = patch.getString("patchPath");
            File patchFile = RuntimeFiles.safeFile(downloaded, patchPath);
            if (!patchFile.isFile() || !RuntimeFiles.sha256(patchFile).equalsIgnoreCase(patch.getString("patchSha256"))) {
                throw new IOException("An Android binary patch failed verification: " + targetPath);
            }
            File targetFile = RuntimeFiles.safeFile(target, targetPath);
            File temporary = new File(targetFile.getParentFile(), targetFile.getName() + ".patched");
            BinaryPatch.apply(targetFile.isFile() ? targetFile : null, patchFile, temporary);
            if (targetFile.exists() && !targetFile.delete()) throw new IOException("Could not replace patched content: " + targetPath);
            if (!temporary.renameTo(targetFile)) throw new IOException("Could not publish patched content: " + targetPath);
        }
    }

    private static void applyDeletions(File target, JSONArray deletedFiles) throws IOException, JSONException {
        for (int index = 0; index < deletedFiles.length(); index += 1) {
            String relativePath = deletedFiles.getString(index);
            File file = RuntimeFiles.safeFile(target, relativePath);
            if (file.exists()) RuntimeFiles.deleteRecursively(file);
        }
    }

    private static void verifyTarget(File target, JSONArray targetFiles) throws IOException, JSONException {
        Map<String, JSONObject> expected = new HashMap<>();
        for (JSONObject entry : jsonObjects(targetFiles)) expected.put(entry.getString("path"), entry);
        List<String> actual = RuntimeFiles.listRelativeFiles(target);
        List<String> expectedPaths = new ArrayList<>(expected.keySet());
        Collections.sort(expectedPaths);
        if (!actual.equals(expectedPaths)) throw new IOException("The reconstructed Android content file list does not match the release.");
        for (String relativePath : expectedPaths) {
            JSONObject entry = expected.get(relativePath);
            File file = RuntimeFiles.safeFile(target, relativePath);
            if (file.length() != entry.getLong("bytes") || !RuntimeFiles.sha256(file).equalsIgnoreCase(entry.getString("sha256"))) {
                throw new IOException("The reconstructed Android content failed verification: " + relativePath);
            }
        }
    }

    private static String childUrl(String base, String relativePath) throws IOException {
        Uri uri = Uri.parse(base);
        Uri.Builder builder = uri.buildUpon();
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (!path.endsWith("/")) builder.path(path + "/");
        for (String part : relativePath.split("/")) builder.appendPath(part);
        return requireHttpUrl(builder.build().toString());
    }

    private static String requireHttpUrl(String value) throws IOException {
        try {
            URL parsed = new URL(value);
            if (!parsed.getProtocol().equals("http") && !parsed.getProtocol().equals("https")) throw new IOException("Update URL must use HTTP or HTTPS.");
            return parsed.toString();
        } catch (java.net.MalformedURLException error) {
            throw new IOException("The Android update URL is invalid.", error);
        }
    }

    private static String requireFileEntry(JSONObject entry, Set<String> paths) throws IOException, JSONException {
        String path = entry.getString("path");
        RuntimeFiles.safeFile(new File(System.getProperty("java.io.tmpdir"), "path-check"), path);
        if (!paths.add(path) || entry.optLong("bytes", -1) < 0 || !entry.optString("sha256").matches("(?i)[a-f0-9]{64}")) {
            throw new IOException("The Android update contains an invalid file manifest entry.");
        }
        return path;
    }

    private static String requireId(JSONObject value, String name) throws IOException {
        String id = value.optString(name, "");
        if (!id.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) throw new IOException("The Android release id is invalid.");
        return id;
    }

    private static JSONObject requireObject(JSONObject value, String name) throws IOException {
        JSONObject result = value.optJSONObject(name);
        if (result == null) throw new IOException("Android update payload is missing " + name + ".");
        return result;
    }

    private static JSONArray requireArray(JSONObject value, String name) throws IOException {
        JSONArray result = value.optJSONArray(name);
        if (result == null) throw new IOException("Android update payload is missing " + name + ".");
        return result;
    }

    private static List<JSONObject> jsonObjects(JSONArray values) throws JSONException, IOException {
        List<JSONObject> result = new ArrayList<>();
        for (int index = 0; index < values.length(); index += 1) {
            JSONObject value = values.optJSONObject(index);
            if (value == null) throw new IOException("Android update manifest contains a non-object entry.");
            result.add(value);
        }
        return result;
    }

    private static String canonicalFiles(JSONArray values) throws JSONException, IOException {
        List<String> result = new ArrayList<>();
        for (JSONObject value : jsonObjects(values)) {
            result.add(value.getString("path") + "\0" + value.getLong("bytes") + "\0" + value.getString("sha256").toLowerCase(java.util.Locale.ROOT));
        }
        Collections.sort(result);
        return result.toString();
    }

    private static String canonicalStrings(JSONArray values) throws JSONException {
        List<String> result = new ArrayList<>();
        for (int index = 0; index < values.length(); index += 1) result.add(values.getString(index));
        Collections.sort(result);
        return result.toString();
    }
}
