package org.rpgagent.runtime;

import android.os.Build;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class RPGAgentBridge {
    private final GameActivity activity;
    private final ContentStateStore state;
    private final ContentUpdateManager contentUpdates;
    private final ApkUpdateManager apkUpdates;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    RPGAgentBridge(GameActivity activity, ContentStateStore state) {
        this.activity = activity;
        this.state = state;
        contentUpdates = new ContentUpdateManager(state);
        apkUpdates = new ApkUpdateManager(activity);
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
                contentUpdates.install(payload);
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
                apkUpdates.install(payload);
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

    private void showFailure(String title, Exception error) {
        String details = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        activity.runOnUiThread(() -> Toast.makeText(activity, title + ": " + details + ". The previous game content was kept.", Toast.LENGTH_LONG).show());
    }
}
