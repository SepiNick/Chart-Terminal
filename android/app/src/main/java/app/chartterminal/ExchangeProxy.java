package app.chartterminal;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Native proxy for exchange public APIs, used from shouldInterceptRequest so a page served from the
 * app origin can call them without CORS. Fixed host allowlist (ExchangeHosts, generated), https only,
 * GET (+ POST only on an exact host/path allowlist, JSON body capped at 64 KB), OPTIONS answered
 * locally, streamed response capped at 10 MB of decompressed bytes, 30 s overall deadline, redirects
 * re-checked against the allowlist, response content types filtered, request headers allowlisted.
 */
final class ExchangeProxy {
    static final Set<String> HOSTS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(ExchangeHosts.ALL)));

    /** host -> exact paths that may be POSTed (ccxt loads hyperliquid markets via POST /info). */
    static final Map<String, Set<String>> POST_PATHS = Collections.singletonMap("api.hyperliquid.xyz", Collections.singleton("/info"));

    static final int MAX_BYTES = 10 * 1024 * 1024;
    static final int MAX_POST_BODY = 64 * 1024;
    static final long DEADLINE_MS = 30_000;
    private static final int STEP_TIMEOUT_MS = 15_000;

    private static final Set<String> RESP_TYPES = new HashSet<>(Arrays.asList(
        "application/json", "text/plain", "text/csv", "application/octet-stream"));
    private static final Set<String> REQ_HEADERS = new HashSet<>(Arrays.asList(
        "accept", "accept-language", "content-type", "user-agent", "x-mbx-apikey"));

    static boolean handles(String scheme, String host) {
        // shortcut: exact-name list only (no wildcard subdomains); IP literals and localhost can never match
        return "https".equals(scheme) && host != null && HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    static boolean postAllowed(String host, String path, String contentType, long bodyLen) {
        if (host == null || path == null || contentType == null || bodyLen < 0 || bodyLen > MAX_POST_BODY) return false;
        Set<String> paths = POST_PATHS.get(host.toLowerCase(Locale.ROOT));
        return paths != null && paths.contains(path) && "application/json".equals(mimeOf(contentType));
    }

    static String mimeOf(String contentType) {
        return contentType == null ? null : contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
    }

    static boolean responseTypeAllowed(String contentType) {
        return RESP_TYPES.contains(mimeOf(contentType));
    }

    static boolean requestHeaderAllowed(String name) {
        return name != null && REQ_HEADERS.contains(name.toLowerCase(Locale.ROOT));
    }

    /** HTTP/2 has no reason phrase, so HttpURLConnection returns null; WebResourceResponse needs one. */
    static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 202: return "Accepted";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 408: return "Request Timeout";
            case 409: return "Conflict";
            case 415: return "Unsupported Media Type";
            case 418: return "I'm a teapot";
            case 422: return "Unprocessable Entity";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return code >= 500 ? "Server Error" : code >= 400 ? "Client Error" : code >= 300 ? "Redirect" : "OK";
        }
    }

    private static Map<String, String> cors() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        h.put("Access-Control-Allow-Headers", "*");
        h.put("Access-Control-Max-Age", "86400");
        h.put("Cache-Control", "no-store");
        h.put("X-Content-Type-Options", "nosniff");
        return h;
    }

    private static WebResourceResponse err(int code, String msg) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason(code), cors(), new ByteArrayInputStream(msg.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    /** Streams the (already decompressed) body, enforcing the byte cap and the overall deadline; closing releases the connection. */
    private static final class CappedStream extends InputStream {
        private final InputStream in;
        private final HttpURLConnection c;
        private final long deadline;
        private long total;
        CappedStream(InputStream in, HttpURLConnection c, long deadline) { this.in = in; this.c = c; this.deadline = deadline; }
        @Override public int read() throws IOException {
            byte[] b = new byte[1];
            int n = read(b, 0, 1);
            return n < 0 ? -1 : b[0] & 0xff;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (System.currentTimeMillis() > deadline) throw new IOException("deadline exceeded");
            int n = in.read(b, off, len);
            if (n > 0 && (total += n) > MAX_BYTES) throw new IOException("response too large");
            return n;
        }
        @Override public void close() throws IOException {
            try { in.close(); } finally { c.disconnect(); }
        }
    }

    static WebResourceResponse serve(WebResourceRequest r) {
        String m = r.getMethod();
        if ("OPTIONS".equals(m)) return new WebResourceResponse("text/plain", "utf-8", 204, reason(204), cors(), new ByteArrayInputStream(new byte[0]));
        boolean post = "POST".equals(m);
        if (!post && !"GET".equals(m)) return err(405, "Method Not Allowed");
        long deadline = System.currentTimeMillis() + DEADLINE_MS;
        HttpURLConnection c = null;
        try {
            URL u = new URL(r.getUrl().toString());
            for (int hop = 0; hop < 4; hop++) {
                if (!handles(u.getProtocol(), u.getHost()) || (u.getPort() != -1 && u.getPort() != 443) || u.getUserInfo() != null) return err(403, "Blocked");
                String ctype = null;
                for (Map.Entry<String, String> e : r.getRequestHeaders().entrySet())
                    if ("content-type".equalsIgnoreCase(e.getKey())) ctype = e.getValue();
                // WebResourceRequest exposes no request body, so an allowed POST goes out empty (length 0)
                if (post && !postAllowed(u.getHost(), u.getPath(), ctype, 0)) return err(405, "Method Not Allowed");
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) return err(504, "Deadline exceeded");
                int t = (int) Math.min(STEP_TIMEOUT_MS, left);
                c = (HttpURLConnection) u.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(t);
                c.setReadTimeout(t);
                c.setRequestMethod(post ? "POST" : "GET");
                for (Map.Entry<String, String> e : r.getRequestHeaders().entrySet())
                    if (requestHeaderAllowed(e.getKey())) c.setRequestProperty(e.getKey(), e.getValue());
                if (post) { c.setDoOutput(true); c.setFixedLengthStreamingMode(0); }
                int code = c.getResponseCode();
                String loc = c.getHeaderField("Location");
                if (code >= 300 && code < 400 && loc != null) { u = new URL(u, loc); c.disconnect(); c = null; continue; }
                String ct = c.getContentType();
                if (ct != null && !responseTypeAllowed(ct)) return err(415, "Unsupported content type");
                if (c.getContentLengthLong() > MAX_BYTES) return err(502, "Response too large");
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in == null) in = new ByteArrayInputStream(new byte[0]);
                String mime = ct == null ? "application/json" : mimeOf(ct);
                WebResourceResponse resp = new WebResourceResponse(mime, "utf-8", code, reason(code), cors(), new CappedStream(in, c, deadline));
                c = null; // the stream now owns the connection
                return resp;
            }
            return err(502, "Too many redirects");
        } catch (Exception e) {
            return err(502, "Proxy error: " + e);
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
