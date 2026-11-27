// HTTP + WebSocket entry point. Serves the built client from dist/ and the game on /ws.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { loadAllUniverses } from '../universes';
import { Lobby } from './lobby';
import { radioRoutes } from './radio';
import { soundtrackRoutes } from './soundtrack';

const PORT = Number(process.env.GRIDLOCK_PORT ?? process.env.PORT ?? 5228);
const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};

/** Every universe's manifest (radio folders, names); rooms install their own. */
const UNIVERSES = await loadAllUniverses();
const lobby = new Lobby({ universes: UNIVERSES });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(lobby.list()));
    return;
  }
  if (radioRoutes(req, res, url, UNIVERSES)) return;
  if (soundtrackRoutes(req, res, url, UNIVERSES)) return;
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    // Memory in use (MB): what an always-on host bills for.
    res.end(JSON.stringify({ ok: true, memMB: Math.round(process.memoryUsage().rss / 1e6), ...lobby.stats() }));
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('GRIDLOCK server is running. Build the client with `npm run build`, or use `npm run dev` and open port 5229.');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 64 * 1024,
  // Snapshots are repetitive JSON; deflate cuts them several-fold.
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 }, serverNoContextTakeover: false },
});
wss.on('connection', (ws) => lobby.attach(ws));

server.listen(PORT, () => {
  console.log(`GRIDLOCK server on http://localhost:${PORT}`);
  let interfaces: ReturnType<typeof networkInterfaces>;
  try {
    interfaces = networkInterfaces();
  } catch {
    // Some hosts allow listening but restrict network interface discovery.
    return;
  }
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${PORT}`);
  }
});
