package org.rpgagent.runtime;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

public final class InstallResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null) {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
            }
            return;
        }
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_SUCCESS) {
            GameActivity.dispatchInstallResult("complete", "Game update installed.");
            Toast.makeText(context, "Game update installed.", Toast.LENGTH_LONG).show();
        } else {
            String details = message == null ? "Android rejected it." : message;
            GameActivity.dispatchInstallResult("error", details);
            Toast.makeText(context, "Game update was not installed: " + details, Toast.LENGTH_LONG).show();
        }
    }
}
