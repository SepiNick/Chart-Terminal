package app.chartterminal;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;

public class ExchangeProxyTest {
    @Test public void allowsListedHostsOverHttpsOnly() {
        assertTrue(ExchangeProxy.handles("https", "api.bybit.com"));
        assertTrue(ExchangeProxy.handles("https", "API.Kraken.com"));
        assertTrue(ExchangeProxy.handles("https", "api.hbdm.vn"));
        assertFalse(ExchangeProxy.handles("http", "api.bybit.com"));
        assertFalse(ExchangeProxy.handles("wss", "api.bybit.com"));
    }

    @Test public void requiredHostsPresent() {
        for (String h : new String[] {"lbkperp.lbank.com", "papi.binance.com", "deriv-api.crypto.com", "api-broker.kucoin.com",
            "api.bitso.com", "api.hyperliquid.xyz", "fapi.binance.com"})
            assertTrue(h, ExchangeProxy.handles("https", h));
    }

    @Test public void rejectsUnlistedPrivateAndLiteralHosts() {
        for (String h : new String[] {null, "", "evil.com", "api.bybit.com.evil.com", "sub.api.bybit.com", "localhost", "127.0.0.1",
            "10.0.0.1", "192.168.1.1", "169.254.169.254", "[::1]", "::1", "appassets.androidplatform.net"})
            assertFalse(String.valueOf(h), ExchangeProxy.handles("https", h));
    }

    @Test public void listIsPublicDnsNamesOnlyAndUnique() {
        assertEquals(ExchangeHosts.ALL.length, new HashSet<>(Arrays.asList(ExchangeHosts.ALL)).size());
        assertTrue(ExchangeHosts.ALL.length > 100);
        for (String h : ExchangeHosts.ALL) {
            assertTrue(h, h.matches("[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+"));
            assertFalse(h, h.matches("[0-9.]+"));
            assertFalse(h, h.equals("localhost") || h.endsWith(".localhost"));
        }
        String[] sorted = ExchangeHosts.ALL.clone();
        Arrays.sort(sorted);
        assertTrue(Arrays.equals(sorted, ExchangeHosts.ALL));
    }

    @Test public void binanceHostsServedDirectlyAreNotProxied() {
        // MainActivity.shouldInterceptRequest checks isAllowedHost first; keep the proxy list disjoint anyway
        for (String h : ExchangeHosts.ALL)
            for (String s : new String[] {"https", "wss"})
                assertFalse(s + "://" + h, MainActivity.isAllowedHost(s, h));
    }

    @Test public void postOnlyOnExactHostPathWithSmallJson() {
        assertTrue(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/info", "application/json", 100));
        assertTrue(ExchangeProxy.postAllowed("API.hyperliquid.xyz", "/info", "application/json; charset=utf-8", ExchangeProxy.MAX_POST_BODY));
        assertFalse(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/exchange", "application/json", 10));
        assertFalse(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/info/", "application/json", 10));
        assertFalse(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/info", "text/plain", 10));
        assertFalse(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/info", null, 10));
        assertFalse(ExchangeProxy.postAllowed("api.hyperliquid.xyz", "/info", "application/json", ExchangeProxy.MAX_POST_BODY + 1));
        assertFalse(ExchangeProxy.postAllowed("api.bybit.com", "/info", "application/json", 10));
        assertFalse(ExchangeProxy.postAllowed(null, "/info", "application/json", 10));
    }

    @Test public void responseContentTypeFilter() {
        for (String t : new String[] {"application/json", "application/json; charset=utf-8", "TEXT/PLAIN", "text/csv", "application/octet-stream"})
            assertTrue(t, ExchangeProxy.responseTypeAllowed(t));
        for (String t : new String[] {"text/html", "text/html; charset=utf-8", "image/svg+xml", "application/javascript", "application/xhtml+xml", "", null})
            assertFalse(String.valueOf(t), ExchangeProxy.responseTypeAllowed(t));
    }

    @Test public void requestHeaderAllowlist() {
        for (String h : new String[] {"Accept", "accept-language", "Content-Type", "User-Agent", "X-MBX-APIKEY"})
            assertTrue(h, ExchangeProxy.requestHeaderAllowed(h));
        for (String h : new String[] {"Authorization", "Cookie", "Origin", "Referer", "Host", "Accept-Encoding", "Sec-Fetch-Mode", "X-Anything", null})
            assertFalse(String.valueOf(h), ExchangeProxy.requestHeaderAllowed(h));
    }

    @Test public void reasonPhrases() {
        assertEquals("OK", ExchangeProxy.reason(200));
        assertEquals("Too Many Requests", ExchangeProxy.reason(429));
        assertEquals("Unsupported Media Type", ExchangeProxy.reason(415));
        assertEquals("Server Error", ExchangeProxy.reason(599));
        assertEquals("Client Error", ExchangeProxy.reason(499));
    }
}
