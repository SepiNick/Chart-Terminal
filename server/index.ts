// Chart Terminal server: market data, login, synced app state, alerts and notifications, server-side forward tests,
// trade recording. HTTP on 127.0.0.1 (the Vite dev server proxies to it) and, when enabled, HTTPS on the LAN
// for phones and other devices (see lan.ts). Modules register their routes and WebSocket ops when imported.
import http from 'node:http';
import { handle, upgrade } from './core/http.ts';
import './market.ts';
import './authroutes.ts';
import './state.ts';
import './notify/index.ts';
import './alerts/index.ts';
import './forward.ts';
import './recorder.ts';
import './share.ts';
import './derivs.ts';
import './brokers/index.ts';
import './marketdata.ts';
import { startLan } from './lan.ts';
import * as cx from './ccxt.ts';

const HOST = '127.0.0.1', PORT = Number(process.env.PORT ?? 8787);
const server = http.createServer((req, res) => handle(req, res, false));
server.on('upgrade', upgrade);
server.listen(PORT, HOST, () => console.log(`Chart Terminal server on http://${HOST}:${PORT} (${cx.exchangeIds().length} exchanges + FX)`));
startLan();
