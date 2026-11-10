'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const fail = (status, message) => Object.assign(new Error(message), { status });

function openStore({ dbPath, catalog, now = () => Date.now() }) {
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.knownLevels) || !catalog.chapters) throw Error('Invalid catalog');
    const known = new Set(catalog.knownLevels), chapters = new Map();
    for (const [key, chapter] of Object.entries(catalog.chapters)) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key) || !isCount(chapter.initialCount)
            || !Array.isArray(chapter.levels) || !chapter.levels.every(id => known.has(id))) throw Error('Invalid chapter ' + key);
        chapters.set(key, { ...chapter, levels: [...new Set(chapter.levels)] });
    }
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS play_events(id TEXT PRIMARY KEY, level_id TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS level_totals(level_id TEXT PRIMARY KEY, plays INTEGER NOT NULL CHECK(plays>=0));
        CREATE TABLE IF NOT EXISTS chapter_baselines(chapter_key TEXT PRIMARY KEY, plays INTEGER NOT NULL CHECK(plays>=0), created_at INTEGER NOT NULL);`);
    const seed = db.prepare('INSERT INTO chapter_baselines(chapter_key,plays,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING');
    for (const [key, chapter] of chapters) seed.run(key, chapter.initialCount, now());
    const find = db.prepare('SELECT level_id FROM play_events WHERE id=?');
    const insert = db.prepare('INSERT INTO play_events(id,level_id,created_at) VALUES(?,?,?)');
    const increment = db.prepare('INSERT INTO level_totals(level_id,plays) VALUES(?,1) ON CONFLICT(level_id) DO UPDATE SET plays=plays+1');
    const allTotals = db.prepare('SELECT level_id,plays FROM level_totals');
    const baselines = db.prepare('SELECT chapter_key,plays FROM chapter_baselines');
    return {
        record(events) {
            if (!Array.isArray(events) || events.length < 1 || events.length > 20) throw fail(400, 'Expected 1-20 events');
            for (const event of events) if (!event || typeof event.id !== 'string' || !/^[a-zA-Z0-9_-]{12,128}$/.test(event.id)
                || typeof event.levelId !== 'string' || !known.has(event.levelId)) throw fail(400, 'Invalid event or unknown stable level ID');
            const acknowledged = [], accepted = [];
            db.exec('BEGIN IMMEDIATE');
            try {
                for (const event of events) {
                    const existing = find.get(event.id);
                    if (existing && existing.level_id !== event.levelId) throw fail(409, 'Event ID already belongs to another level');
                    if (!existing) { insert.run(event.id, event.levelId, now()); increment.run(event.levelId); accepted.push(event.id); }
                    acknowledged.push(event.id);
                }
                db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
            return { acknowledged, accepted };
        },
        counts(keys) {
            if (!Array.isArray(keys) || keys.length < 1 || keys.length > 50 || !keys.every(key => chapters.has(key))) throw fail(400, 'Unknown chapter keys');
            const totals = new Map(allTotals.all().map(row => [row.level_id, row.plays]));
            const initial = new Map(baselines.all().map(row => [row.chapter_key, row.plays]));
            const counts = Object.create(null);
            for (const key of new Set(keys)) {
                const count = chapters.get(key).levels.reduce((sum, id) => sum + (totals.get(id) || 0), initial.get(key) || 0);
                if (!isCount(count)) throw Error('Count outside safe integer range');
                counts[key] = count;
            }
            return { counts, updatedAt: now() };
        },
        close() { db.close(); },
    };
}

function createPlayStatsServer({ dbPath, catalog, trustProxy = false, allowedOrigins = [], rateLimit = 600, now } = {}) {
    const store = openStore({ dbPath, catalog, now }), limits = new Map();
    const send = (res, status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(JSON.stringify(body));
    };
    const server = http.createServer(async (req, res) => {
        try {
            if (req.url.length > 8192) throw fail(414, 'URL too long');
            const origin = req.headers.origin;
            if (origin) {
                if (!allowedOrigins.includes(origin)) throw fail(403, 'Origin not allowed');
                res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin');
                res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
                res.setHeader('access-control-allow-headers', 'content-type');
            }
            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
            const url = new URL(req.url, 'http://localhost');
            if (req.method === 'GET' && url.pathname === '/healthz') { send(res, 200, { ok: true }); return; }
            const ip = trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
            const minute = Math.floor(Date.now() / 60000), limit = limits.get(ip);
            if (limits.size > 10000) for (const [key, item] of limits) if (item.minute !== minute) limits.delete(key);
            if (!limit || limit.minute !== minute) limits.set(ip, { minute, count: 1 }); else limit.count++;
            if (rateLimit > 0 && limits.get(ip).count > rateLimit) { res.setHeader('retry-after', '60'); throw fail(429, 'Rate limit exceeded'); }
            if (req.method === 'GET' && url.pathname === '/v1/play-counts') {
                send(res, 200, store.counts((url.searchParams.get('keys') || '').split(','))); return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/play-events') {
                if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) throw fail(415, 'JSON required');
                if (Number(req.headers['content-length']) > 65536) { req.resume(); throw fail(413, 'Body too large'); }
                let size = 0; const chunks = [];
                for await (const chunk of req) { size += chunk.length; if (size > 65536) throw fail(413, 'Body too large'); chunks.push(chunk); }
                let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON'); }
                send(res, 200, store.record(body.events)); return;
            }
            throw fail(404, 'Not found');
        } catch (error) {
            const status = error.status || 500;
            if (status === 500) console.error('[PlayStats]', error);
            if (!res.headersSent) send(res, status, { error: status === 500 ? 'Internal server error' : error.message });
        }
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
    server.on('close', () => store.close());
    return { server, store };
}

if (require.main === module) {
    const catalog = JSON.parse(fs.readFileSync(process.env.CATALOG_PATH || path.join(__dirname, 'catalog.json'), 'utf8'));
    const { server } = createPlayStatsServer({ catalog,
        dbPath: process.env.DATA_PATH || path.join(__dirname, 'data', 'plays.sqlite'),
        trustProxy: process.env.TRUST_PROXY === '1', allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
        rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE || 600) });
    server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => console.log('[PlayStats] listening', server.address()));
    const shutdown = () => { server.close(); server.closeIdleConnections(); setTimeout(() => { server.closeAllConnections(); }, 1000).unref(); };
    process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
module.exports = { openStore, createPlayStatsServer };
