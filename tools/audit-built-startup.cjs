'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function auditBuiltStartup(directory) {
    const build = path.resolve(directory);
    const settingsFiles = fs.readdirSync(path.join(build, 'src')).filter(file => /^settings(?:\.[^.]+)?\.json$/.test(file));
    assert.equal(settingsFiles.length, 1, 'Expected one matching runtime settings file');
    const settings = read(path.join(build, 'src', settingsFiles[0])), assets = settings.assets;
    const preload = new Set(['internal', ...(assets.preloadBundles || []).map(item => item.bundle)]);
    const bundles = {};
    function config(name) {
        const remote = (assets.remoteBundles || []).includes(name);
        const dirs = remote ? [path.join(build, 'remote', name), path.join(path.dirname(build), 'remote', name)] : [path.join(build, 'assets', name)];
        const version = assets.bundleVers[name];
        const files = [`config.${version}.json`, 'config.json'];
        const file = dirs.flatMap(dir => files.map(name => path.join(dir, name))).find(file => fs.existsSync(file));
        assert.ok(file, `Missing bundle ${name} with matching version ${version}`);
        return read(file);
    }
    for (const name of preload) {
        assert.ok(!(assets.remoteBundles || []).includes(name), `Startup bundle must be local: ${name}`);
        const c = config(name);
        for (const dependency of c.deps || []) assert.ok(preload.has(dependency),
            `${name} redirects startup resources to unloaded bundle ${dependency}; fix shared-asset ownership instead of preloading all remote menus`);
        for (let i = 0; i < (c.redirect || []).length; i += 2) {
            const dependency = c.deps[Number(c.redirect[i + 1])];
            assert.ok(dependency && preload.has(dependency), `${name}: unsafe redirect ${c.redirect[i]} -> ${dependency}`);
        }
        bundles[name] = { deps: c.deps || [], redirectedAssets: (c.redirect || []).length / 2 };
    }
    assert.ok(preload.has('main') && preload.has('resources'));
    assert.ok((assets.remoteBundles || []).includes('MainGameSources'), 'Gameplay must retain the intended remote bundle config');
    const gameplay = config('MainGameSources');
    assert.ok(Object.values(gameplay.paths).some(entry => entry[0] === 'prefabs/GameScreen'), 'Missing gameplay prefab');
    for (const dependency of gameplay.deps || []) assert.ok(preload.has(dependency), `Gameplay unexpectedly requires ${dependency}`);
    const game = read(path.join(build, 'game.json'));
    assert.equal(game.enableIOSHighPerformanceMode, true, 'Build lost iOS high-performance setting');
    return { build: path.relative(process.cwd(), build).replace(/\\/g, '/'),
        startupBundles: bundles, gameplay: { remote: true, deps: gameplay.deps || [] },
        iosHighPerformanceConfigured: true, deviceVerified: false };
}
if (require.main === module) console.log(JSON.stringify(auditBuiltStartup(process.argv[2] || 'build/douying'), null, 2));
module.exports = { auditBuiltStartup };
