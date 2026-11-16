package app.chartterminal;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.widget.FrameLayout;
import android.view.WindowInsets;
import android.view.View;
import android.os.Build;
import android.graphics.Insets;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Standalone build: the built web app (assets/www) is served from https://appassets.androidplatform.net by
 * shouldInterceptRequest, so it runs with no server. Market data comes straight from Binance's public API.
 * Navigation is limited to the asset origin; every other link opens in the system browser.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/index.html";
    private static final String ASSET_DIR = "www";
    private static final int PICK = 7;

    private WebView web;
    private ValueCallback<Uri[]> chooser;

    /** The asset origin, and the two Binance hosts the page may call (REST and WebSocket stream). */
    static boolean isAllowedHost(String scheme, String host) {
        if (host == null || scheme == null) return false;
        if (HOST.equals(host)) return "https".equals(scheme);
        if (!BuildConfig.BUG_REPORT_HOST.isEmpty() && BuildConfig.BUG_REPORT_HOST.equals(host)) return "https".equals(scheme);   // the bug-report receiver
        return ("https".equals(scheme) || "wss".equals(scheme))
            && ("data-api.binance.vision".equals(host) || "data-stream.binance.vision".equals(host));
    }

    /** Request path -> asset path under www/, or null when it must not be served (traversal, odd characters). */
    static String assetPath(String decodedPath) {
        if (decodedPath == null || decodedPath.isEmpty() || decodedPath.equals("/")) return ASSET_DIR + "/index.html";
        if (decodedPath.indexOf('\\') >= 0 || decodedPath.indexOf(0) >= 0) return null;
        StringBuilder sb = new StringBuilder(ASSET_DIR);
        for (String seg : decodedPath.split("/", -1)) {
            if (seg.isEmpty()) continue;                      // "//" collapses
            if (seg.equals(".") || seg.equals("..")) return null;
            sb.append('/').append(seg);
        }
        return sb.toString();
    }

    static String mimeOf(String path) {
        int d = path.lastIndexOf('.');
        String e = d < 0 ? "" : path.substring(d + 1).toLowerCase(Locale.ROOT);
        switch (e) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "map": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "svg": return "image/svg+xml";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "wasm": return "application/wasm";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private static WebResourceResponse reply(int code, String reason, String mime, InputStream body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, "utf-8", code, reason, h, body);
    }

    private static WebResourceResponse text(int code, String reason) {
        return reply(code, reason, "text/plain", new ByteArrayInputStream(reason.getBytes()));
    }

    private WebResourceResponse serve(WebResourceRequest r) {
        if (!"GET".equals(r.getMethod()) && !"HEAD".equals(r.getMethod())) return text(405, "Method Not Allowed");
        String path = assetPath(r.getUrl().getPath());          // getPath() is already percent-decoded
        if (path == null) return text(404, "Not Found");
        try {
            return reply(200, "OK", mimeOf(path), getAssets().open(path));
        } catch (IOException e) {
            return text(404, "Not Found");                      // includes /api/*: the app then runs standalone
        }
    }

    /** targetSdk 35 draws edge-to-edge: keep the page clear of the status bar, the navigation/gesture bar, the cut-out and the keyboard. */
    @SuppressWarnings("deprecation")
    static void fitSystemBars(View root) {
        root.setOnApplyWindowInsetsListener((v, i) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets s = i.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()), k = i.getInsets(WindowInsets.Type.ime());
                v.setPadding(s.left, s.top, s.right, Math.max(s.bottom, k.bottom));
                return WindowInsets.CONSUMED;
            }
            v.setPadding(i.getSystemWindowInsetLeft(), i.getSystemWindowInsetTop(), i.getSystemWindowInsetRight(), i.getSystemWindowInsetBottom());
            return i.consumeSystemWindowInsets();
        });
        root.requestApplyInsets();
    }

    /** One fixed page scale: no pinch zoom, no font scaling, no wide-viewport guessing, so the layout never jumps between sizes. */
    static void fixScale(WebSettings s) {
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this); if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web.setBackgroundColor(Color.parseColor("#131722"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                           // localStorage + IndexedDB persist in the app's data
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        fixScale(s);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost()) && "https".equals(u.getScheme())) return false;
                String sch = u.getScheme();
                if ("http".equals(sch) || "https".equals(sch)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                }
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return serve(r);
                if (isAllowedHost(u.getScheme(), u.getHost())) return null;   // Binance public data: straight to the network
                return text(403, "Blocked");
            }
        });
        web.setWebChromeClient(new JsDialogs() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = cb;
                try { startActivityForResult(p.createIntent(), PICK); }
                catch (Exception e) { chooser = null; return false; }
                return true;
            }
        });
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#131722"));
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        fitSystemBars(root);
        setContentView(root);
        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            chooser = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); if (web != null) web.saveState(b); }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { if (web != null) { web.destroy(); web = null; } super.onDestroy(); }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
