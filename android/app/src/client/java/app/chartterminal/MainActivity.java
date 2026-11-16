package app.chartterminal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.WindowInsets;
import android.os.Build;
import android.graphics.Insets;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Pattern;

/** Thin client: asks for the server address once, validates it, then shows it full-screen. */
public class MainActivity extends Activity {
    private static final Pattern PRIVATE_V4 = Pattern.compile(
        "^(10\\.\\d+\\.\\d+\\.\\d+|192\\.168\\.\\d+\\.\\d+|172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+|127\\.\\d+\\.\\d+\\.\\d+)$");

    private SharedPreferences prefs;
    private WebView web;
    private String origin;

    /** http:// is only allowed for private LAN hosts; https:// is allowed anywhere. */
    static boolean isPrivateHost(String h) {
        return h != null && (h.equals("localhost") || PRIVATE_V4.matcher(h).matches());
    }

    /** Same scheme, host and effective port (default 80/443). */
    static boolean sameOrigin(Uri a, Uri b) {
        if (a.getScheme() == null || a.getHost() == null || !a.getScheme().equals(b.getScheme())
            || !a.getHost().equalsIgnoreCase(b.getHost())) return false;
        return port(a) == port(b);
    }

    private static int port(Uri u) {
        return u.getPort() > 0 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80;
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

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("ct", MODE_PRIVATE);
        applyKeepAwake();
        String saved = prefs.getString("server", null);
        if (saved == null) showSetup(null); else showWeb(saved);
    }

    private void applyKeepAwake() {
        if (prefs.getBoolean("awake", false)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Returns a normalised origin (scheme://host[:port]) or null if the input is not acceptable. */
    private static String normalise(String in) {
        String s = in.trim();
        if (!s.contains("://")) s = "http://" + s;
        try {
            Uri u = Uri.parse(s);
            String sch = u.getScheme(), host = u.getHost();
            if (host == null || (!"http".equals(sch) && !"https".equals(sch))) return null;
            if ("http".equals(sch) && !isPrivateHost(host)) return null;
            return sch + "://" + host + (u.getPort() > 0 ? ":" + u.getPort() : "");
        } catch (Exception e) { return null; }
    }

    private void showSetup(String error) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setPadding(48, 48, 48, 48);
        l.setBackgroundColor(Color.parseColor("#131722"));
        TextView t = new TextView(this);
        t.setText("Chart Terminal\nServer address");
        t.setTextColor(Color.WHITE); t.setTextSize(20);
        EditText e = new EditText(this);
        e.setHint("https://192.168.1.20:8443  or  http://192.168.1.20:8787");
        e.setHintTextColor(Color.GRAY); e.setTextColor(Color.WHITE);
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        e.setSingleLine(true);
        e.setText(prefs.getString("server", ""));
        TextView msg = new TextView(this);
        msg.setTextColor(Color.parseColor("#EF5350"));
        msg.setText(error == null ? "" : error);
        Button go = new Button(this);
        go.setText("Connect");
        l.addView(t); l.addView(e); l.addView(msg); l.addView(go);
        setContentView(l);
        go.setOnClickListener(v -> {
            String o = normalise(e.getText().toString());
            if (o == null) {
                msg.setText("Invalid address. http:// is only allowed for private LAN IPs (10.x, 172.16-31.x, 192.168.x, localhost); use https:// otherwise.");
                return;
            }
            go.setEnabled(false); msg.setTextColor(Color.LTGRAY); msg.setText("Checking...");
            new Thread(() -> {
                String err = probe(o);
                runOnUiThread(() -> {
                    if (err == null) { prefs.edit().putString("server", o).apply(); showWeb(o); }
                    else { go.setEnabled(true); msg.setTextColor(Color.parseColor("#EF5350")); msg.setText(err); }
                });
            }).start();
        });
    }

    /** GET /api/auth/status with normal certificate validation. Returns an error text or null. */
    private static String probe(String origin) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(origin + "/api/auth/status").openConnection();
            c.setConnectTimeout(5000); c.setReadTimeout(5000);
            int code = c.getResponseCode();
            if (code != 200) return "Server answered HTTP " + code + ".";
            byte[] buf = new byte[512]; int n = c.getInputStream().read(buf);
            String body = n > 0 ? new String(buf, 0, n) : "";
            return body.contains("\"setup\"") ? null : "Not a Chart Terminal server.";
        } catch (javax.net.ssl.SSLException ex) {
            return "TLS certificate not trusted by this build. Use http:// on the LAN or a publicly trusted certificate (see docs/android-apk.md).";
        } catch (Exception ex) {
            return "Cannot reach the server: " + ex.getClass().getSimpleName();
        }
    }

    private void showWeb(String o) {
        origin = o;
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        fixScale(s);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (sameOrigin(u, Uri.parse(origin))) return false;
                String sch = u.getScheme();
                if ("http".equals(sch) || "https".equals(sch)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                }
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                v.evaluateJavascript(WS_GUARD, null);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("http".equals(u.getScheme()) && !isPrivateHost(u.getHost()))
                    return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame())
                    v.loadData("<body style='background:#131722;color:#ccc;font:16px sans-serif;padding:24px'>Cannot load "
                        + origin + ".<br>Press Back for the menu, then Change server.", "text/html", "utf-8");
            }
        });
        // Invisible hot corner: long-press opens the menu (Back on the first page does too).
        View corner = new View(this);
        corner.setOnLongClickListener(v -> { showMenu(); return true; });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(corner, new FrameLayout.LayoutParams(120, 120, Gravity.TOP | Gravity.END));
        fitSystemBars(root);
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#131722"));
        setContentView(root);
        web.loadUrl(origin);
    }

    private void showMenu() {
        boolean awake = prefs.getBoolean("awake", false);
        new AlertDialog.Builder(this).setTitle("Chart Terminal")
            .setItems(new String[]{"Reload", "Change server",
                "Keep screen on: " + (awake ? "ON (tap to turn off)" : "OFF (tap to turn on)"), "Exit"}, (d, i) -> {
                if (i == 0) web.reload();
                else if (i == 1) { web.destroy(); web = null; showSetup(null); }
                else if (i == 2) { prefs.edit().putBoolean("awake", !awake).apply(); applyKeepAwake(); }
                else finish();
            }).show();
    }

    @Override public void onBackPressed() {
        if (web != null) {
            if (web.canGoBack()) web.goBack(); else showMenu();
        } else super.onBackPressed();
    }
}
