package org.rpgagent.runtime;

import android.content.Context;
import android.content.res.AssetManager;
import android.system.ErrnoException;
import android.system.Os;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ContentStateStore {
    private static final String CONTENT_ROOT = "rpg-agent/content";
    private static final String STATE_NAME = "current.json";
    private final Context context;
    private final File root;
    private final File versions;
    private final File staging;
    private final File stateFile;
    private final String packagedReleaseId;
    private final String packagedVersion;
    private static final Pattern VERSION = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)(?: *-[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)*)?$");

    ContentStateStore(Context context) throws IOException, JSONException {
        this.context = context.getApplicationContext();
        root = new File(context.getFilesDir(), CONTENT_ROOT);
        versions = new File(root, "versions");
        staging = new File(root, "staging");
        stateFile = new File(root, STATE_NAME);
        if ((!versions.isDirectory() && !versions.mkdirs()) || (!staging.isDirectory() && !staging.mkdirs())) {
            throw new IOException("Could not create the private game-content directory.");
        }
        JSONObject packaged = readPackagedRelease(context.getAssets());
        packagedReleaseId = packaged.getString("releaseId");
        packagedVersion = packaged.getString("version");
        recoverPendingUpdate();
        reconcilePackagedContent();
    }

    synchronized String currentReleaseId() {
        JSONObject state = readState();
        String current = state == null ? packagedReleaseId : state.optString("currentReleaseId", packagedReleaseId);
        return hasVersion(current) ? current : packagedReleaseId;
    }

    synchronized boolean isPackagedContentActive() {
        return currentReleaseId().equals(packagedReleaseId);
    }

    synchronized File resolveActiveFile(String relativePath) throws IOException {
        String current = currentReleaseId();
        if (current.equals(packagedReleaseId)) return null;
        File version = versionDirectory(current);
        File file = RuntimeFiles.safeFile(version, relativePath);
        return file.isFile() ? file : null;
    }

    synchronized InputStream openPackagedFile(String relativePath) throws IOException {
        RuntimeFiles.safeFile(new File(context.getFilesDir(), "asset-path-check"), relativePath);
        return context.getAssets().open("game/" + relativePath);
    }

    synchronized File createStagingDirectory() throws IOException {
        File directory = new File(staging, UUID.randomUUID().toString()).getCanonicalFile();
        String prefix = staging.getCanonicalPath() + File.separator;
        if (!directory.getPath().startsWith(prefix) || !directory.mkdirs()) {
            throw new IOException("Could not create the private update staging directory.");
        }
        return directory;
    }

    synchronized void copyCurrentContentTo(File target) throws IOException {
        String current = currentReleaseId();
        if (current.equals(packagedReleaseId)) RuntimeFiles.copyAssetDirectory(context.getAssets(), "game", target);
        else RuntimeFiles.copyDirectory(versionDirectory(current), target);
    }

    synchronized void activate(File stagedGame, String releaseId, String version) throws IOException, JSONException {
        requireReleaseId(releaseId);
        requireVersion(version);
        if (!stagedGame.isDirectory()) throw new IOException("The verified Android update directory is missing.");
        String previous = currentReleaseId();
        File target = versionDirectory(releaseId);
        if (target.exists()) RuntimeFiles.deleteRecursively(target);
        renameAtomically(stagedGame, target);
        JSONObject state = new JSONObject();
        state.put("schemaVersion", 1);
        state.put("currentReleaseId", releaseId);
        state.put("currentVersion", version);
        state.put("previousReleaseId", previous);
        state.put("previousVersion", currentVersion());
        state.put("pending", true);
        writeState(state);
    }

    synchronized void markHealthy() throws IOException, JSONException {
        JSONObject state = readState();
        if (state == null || !state.optBoolean("pending", false)) return;
        state.put("pending", false);
        writeState(state);
        cleanupOldVersions(state.optString("currentReleaseId", packagedReleaseId), state.optString("previousReleaseId", packagedReleaseId));
    }

    synchronized boolean rollbackPendingUpdate() throws IOException, JSONException {
        JSONObject state = readState();
        if (state == null || !state.optBoolean("pending", false)) return false;
        String failed = state.optString("currentReleaseId", "");
        String previous = state.optString("previousReleaseId", packagedReleaseId);
        String previousVersion = state.optString("previousVersion", packagedVersion);
        if (!hasVersion(previous)) previous = packagedReleaseId;
        JSONObject restored = new JSONObject();
        restored.put("schemaVersion", 1);
        restored.put("currentReleaseId", previous);
        restored.put("currentVersion", previousVersion);
        restored.put("previousReleaseId", JSONObject.NULL);
        restored.put("pending", false);
        writeState(restored);
        if (!failed.isEmpty() && !failed.equals(previous) && !failed.equals(packagedReleaseId)) {
            File failedDirectory = versionDirectory(failed);
            if (failedDirectory.exists()) RuntimeFiles.deleteRecursively(failedDirectory);
        }
        return true;
    }

    private void recoverPendingUpdate() throws IOException, JSONException {
        JSONObject state = readState();
        if (state == null) return;
        String current = state.optString("currentReleaseId", packagedReleaseId);
        if (state.optBoolean("pending", false)) {
            rollbackPendingUpdate();
            return;
        }
        if (!hasVersion(current)) {
            JSONObject restored = new JSONObject();
            restored.put("schemaVersion", 1);
            restored.put("currentReleaseId", packagedReleaseId);
            restored.put("currentVersion", packagedVersion);
            restored.put("previousReleaseId", JSONObject.NULL);
            restored.put("pending", false);
            writeState(restored);
        }
    }

    private void reconcilePackagedContent() throws IOException, JSONException {
        JSONObject state = readState();
        if (state == null) return;
        String current = state.optString("currentReleaseId", packagedReleaseId);
        String version = state.optString("currentVersion", "");
        if (current.equals(packagedReleaseId)) return;
        if (version.isEmpty() || compareVersions(packagedVersion, version) >= 0) {
            JSONObject packaged = new JSONObject();
            packaged.put("schemaVersion", 1);
            packaged.put("currentReleaseId", packagedReleaseId);
            packaged.put("currentVersion", packagedVersion);
            packaged.put("previousReleaseId", current);
            packaged.put("previousVersion", version.isEmpty() ? JSONObject.NULL : version);
            packaged.put("pending", false);
            writeState(packaged);
        }
    }

    private String currentVersion() {
        JSONObject state = readState();
        return state == null ? packagedVersion : state.optString("currentVersion", packagedVersion);
    }

    private boolean hasVersion(String releaseId) {
        if (releaseId.equals(packagedReleaseId)) return true;
        try {
            return versionDirectory(releaseId).isDirectory();
        } catch (IOException error) {
            return false;
        }
    }

    private File versionDirectory(String releaseId) throws IOException {
        requireReleaseId(releaseId);
        return RuntimeFiles.safeFile(versions, releaseId);
    }

    private JSONObject readState() {
        if (!stateFile.isFile()) return null;
        try (InputStream input = new FileInputStream(stateFile)) {
            JSONObject value = new JSONObject(RuntimeFiles.readText(input));
            return value.optInt("schemaVersion", 0) == 1 ? value : null;
        } catch (IOException | JSONException error) {
            return null;
        }
    }

    private void writeState(JSONObject state) throws IOException {
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Could not create the content state directory.");
        File temporary = new File(root, STATE_NAME + "." + UUID.randomUUID() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write((state.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        renameAtomically(temporary, stateFile);
    }

    private void cleanupOldVersions(String current, String previous) throws IOException {
        File[] entries = versions.listFiles();
        if (entries == null) throw new IOException("Could not inspect stored content versions.");
        for (File entry : entries) {
            if (!entry.getName().equals(current) && !entry.getName().equals(previous)) RuntimeFiles.deleteRecursively(entry);
        }
    }

    private static JSONObject readPackagedRelease(AssetManager assets) throws IOException, JSONException {
        try (InputStream input = assets.open("game/.rpg-agent/current-release.json")) {
            JSONObject value = new JSONObject(RuntimeFiles.readText(input));
            String releaseId = value.optString("releaseId", "");
            String version = value.optString("version", "");
            requireReleaseId(releaseId);
            requireVersion(version);
            return value;
        }
    }

    private static void requireReleaseId(String value) throws IOException {
        if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._-]*")) {
            throw new IOException("The Android content release id is invalid.");
        }
    }

    private static void requireVersion(String value) throws IOException {
        if (value == null || !VERSION.matcher(value).matches()) throw new IOException("The Android content version is invalid.");
    }

    private static int compareVersions(String left, String right) throws IOException {
        Matcher a = VERSION.matcher(left);
        Matcher b = VERSION.matcher(right);
        if (!a.matches() || !b.matches()) throw new IOException("The Android content version is invalid.");
        for (int index = 1; index <= 3; index += 1) {
            String x = a.group(index).replaceFirst("^0+(?=\\d)", "");
            String y = b.group(index).replaceFirst("^0+(?=\\d)", "");
            if (x.length() != y.length()) return x.length() < y.length() ? -1 : 1;
            int compared = x.compareTo(y);
            if (compared != 0) return compared < 0 ? -1 : 1;
        }
        return 0;
    }

    private static void renameAtomically(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IOException("Could not create update destination.");
        try {
            Os.rename(source.getAbsolutePath(), target.getAbsolutePath());
        } catch (ErrnoException error) {
            throw new IOException("Could not atomically switch the Android content version.", error);
        }
    }
}
