package app.chartterminal;

import android.content.Context;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Listens for the server's LAN beacon (UDP broadcast, port 41771, JSON {ct:1,id,name,urls,v,mode,twofa}).
 * Runs only while the web page keeps polling discover(): it stops by itself ~10 s after the last poll (or on stop()).
 * Beacons are unauthenticated, so everything is length-limited and only private-LAN URLs are kept.
 */
final class Beacon {
    static final int PORT = 41771;
    private static final long EXPIRE_MS = 10_000, IDLE_MS = 10_000;
    private static final int MAX_SERVERS = 32;

    private static final class Entry { JSONObject json; long heard; }

    private final Map<String, Entry> seen = new LinkedHashMap<>();
    private boolean running;
    private long lastPoll;

    /** Called by discover(): keeps the listener alive and returns the servers heard in the last 10 s as a JSON array. */
    String poll(Context ctx) {
        synchronized (this) {
            lastPoll = System.currentTimeMillis();
            if (!running) { running = true; Context app = ctx.getApplicationContext(); Thread t = new Thread(() -> listen(app), "ct-beacon"); t.setDaemon(true); t.start(); }
            return snapshot(lastPoll);
        }
    }

    void stop() { synchronized (this) { lastPoll = 0; } }

    private synchronized String snapshot(long now) {
        JSONArray out = new JSONArray();
        for (Iterator<Entry> it = seen.values().iterator(); it.hasNext(); ) {
            Entry e = it.next();
            if (now - e.heard > EXPIRE_MS) { it.remove(); continue; }
            try { out.put(new JSONObject(e.json.toString()).put("ageMs", now - e.heard)); } catch (Exception ignored) { }
        }
        return out.toString();
    }

    private boolean idle() {
        synchronized (this) {
            if (System.currentTimeMillis() - lastPoll > IDLE_MS) { running = false; return true; }   // decided under the lock so poll() cannot miss the restart
            return false;
        }
    }

    private void listen(Context app) {
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
            if (wm != null) { lock = wm.createMulticastLock("ct-beacon"); lock.setReferenceCounted(false); lock.acquire(); }
            try (DatagramSocket s = new DatagramSocket(null)) {
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(PORT));
                s.setSoTimeout(1000);
                byte[] buf = new byte[2048];
                while (!idle()) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try { s.receive(p); } catch (SocketTimeoutException e) { continue; }
                    JSONObject j = parse(buf, p.getLength(), p.getAddress().getHostAddress());
                    if (j == null) continue;
                    synchronized (this) {
                        String id = j.optString("from") + "|" + j.optString("id");   // sender + id: a rogue cannot overwrite the real entry
                        if (!seen.containsKey(id) && seen.size() >= MAX_SERVERS) continue;
                        Entry e = new Entry(); e.json = j; e.heard = System.currentTimeMillis();
                        seen.put(id, e);
                    }
                }
            }
        } catch (Exception ignored) {
            // port busy or no Wi-Fi: discovery is simply empty
        } finally {
            if (lock != null && lock.isHeld()) lock.release();
            synchronized (this) { running = false; }
        }
    }

    /** Beacon bytes -> sanitised entry {id,name,urls,v,mode,twofa,from}, or null when it is not a valid beacon. */
    static JSONObject parse(byte[] d, int n, String from) {
        try {
            JSONObject b = new JSONObject(new String(d, 0, n, StandardCharsets.UTF_8));
            if (b.optInt("ct") != 1) return null;
            String id = clean(b.optString("id", ""), 64);
            if (id.isEmpty()) return null;
            JSONArray in = b.optJSONArray("urls");
            if (in == null) return null;
            List<String> urls = new ArrayList<>();
            for (int i = 0; i < in.length() && i < 8; i++) {
                String u = in.optString(i, "");
                if (u.length() > 200) continue;
                String o = MainActivity.normalise(u);
                String host = o == null ? null : android.net.Uri.parse(o).getHost();
                if (host == null || !host.equals(from) || !MainActivity.isLanHost(host)) continue;   // only the sender's own private address: a rogue cannot announce another host
                if (!urls.contains(o)) urls.add(o);
            }
            if (urls.isEmpty()) return null;
            String mode = "public".equals(b.optString("mode")) ? "public" : "private";
            return new JSONObject().put("id", id).put("name", clean(b.optString("name", ""), 60)).put("urls", new JSONArray(urls))
                .put("v", clean(b.optString("v", ""), 32)).put("mode", mode).put("twofa", b.optBoolean("twofa", false)).put("from", from);
        } catch (Exception e) { return null; }
    }

    static String clean(String s, int max) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length() && sb.length() < max; i++) { char c = s.charAt(i); if (c >= 0x20 && c != 0x7f) sb.append(c); }
        return sb.toString().trim();
    }
}
