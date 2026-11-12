'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const babel = require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/@babel/core');
const spread = require('D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/@babel/plugin-transform-spread');
// Match Creator's loose spread transform; TypeScript-only execution misses the packaged Set bug.
const compile = source => babel.transformSync(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText, { configFile: false, babelrc: false, plugins: [[spread, { loose: true }]] }).code;
const { openStore, createPlayStatsServer } = require('../server/play-stats/server.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'play-stats-test-'));
const catalog = { schemaVersion: 1, knownLevels: ['a/first', 'a/second', 'b/first'], chapters: {
    a: { initialCount: 219500, levels: ['a/first', 'a/second'] }, b: { initialCount: 0, levels: ['b/first'] },
    topic: { initialCount: 358400, levels: ['a/first', 'a/second', 'a/first', 'b/first'] },
} };
const storage = new Map(), exportsClient = {}, timers = new Set();
const timer = (fn, delay) => { const t = setTimeout(() => { timers.delete(t); fn(); }, delay); timers.add(t); return t; };
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlayStatsService.ts', 'utf8')), {
    exports: exportsClient, require: () => ({ sys: { localStorage: {} } }), console: { warn() {} },
    setTimeout: timer, clearTimeout: t => { timers.delete(t); clearTimeout(t); },
});
const clientStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const { PlayStatsService } = exportsClient;
const tick = () => new Promise(setImmediate);
const event = (id, levelId = 'a/first') => ({ id: 'event-000000-' + id, levelId });
let server;
(async () => {
    const dbPath = path.join(root, 'stats.sqlite');
    let store = openStore({ dbPath, catalog });
    assert.equal(store.counts(['a']).counts.a, 219500);
    store.record([event('1')]); store.record([event('1')]);
    assert.equal(store.counts(['a']).counts.a, 219501, 'A retry cannot count twice');
    store.record([event('2')]); assert.equal(store.counts(['a']).counts.a, 219502, 'A replay counts again even with the same level ID');
    assert.equal(store.counts(['topic']).counts.topic, 358402, 'Repeated membership cannot inflate parent totals');
    assert.throws(() => store.record([event('rollback', 'a/second'), event('1', 'b/first')]), /another level/);
    assert.equal(store.counts(['a']).counts.a, 219502, 'A rejected batch rolls back all changes');
    assert.throws(() => store.record([event('bad', 'unknown')]));
    store.close();
    const changedSeed = structuredClone(catalog); changedSeed.chapters.a.initialCount = 999;
    store = openStore({ dbPath, catalog: changedSeed });
    assert.equal(store.counts(['a']).counts.a, 219502, 'Restart/redeployment does not reseed or reset totals');
    store.close();

    ({ server } = createPlayStatsServer({ dbPath, catalog, rateLimit: 0, allowedOrigins: ['https://allowed.test'] }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const post = async events => { const response = await fetch(base + '/v1/play-events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }),
    }); return { status: response.status, data: await response.json() }; };
    await Promise.all(Array.from({ length: 40 }, (_, i) => post([event('concurrent-' + i, 'b/first')])));
    const counts = await (await fetch(base + '/v1/play-counts?keys=a,b,topic')).json();
    assert.equal(counts.counts.b, 40); assert.equal(counts.counts.topic, 358442);
    assert.equal((await post([event('concurrent-0', 'b/first')])).data.accepted.length, 0);
    assert.equal((await post([event('unknown', 'not-known')])).status, 400);
    assert.equal((await fetch(base + '/v1/play-counts?keys=missing')).status, 400);
    assert.equal((await fetch(base + '/healthz', { headers: { Origin: 'https://not-allowed.test' } })).status, 403);
    assert.equal((await fetch(base + '/healthz', { headers: { Origin: 'https://allowed.test' } })).headers.get('access-control-allow-origin'), 'https://allowed.test');

    const config = { enabled: true, initialCounts: { a: 219500 }, newChapters: ['b'] };
    let requests = 0, loseAcknowledgement = true;
    const host = { fetch: async (url, options) => {
        requests++; const response = await fetch(url, options);
        if (options.method === 'POST' && loseAcknowledgement) { loseAcknowledgement = false; throw Error('Connection lost after server commit'); }
        return response;
    }, AbortController };
    const first = new PlayStatsService(host, clientStorage, () => Date.now(), () => 0.5);
    first.configure(config, base); first.recordEntry('a/first'); await first.flush();
    assert.equal(first._queue.length, 1, 'Keep the same ID when response is lost');
    const id = first._queue[0].id; first.dispose();
    const restarted = new PlayStatsService(host, clientStorage); restarted.configure(config, base); await restarted.flush();
    assert.equal(restarted._queue.length, 0);
    const afterRetry = await restarted.getCounts(['a']);
    assert.equal(afterRetry.a, 219503, 'Response loss + client restart is exactly one play');
    assert.ok(id.length >= 12); assert.equal(restarted.isNewChapter('b'), true);
    const beforeReplay = afterRetry.a;
    restarted.recordEntry('a/first'); restarted.recordEntry('a/first'); await restarted.flush();
    assert.equal((await restarted.getCounts(['a'])).a, beforeReplay + 2);
    const beforeCache = requests; await Promise.all([restarted.getCounts(['a']), restarted.getCounts(['a'])]);
    assert.equal(requests, beforeCache, 'Repeated UI reads reuse totals for 30 seconds');
    restarted.dispose(); assert.equal(timers.size, 0);
    const disabled = new PlayStatsService({ fetch() { throw Error('Disabled statistics cannot request'); } }, clientStorage);
    disabled.configure({ ...config, enabled: false }, base); disabled.recordEntry('a/first');
    assert.equal((await disabled.getCounts(['a'])).a, 219500, 'Configured release starting value is visible before backend deployment');
    assert.equal(Object.keys(await disabled.getCounts(['unknown'])).length, 0, 'No fabricated count for unspecified chapters');
    disabled.dispose();

    const releaseConfig = JSON.parse(fs.readFileSync('assets/resources/configs/platform-config.json', 'utf8')).playStats;
    const release = new PlayStatsService({ fetch() { throw Error('Disabled release statistics cannot request'); } }, clientStorage);
    release.configure(releaseConfig);
    const releaseKeys = Object.keys(releaseConfig.initialCounts);
    const releaseCounts = await release.getCounts([...releaseKeys, releaseKeys[0], 'unknown']);
    assert.deepEqual(JSON.parse(JSON.stringify(releaseCounts)), releaseConfig.initialCounts,
        'After Creator loose compilation, all five release heat baselines survive deduplication and offline refresh');
    release.dispose();

    // Native request transport uses the same contract, without blocking on a login or API capability probe.
    let nativeCalls = 0;
    const native = new PlayStatsService({ tt: { request(options) { nativeCalls++; options.success({ statusCode: 200, data: { counts: { a: 219550 } } }); return { abort() {} }; } } }, clientStorage);
    native.configure(config, 'https://api.example.test'); assert.equal((await native.getCounts(['a'])).a, 219550);
    assert.equal(nativeCalls, 1); native.dispose();

    const backupFile = path.join(root, 'online-backup.sqlite');
    require('node:child_process').execFileSync(process.execPath, ['server/play-stats/backup.cjs', backupFile], {
        env: { ...process.env, DATA_PATH: dbPath }, stdio: 'pipe',
    });
    const backupStore = openStore({ dbPath: backupFile, catalog });
    assert.equal(backupStore.counts(['a']).counts.a, beforeReplay + 2, 'Online backup retains baselines and accepted events');
    backupStore.close();

    const core = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/core/PlayStats.ts', 'utf8')), { exports: core });
    assert.deepEqual([219500,58750,103700,60880,358400].map(core.formatPlayCount), ['219.5K','58.75K','103.7K','60.88K','358.4K']);
    assert.equal(core.formatPlayCount(0), '0'); assert.equal(core.formatPlayCount(-1), '');
    const production = JSON.parse(fs.readFileSync('server/play-stats/catalog.json'));
    assert.equal(production.knownLevels.length, 325); assert.equal(production.chapters['lian-ai-mei-shi'].levels.length, 120);
    console.log('PASS play statistics with Creator loose spread: server persistence/baselines, concurrency, idempotency and rollback; client offline/restart/replay/native/cache/disabled paths; all five release counts and 325-level catalog');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const t of timers) clearTimeout(t);
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('play-stats-test-')) throw Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
});
