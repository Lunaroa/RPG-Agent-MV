package org.rpgagent.runtime;

import android.os.Build;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class RPGAgentBridge {
    private static final long PROGRESS_INTERVAL_MS = 100;
    private final GameActivity activity;
    private final ContentStateStore state;
    private final ContentUpdateManager contentUpdates;
    private final ApkUpdateManager apkUpdates;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final UpdateProgressListener progress;
    private long lastProgressDispatchAt;

    RPGAgentBridge(GameActivity activity, ContentStateStore state) {
        this.activity = activity;
        this.state = state;
        contentUpdates = new ContentUpdateManager(state);
        apkUpdates = new ApkUpdateManager(activity);
        progress = this::reportProgress;
    }

    @JavascriptInterface
    public String getAbi() {
        return Build.SUPPORTED_ABIS.length == 0 ? "" : Build.SUPPORTED_ABIS[0];
    }

    @JavascriptInterface
    public String getCurrentReleaseId() {
        return state.currentReleaseId();
    }

    @JavascriptInterface
    public boolean installContentUpdate(String payload) {
        if (payload == null || payload.length() > 8 * 1024 * 1024) return false;
        worker.execute(() -> {
            try {
                contentUpdates.install(payload, progress);
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "Update verified. Restarting game content…", Toast.LENGTH_LONG).show();
                    activity.reloadGameContent();
                });
            } catch (Exception error) {
                showFailure("Content update failed", error);
            }
        });
        return true;
    }

    @JavascriptInterface
    public boolean installApkUpdate(String payload) {
        if (payload == null || payload.length() > 8 * 1024 * 1024) return false;
        worker.execute(() -> {
            try {
                apkUpdates.install(payload, progress);
            } catch (Exception error) {
                showFailure("APK update failed", error);
            }
        });
        return true;
    }

    @JavascriptInterface
    public void markContentHealthy() {
        worker.execute(() -> {
            try {
                state.markHealthy();
            } catch (Exception error) {
                showFailure("Could not confirm the updated content", error);
            }
        });
    }

    void shutdown() {
        worker.shutdownNow();
    }

    private void reportProgress(String stage, long received, long total, long bytesPerSecond, String message) {
        if ("downloading".equals(stage)) {
            long now = android.os.SystemClock.elapsedRealtime();
            if (received < total && now - lastProgressDispatchAt < PROGRESS_INTERVAL_MS) return;
            lastProgressDispatchAt = now;
        } else {
            lastProgressDispatchAt = 0;
        }
        activity.dispatchUpdateEvent(stage, received, total, bytesPerSecond, message);
    }

    private void showFailure(String title, Exception error) {
        String details = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        progress.onProgress("error", 0, 0, 0, details);
        activity.runOnUiThread(() -> Toast.makeText(activity, title + ": " + details + ". The previous game content was kept.", Toast.LENGTH_LONG).show());
    }
}
