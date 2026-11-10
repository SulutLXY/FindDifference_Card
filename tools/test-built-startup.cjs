'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { auditBuiltStartup } = require('./audit-built-startup.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-bundle-test-'));
function write(file, value) {
    const target = path.join(root, file.startsWith('remote/')?file:'game/'+file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value));
}
const settings = { assets: { preloadBundles: [{ bundle: 'resources' }, { bundle: 'main' }],
    remoteBundles: ['MainGameSources', 'LobbySources', 'chapter-covers', 'food-icons'],
    bundleVers: { internal: 'a', resources: 'b', main: 'c', MainGameSources: 'd' } } };
try {
    write('src/settings.test.json', settings);
    write('game.json', { enableIOSHighPerformanceMode: true });
    write('assets/internal/config.a.json', { deps: [], redirect: [] });
    write('assets/resources/config.b.json', { deps: [], redirect: [] });
    write('assets/main/config.c.json', { deps: ['resources'], redirect: [1, '0'] });
    write('remote/MainGameSources/config.d.json', { deps: ['resources'], paths: { 0: ['prefabs/GameScreen', 0] } });
    assert.equal(auditBuiltStartup(path.join(root,'game')).gameplay.remote, true);
    // Reproduce the screenshot failure: both local and remote gameplay are unloaded during scene creation.
    write('assets/resources/config.b.json', { deps: ['MainGameSources'], redirect: [2, '0'] });
    assert.throws(() => auditBuiltStartup(path.join(root,'game')), /resources redirects.*unloaded bundle MainGameSources/);
    settings.assets.remoteBundles.shift(); write('src/settings.test.json', settings);
    assert.throws(() => auditBuiltStartup(path.join(root,'game')), /unloaded bundle MainGameSources/);
    write('assets/resources/config.b.json', { deps: [], redirect: [] });
    assert.throws(() => auditBuiltStartup(path.join(root,'game')), /intended remote bundle config/);
    settings.assets.remoteBundles.unshift('MainGameSources'); write('src/settings.test.json', settings);
    write('remote/MainGameSources/config.d.json', { deps: ['LobbySources'], paths: { 0: ['prefabs/GameScreen', 0] } });
    assert.throws(() => auditBuiltStartup(path.join(root,'game')), /Gameplay unexpectedly requires LobbySources/);
    write('remote/MainGameSources/config.d.json', { deps: ['resources'], paths: { 0: ['prefabs/GameScreen', 0] } });
    write('game.json', {}); assert.throws(() => auditBuiltStartup(path.join(root,'game')), /high-performance/);
    console.log('PASS: compiled startup redirects rejected before runtime, local/remote gameplay order, menu isolation and high-performance config.');
} finally {
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('startup-bundle-test-')) throw Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
}
