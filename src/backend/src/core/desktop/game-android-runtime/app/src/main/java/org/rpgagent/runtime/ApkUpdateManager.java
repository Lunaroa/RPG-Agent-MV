package org.rpgagent.runtime;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.UUID;

final class ApkUpdateManager {
    private static final String INSTALL_ACTION = "org.rpgagent.runtime.INSTALL_RESULT";
    private final Activity activity;

    ApkUpdateManager(Activity activity) {
        this.activity = activity;
    }

    void install(String payloadText, UpdateProgressListener progress) throws IOException, JSONException, PackageManager.NameNotFoundException {
        JSONObject payload = new JSONObject(payloadText);
        JSONObject pkg = payload.optJSONObject("pkg");
        if (pkg == null || !"android".equals(pkg.optString("platform")) || !"apk".equals(pkg.optString("delivery"))) {
            throw new IOException("The selected update is not an Android APK package.");
        }
        String url = requireHttpUrl(payload.optString("packageUrl"));
        long expectedBytes = pkg.optLong("bytes", -1);
        String expectedSha256 = pkg.optString("sha256");
        String expectedApplicationId = pkg.optString("applicationId");
        long expectedVersionCode = pkg.optLong("versionCode", -1);
        String expectedCertificate = pkg.optString("signingCertificateSha256");
        if (expectedBytes < 0 || !expectedSha256.matches("(?i)[a-f0-9]{64}")
            || expectedApplicationId.isEmpty() || expectedVersionCode <= 0
            || !expectedCertificate.matches("(?i)[a-f0-9]{64}")) {
            throw new IOException("The APK release metadata is incomplete or invalid.");
        }

        File apk = new File(activity.getCacheDir(), "rpg-agent-update-" + UUID.randomUUID() + ".apk");
        boolean retainedForConfirmation = false;
        try {
            download(url, apk, expectedBytes, expectedSha256, progress);
            progress.onProgress("verifying", expectedBytes, expectedBytes, 0, null);
            PackageInfo archive = packageArchiveInfo(apk);
            if (archive == null || !expectedApplicationId.equals(archive.packageName)
                || packageVersionCode(archive) != expectedVersionCode) {
                throw new IOException("The downloaded APK identity or integer version does not match the release index.");
            }
            String archiveCertificate = signingCertificateSha256(archive);
            if (!archiveCertificate.equalsIgnoreCase(expectedCertificate)) {
                throw new IOException("The downloaded APK signing certificate does not match the release index.");
            }
            PackageInfo current = activity.getPackageManager().getPackageInfo(
                activity.getPackageName(), signingFlags()
            );
            boolean replacement = activity.getPackageName().equals(archive.packageName);
            if (replacement) {
                if (!archiveCertificate.equalsIgnoreCase(signingCertificateSha256(current))) {
                    throw new IOException("This APK was signed by a different identity and cannot replace the installed game.");
                }
                if (packageVersionCode(archive) <= packageVersionCode(current)) {
                    throw new IOException("The APK integer version must be greater than the installed version.");
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "Allow installs from this app, then choose the APK update again.", Toast.LENGTH_LONG).show();
                    Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(settings);
                });
                throw new IOException("Allow installs from this app in Android settings, then retry the update.");
            }
            progress.onProgress("installing", expectedBytes, expectedBytes, 0, null);
            if (replacement) commit(apk, archive.packageName);
            else {
                retainedForConfirmation = true;
                activity.runOnUiThread(() -> new AlertDialog.Builder(activity)
                .setTitle("Install as a new app?")
                .setMessage("This APK uses a different application ID. Android will install it as a separate app, and this game's private saves will not move automatically.")
                .setNegativeButton(android.R.string.cancel, (dialog, which) -> {
                    deleteDownloadedApk(apk);
                    progress.onProgress("error", 0, 0, 0, "The APK installation was canceled.");
                })
                .setPositiveButton("Continue", (dialog, which) -> {
                    try {
                        commit(apk, archive.packageName);
                    } catch (IOException error) {
                        progress.onProgress("error", 0, 0, 0, error.getMessage());
                        Toast.makeText(activity, error.getMessage(), Toast.LENGTH_LONG).show();
                    }
                })
                .setOnCancelListener(dialog -> {
                    deleteDownloadedApk(apk);
                    progress.onProgress("error", 0, 0, 0, "The APK installation was canceled.");
                })
                .show());
            }
        } finally {
            if (!retainedForConfirmation) deleteDownloadedApk(apk);
        }
    }

    private void commit(File apk, String packageName) throws IOException {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams parameters = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        parameters.setAppPackageName(packageName);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            parameters.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }
        int sessionId = installer.createSession(parameters);
        try (PackageInstaller.Session session = installer.openSession(sessionId);
             InputStream input = new FileInputStream(apk);
             OutputStream output = session.openWrite("game.apk", 0, apk.length())) {
            RuntimeFiles.copy(input, output);
            session.fsync(output);
            Intent result = new Intent(activity, InstallResultReceiver.class).setAction(INSTALL_ACTION);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            else flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pending = PendingIntent.getBroadcast(activity, sessionId, result, flags);
            session.commit(pending.getIntentSender());
        } catch (IOException | RuntimeException error) {
            installer.abandonSession(sessionId);
            throw error;
        } finally {
            deleteDownloadedApk(apk);
        }
    }

    private PackageInfo packageArchiveInfo(File apk) {
        PackageManager manager = activity.getPackageManager();
        int flags = signingFlags();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.PackageInfoFlags.of(flags));
        }
        return manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
    }

    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
    }

    private static long packageVersionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private static String signingCertificateSha256(PackageInfo info) throws IOException {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            signatures = info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length != 1) throw new IOException("The APK must have exactly one signing identity.");
        return RuntimeFiles.sha256(signatures[0].toByteArray());
    }

    private static void download(
        String value,
        File destination,
        long expectedBytes,
        String expectedSha256,
        UpdateProgressListener progress
    ) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(value).openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setUseCaches(false);
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IOException("APK download returned HTTP " + status + ".");
        }
        MessageDigest digest = RuntimeFiles.sha256Digest();
        long bytes = 0;
        long startedAt = android.os.SystemClock.elapsedRealtime();
        try (InputStream input = new BufferedInputStream(connection.getInputStream()); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                bytes += count;
                if (bytes > expectedBytes) throw new IOException("The APK is larger than declared.");
                output.write(buffer, 0, count);
                digest.update(buffer, 0, count);
                long elapsed = Math.max(1, android.os.SystemClock.elapsedRealtime() - startedAt);
                progress.onProgress("downloading", bytes, expectedBytes, bytes * 1000 / elapsed, null);
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }
        if (bytes != expectedBytes || !RuntimeFiles.hex(digest.digest()).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("The downloaded APK failed SHA-256 verification.");
        }
    }

    private static String requireHttpUrl(String value) throws IOException {
        try {
            URL parsed = new URL(value);
            if (!parsed.getProtocol().equals("http") && !parsed.getProtocol().equals("https")) throw new IOException("APK URL must use HTTP or HTTPS.");
            return parsed.toString();
        } catch (java.net.MalformedURLException error) {
            throw new IOException("The APK update URL is invalid.", error);
        }
    }

    private static void deleteDownloadedApk(File apk) {
        if (apk.exists() && !apk.delete()) apk.deleteOnExit();
    }
}
