package org.rpgagent.runtime;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

public final class GameActivity extends Activity {
    private static final String GAME_URL = "https://appassets.androidplatform.net/game/index.html";
    private WebView webView;
    private ImageView splash;
    private ContentStateStore contentState;
    private RPGAgentBridge bridge;
    private WebViewAssetLoader assetLoader;
    private boolean rollbackAttempted;
    private static WeakReference<GameActivity> activeActivity = new WeakReference<>(null);

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeActivity = new WeakReference<>(this);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON, WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        try {
            contentState = new ContentStateStore(this);
        } catch (Exception error) {
            showFatal("Game content could not be opened", error);
            return;
        }
        assetLoader = new WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/game/", new ActiveContentPathHandler(contentState))
            .build();
        bridge = new RPGAgentBridge(this, contentState);
        setContentView(createGameView());
        configureWebView();
        webView.loadUrl(GAME_URL);
    }

    private View createGameView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = new ImageView(this);
        splash.setImageResource(org.rpgagent.runtime.R.drawable.splash);
        splash.setScaleType(ImageView.ScaleType.CENTER_CROP);
        splash.setBackgroundColor(Color.BLACK);
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left = 0;
            int top = 0;
            int right = 0;
            int bottom = 0;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P && insets.getDisplayCutout() != null) {
                left = insets.getDisplayCutout().getSafeInsetLeft();
                top = insets.getDisplayCutout().getSafeInsetTop();
                right = insets.getDisplayCutout().getSafeInsetRight();
                bottom = insets.getDisplayCutout().getSafeInsetBottom();
            }
            webView.setPadding(left, top, right, bottom);
            return insets;
        });
        return root;
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        webView.addJavascriptInterface(bridge, "RPGAgentAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equals(uri.getHost())) return false;
                String scheme = uri.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) return true;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (splash != null) splash.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame() || rollbackAttempted) return;
                try {
                    if (contentState.rollbackPendingUpdate()) {
                        rollbackAttempted = true;
                        Toast.makeText(GameActivity.this, "The updated content did not start, so the previous version was restored.", Toast.LENGTH_LONG).show();
                        reloadGameContent();
                    }
                } catch (Exception rollbackError) {
                    showFatal("Content update rollback failed", rollbackError);
                }
            }
        });
    }

    void reloadGameContent() {
        rollbackAttempted = false;
        splash.setVisibility(View.VISIBLE);
        webView.clearCache(true);
        webView.loadUrl(GAME_URL);
    }

    void dispatchUpdateEvent(String stage, long received, long total, long bytesPerSecond, String message) {
        JSONObject event = new JSONObject();
        try {
            event.put("stage", stage);
            event.put("received", received);
            event.put("total", total);
            event.put("bytesPerSecond", bytesPerSecond);
            if (message != null) event.put("message", message);
        } catch (Exception ignored) {
            return;
        }
        String argument = JSONObject.quote(event.toString());
        runOnUiThread(() -> {
            if (webView == null) return;
            webView.evaluateJavascript(
                "(function(value){if(globalThis.RPGAgentUpdater&&typeof RPGAgentUpdater.handleNativeEvent==='function'){RPGAgentUpdater.handleNativeEvent(value);}})(" + argument + ");",
                null
            );
        });
    }

    static void dispatchInstallResult(String stage, String message) {
        GameActivity activity = activeActivity.get();
        if (activity != null) activity.dispatchUpdateEvent(stage, 0, 0, 0, message);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){var d={key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true};document.dispatchEvent(new KeyboardEvent('keydown',d));setTimeout(function(){document.dispatchEvent(new KeyboardEvent('keyup',d));},0);})();",
            null
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.shutdown();
        if (webView != null) {
            webView.removeJavascriptInterface("RPGAgentAndroid");
            webView.stopLoading();
            webView.destroy();
        }
        if (activeActivity.get() == this) activeActivity.clear();
        super.onDestroy();
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void showFatal(String title, Exception error) {
        String details = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        new android.app.AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(details)
            .setCancelable(false)
            .setPositiveButton(android.R.string.ok, (dialog, which) -> finish())
            .show();
    }
}
