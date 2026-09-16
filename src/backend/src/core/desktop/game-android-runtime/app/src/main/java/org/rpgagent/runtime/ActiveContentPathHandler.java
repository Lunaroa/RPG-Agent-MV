package org.rpgagent.runtime;

import android.net.Uri;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

final class ActiveContentPathHandler implements WebViewAssetLoader.PathHandler {
    private final ContentStateStore state;

    ActiveContentPathHandler(ContentStateStore state) {
        this.state = state;
    }

    @Nullable
    @Override
    public WebResourceResponse handle(@NonNull String encodedPath) {
        String relativePath = Uri.decode(encodedPath);
        try {
            File active = state.resolveActiveFile(relativePath);
            InputStream input;
            if (active != null) input = new FileInputStream(active);
            else if (state.isPackagedContentActive()) input = state.openPackagedFile(relativePath);
            else return null;
            return new WebResourceResponse(mimeType(relativePath), textEncoding(relativePath), input);
        } catch (IOException error) {
            return null;
        }
    }

    private static String mimeType(String path) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(path).toLowerCase(Locale.ROOT);
        String value = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if (value != null) return value;
        if (extension.equals("json") || extension.equals("rpgmvp") || extension.equals("rpgmvo") || extension.equals("rpgmvm")) {
            return "application/octet-stream";
        }
        return "application/octet-stream";
    }

    private static String textEncoding(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css") || lower.endsWith(".json")
            ? "UTF-8"
            : null;
    }
}
