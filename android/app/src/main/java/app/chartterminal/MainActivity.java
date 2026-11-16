package app.chartterminal;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One app, two modes (the last used one is restored at start):
 *  LOCAL  - the built web app (assets/www) is served from https://appassets.androidplatform.net by shouldInterceptRequest;
 *           no server, live data straight from Binance (REST and WebSocket); public REST of the other mainstream exchanges
 *           goes through ExchangeProxy (fixed host allowlist, GET only), which is what makes ccxt-style markets/OHLCV/ticker work.
 *  SERVER - the WebView loads the chosen server's origin directly (same-origin cookies, WebSocket): every exchange/broker the server has.
 * Navigation never leaves the current origin (other links open in the system browser). window.CTNative is exposed only
 * to the asset origin and the saved server origin.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ASSET_ORIGIN = "https://" + HOST;
    static final String HOME = ASSET_ORIGIN + "/index.html";
    private static final String ASSET_DIR = "www";
    private static final int PICK = 7, CAM = 21;
    private static final Pattern PRIVATE_V4 = Pattern.compile(
        "^(10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|127\\.\\d+\\.\\d+\\.\\d+)$");
    private static final int MAX_SAVED = 20;

    private SharedPreferences prefs;
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private PermissionRequest pendingCam;
    private final Beacon beacon = new Beacon();
    private boolean local;                    // current mode
    private String origin;                    // server origin in SERVER mode, null in LOCAL mode
    private volatile boolean trustedPage;     // main frame is on the asset origin or the saved server origin (read by the JS bridge thread)
    private boolean clearHistory, failed;

    // ---------- pure helpers ----------

    /** http:// is only allowed for private LAN hosts; https:// is allowed anywhere. */
    static boolean isPrivateHost(String h) {
        return h != null && (h.equals("localhost") || PRIVATE_V4.matcher(h).matches());
    }

    /** Private IPv4 on a real LAN (not loopback): the only hosts a beacon may announce. */
    static boolean isLanHost(String h) {
        return h != null && PRIVATE_V4.matcher(h).matches() && !h.startsWith("127.");
    }

    /** Same scheme, host and effective port (default 80/443). */
    static boolean sameOrigin(Uri a, Uri b) {
        if (a == null || b == null || a.getScheme() == null || a.getHost() == null || !a.getScheme().equals(b.getScheme())
            || !a.getHost().equalsIgnoreCase(b.getHost())) return false;
        return port(a) == port(b);
    }

    private static int port(Uri u) {
        return u.getPort() > 0 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80;
    }

    /** Returns a normalised origin (scheme://host[:port]) or null if the input is not acceptable. */
    static String normalise(String in) {
        if (in == null) return null;
        String s = in.trim();
        if (s.length() > 200) return null;
        if (!s.contains("://")) s = "http://" + s;
        try {
            Uri u = Uri.parse(s);
            String sch = u.getScheme(), host = u.getHost();
            if (host == null || (!"http".equals(sch) && !"https".equals(sch))) return null;
            if ("http".equals(sch) && !isPrivateHost(host)) return null;
            return sch + "://" + host + (u.getPort() > 0 ? ":" + u.getPort() : "");
        } catch (Exception e) { return null; }
    }

    /** The asset origin, and the two Binance hosts the local page may call (REST and WebSocket stream). */
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

    /** WebSockets bypass shouldInterceptRequest, so refuse ws:// to non-private hosts in the page itself. */
    private static final String WS_GUARD = "(function(){if(window.__ctWs)return;window.__ctWs=1;var W=window.WebSocket,"
        + "re=/^(localhost|127\\.\\d+\\.\\d+\\.\\d+|10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+)$/;"
        + "function S(u,p){var a=new URL(u,location.href);if(a.protocol!=='wss:'&&a.protocol!=='https:'&&!re.test(a.hostname))"
        + "throw new DOMException('blocked','SecurityError');return p===undefined?new W(u):new W(u,p)}"
        + "S.prototype=W.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){S[k]=W[k]});window.WebSocket=S})()";

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

    // ---------- saved servers / mode ----------

    private JSONArray savedList() {
        try { return new JSONArray(prefs.getString("servers", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    /** Adds or renames a server (newest first, capped). */
    private void saveServer(String url, String name) {
        JSONArray old = savedList(), out = new JSONArray();
        try {
            out.put(new JSONObject().put("url", url).put("name", name));
            for (int i = 0; i < old.length() && out.length() < MAX_SAVED; i++) {
                JSONObject o = old.optJSONObject(i);
                if (o != null && !url.equals(o.optString("url"))) out.put(o);
            }
        } catch (Exception ignored) { }
        prefs.edit().putString("servers", out.toString()).putString("server", url).apply();
    }

    private boolean isTrusted(Uri u) {
        if (u == null) return false;
        if (sameOrigin(u, Uri.parse(ASSET_ORIGIN))) return true;
        String s = prefs.getString("server", null);
        return s != null && sameOrigin(u, Uri.parse(s));
    }

    private Uri base() { return Uri.parse(local ? ASSET_ORIGIN : origin); }

    // UI thread only
    private void showLocal(boolean serversPage) {
        local = true; origin = null; failed = false; clearHistory = true;
        prefs.edit().putString("mode", "local").apply();
        web.loadUrl(serversPage ? HOME + "?r=" + System.currentTimeMillis() + "#servers" : HOME);
    }

    private void showServer(String o) { showServer(o, null); }

    /** pairCode: a QR-pairing code the server page redeems itself (as "#pair=<code>"); validated by the caller. */
    private void showServer(String o, String pairCode) {
        local = false; origin = o; failed = false; clearHistory = true;
        prefs.edit().putString("mode", "server").putString("server", o).apply();
        web.loadUrl(pairCode == null ? o : o + "/#pair=" + pairCode);
    }

    // ---------- lifecycle ----------

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("ct", MODE_PRIVATE);
        applyKeepAwake();
        web = new WebView(this);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web.setBackgroundColor(Color.parseColor("#131722"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                           // localStorage + IndexedDB persist in the app's data
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        fixScale(s);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "CTNative");   // every method checks trustedPage
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        // Invisible hot corner: long-press opens the menu (Back on the first page does too).
        View corner = new View(this);
        corner.setOnLongClickListener(v -> { showMenu(); return true; });
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(corner, new FrameLayout.LayoutParams(120, 120, Gravity.TOP | Gravity.END));
        fitSystemBars(root);
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#131722"));
        setContentView(root);

        String saved = prefs.getString("server", null), mode = prefs.getString("mode", null);
        if (saved != null && normalise(saved) == null) saved = null;
        boolean wantServer = saved != null && (mode == null || "server".equals(mode));   // an old client install has only "server"
        local = !wantServer; origin = wantServer ? saved : null;
        if (b != null && web.restoreState(b) != null) return;
        if (wantServer) showServer(saved); else showLocal(false);
    }

    private void applyKeepAwake() {
        if (prefs.getBoolean("awake", false)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); if (web != null) web.saveState(b); }
    @Override protected void onPause() { beacon.stop(); if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() { beacon.stop(); if (web != null) { web.destroy(); web = null; } super.onDestroy(); }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            chooser = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req != CAM) { super.onRequestPermissionsResult(req, perms, res); return; }
        PermissionRequest p = pendingCam; pendingCam = null;
        if (p == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) p.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else p.deny();
    }

    private void showMenu() {
        boolean awake = prefs.getBoolean("awake", false);
        new AlertDialog.Builder(this).setTitle("Chart Terminal")
            .setItems(new String[]{"Servers…", "Reload",
                "Keep screen on: " + (awake ? "ON (tap to turn off)" : "OFF (tap to turn on)"), "Exit"}, (d, i) -> {
                if (i == 0) showLocal(true);
                else if (i == 1) web.reload();
                else if (i == 2) { prefs.edit().putBoolean("awake", !awake).apply(); applyKeepAwake(); }
                else finish();
            }).show();
    }

    @Override public void onBackPressed() {
        if (web != null && !failed && web.canGoBack()) web.goBack(); else showMenu();
    }

    // ---------- WebView clients ----------

    private final class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (sameOrigin(u, base())) return false;
            String sch = u.getScheme();
            if ("http".equals(sch) || "https".equals(sch)) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
            }
            return true;
        }

        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
            trustedPage = isTrusted(Uri.parse(url));
            if (!url.startsWith("data:")) failed = false;
            v.evaluateJavascript(WS_GUARD, null);
        }

        @Override public void onPageFinished(WebView v, String url) {
            if (clearHistory && !url.startsWith("data:")) { clearHistory = false; v.clearHistory(); }
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String sch = u.getScheme(), host = u.getHost();
            if (local) {
                if (HOST.equals(host)) return serve(r);
                if (isAllowedHost(sch, host)) return null;      // Binance public data: straight to the network (checked first)
                if (ExchangeProxy.handles(sch, host)) return ExchangeProxy.serve(r);   // other exchanges' public REST: native proxy (no CORS)
                return text(403, "Blocked");
            }
            if (HOST.equals(host) || ("http".equals(sch) && !isPrivateHost(host)) || "ws".equals(sch) && !isPrivateHost(host)) return text(403, "Blocked");
            return null;
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) fail("Cannot load " + r.getUrl().getScheme() + "://" + r.getUrl().getHost() + ".");
        }

        @Override public void onReceivedSslError(WebView v, SslErrorHandler h, android.net.http.SslError e) {
            h.cancel();                                         // certificate validation is never disabled
            fail("The TLS certificate of " + origin + " is not trusted by this app. Use http:// on the home network or a publicly trusted certificate (see docs/android-apk.md).");
        }

        private void fail(String msg) {
            failed = true;
            web.loadData("<body style='background:#131722;color:#ccc;font:16px sans-serif;padding:24px'>" + msg.replace("<", "&lt;")
                + "<br><br>Press Back (or long-press the top-right corner) for the menu, then choose Servers.", "text/html", "utf-8");
        }
    }

    private WebResourceResponse serve(WebResourceRequest r) {
        if (!"GET".equals(r.getMethod()) && !"HEAD".equals(r.getMethod())) return text(405, "Method Not Allowed");
        String path = assetPath(r.getUrl().getPath());          // getPath() is already percent-decoded
        if (path == null) return text(404, "Not Found");
        try {
            return reply(200, "OK", mimeOf(path), getAssets().open(path));
        } catch (IOException e) {
            return text(404, "Not Found");                      // includes /api/*: the app then runs in local mode
        }
    }

    private final class Chrome extends JsDialogs {
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (chooser != null) chooser.onReceiveValue(null);
            chooser = cb;
            try { startActivityForResult(p.createIntent(), PICK); }
            catch (Exception e) { chooser = null; return false; }
            return true;
        }

        /** getUserMedia: only the app's own origins, only the camera (no microphone). */
        @Override public void onPermissionRequest(PermissionRequest req) {
            String[] r = req.getResources();
            if (!trustedPage || !isTrusted(req.getOrigin()) || r.length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r[0])) { req.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { req.grant(r); return; }
            if (pendingCam != null) pendingCam.deny();
            pendingCam = req;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAM);
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest req) { if (pendingCam == req) pendingCam = null; }
    }

    // ---------- window.CTNative ----------

    /** Methods run on a WebView background thread; all of them refuse unless the main frame is on a trusted origin. */
    private final class Bridge {
        /** [{id,name,urls:[...],v,mode:'private'|'public',twofa:bool,from:'<sender ip>',ageMs}] heard on the LAN in the last 10 s. Poll it (every ~3 s): listening stops ~10 s after the last call. */
        @JavascriptInterface public String discover() { return trustedPage ? beacon.poll(MainActivity.this) : "[]"; }

        /** {ok:true,url} (page then navigates to the server) or {ok:false,error}. */
        @JavascriptInterface public String openServer(String url, String name) {
            if (!trustedPage) return err("untrusted page");
            String o = normalise(url);
            if (o == null) return err("Invalid address. http:// is only allowed for private LAN IPs (10.x, 172.16-31.x, 192.168.x, localhost); use https:// otherwise.");
            String n = Beacon.clean(name == null ? "" : name, 60);
            if (n.isEmpty()) n = Uri.parse(o).getHost();
            final String nn = n;
            java.util.regex.Matcher pm = Pattern.compile("#pair=([A-Za-z0-9-]{10,14})$").matcher(url.trim());
            final String pc = pm.find() ? pm.group(1) : null;   // normalise() drops the fragment; keep a valid pairing code
            runOnUiThread(() -> { if (web == null) return; saveServer(o, nn); showServer(o, pc); });
            try { return ok().put("url", o).toString(); } catch (Exception e) { return ok().toString(); }
        }

        /** true when a server answers HTTP at this address (2.5 s, same URL rules as openServer; blocks, so call it from the page, not the UI thread). Used to pick the first reachable address of a pairing QR. */
        @JavascriptInterface public boolean probe(String url) {
            if (!trustedPage) return false;
            String o = normalise(url);
            if (o == null) return false;
            java.net.HttpURLConnection c = null;
            try {
                c = (java.net.HttpURLConnection) new java.net.URL(o + "/api/auth/status").openConnection();
                c.setConnectTimeout(2500); c.setReadTimeout(2500); c.setInstanceFollowRedirects(false);
                c.getResponseCode();
                return true;
            } catch (Exception e) { return false; }
            finally { if (c != null) c.disconnect(); }
        }

        /** {ok:true}: the page reloads in local mode (Binance only, data on this phone). */
        @JavascriptInterface public String openLocal() {
            if (!trustedPage) return err("untrusted page");
            runOnUiThread(() -> { if (web != null) showLocal(false); });
            return ok().toString();
        }

        /** [{url,name}] saved servers, newest first. */
        @JavascriptInterface public String servers() { return trustedPage ? savedList().toString() : "[]"; }

        /** Removes a saved server; {ok:true}. Forgetting the one in use drops back to local mode. */
        @JavascriptInterface public String forget(String url) {
            if (!trustedPage) return err("untrusted page");
            String o = normalise(url);
            if (o == null) return err("invalid url");
            runOnUiThread(() -> {
                JSONArray old = savedList(), out = new JSONArray();
                for (int i = 0; i < old.length(); i++) { JSONObject j = old.optJSONObject(i); if (j != null && !o.equals(j.optString("url"))) out.put(j); }
                SharedPreferences.Editor e = prefs.edit().putString("servers", out.toString());
                boolean cur = o.equals(prefs.getString("server", null));
                if (cur) e.remove("server");
                e.apply();
                if (cur && !local && web != null) showLocal(false);
            });
            return ok().toString();
        }

        /** App version name, e.g. "0.2.0". */
        @JavascriptInterface public String nativeVersion() { return BuildConfig.VERSION_NAME; }

        private JSONObject ok() { try { return new JSONObject().put("ok", true); } catch (Exception e) { return new JSONObject(); } }
        private String err(String m) { try { return new JSONObject().put("ok", false).put("error", m).toString(); } catch (Exception e) { return "{}"; } }
    }
}
