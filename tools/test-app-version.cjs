const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { prepare, resourcePart, STORAGE_KEY } = require('../build-templates/bytedance-mini-game/resource-version');
const config = JSON.parse(read('config/app-version.json'));
const generated = require('../build-templates/bytedance-mini-game/app-version');
assert.equal(generated.version, config.version);
assert.equal(JSON.parse(read('package.json')).version, config.version);
assert.ok(read('assets/scripts/core/AppVersion.ts').includes(`APP_VERSION = '${config.version}'`));
assert.equal(generated.resourceVersion, resourcePart(config.version));

function fixture(previous) {
    const data = new Map([[STORAGE_KEY, previous], ['find_difference_save', '{"level":10,"coins":300}']]);
    let clears = 0;
    const cc = { assetManager: { cacheManager: { cachedFiles: {}, clearCache() { clears++; } } } };
    const sdk = { getStorageSync: key => data.get(key), setStorageSync: (key, value) => data.set(key, value) };
    return { cc, sdk, data, clears: () => clears };
}
for (const previous of ['0.0.3.0', '0.0.3.1', '0.0.3.99']) {
    const f = fixture(previous);
    const commit = prepare(f.cc, f.sdk, '0.0.3.1');
    assert.equal(f.clears(), 0, '第四位变化不得清缓存');
    commit();
    assert.equal(f.data.get(STORAGE_KEY), '0.0.3.1');
}
for (const previous of [undefined, '', 'broken', '0.0.2.9', '0.1.3.1', '1.0.3.1', '0.0.4.1']) {
    const f = fixture(previous);
    const before = f.data.get('find_difference_save');
    const commit = prepare(f.cc, f.sdk, '0.0.3.1');
    assert.equal(f.clears(), 1, '首次接入、资源升级或回滚必须清缓存');
    assert.equal(f.data.get(STORAGE_KEY), previous, '启动未成功不得提交版本');
    commit();
    assert.equal(f.data.get(STORAGE_KEY), '0.0.3.1');
    assert.equal(f.data.get('find_difference_save'), before, '玩家数据不得变化');
}
const failed = fixture('0.0.2.1');
failed.cc.assetManager.cacheManager.clearCache = () => { throw Error('disk error'); };
assert.throws(() => prepare(failed.cc, failed.sdk, '0.0.3.1'), /disk error/);
assert.equal(failed.data.get(STORAGE_KEY), '0.0.2.1');
assert.throws(() => prepare({ assetManager: {} }, failed.sdk, '0.0.3.1'), /尚未初始化/);

// Render the real launch template and simulate its actual initialization sequence.
const ejs = require('D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/ejs');
const template = ejs.render(read('build-templates/bytedance-mini-game/game.ejs'), {
    isUsePhysX: false, polyfillsBundleFile: '', systemJsBundleFile: './system.js',
    importMapFile: './import-map.js', applicationJs: './application.js',
});
async function startup(previous, failStart = false, server = 'https://example.com/tt/0.0.3/') {
    const f = fixture(previous);
    const events = [];
    const originalClear = f.cc.assetManager.cacheManager.clearCache;
    f.cc.assetManager.cacheManager.clearCache = () => { events.push('clear'); originalClear(); };
    let beforeLoad;
    f.cc.game = { onPostInfrastructureInitDelegate: { add: callback => { beforeLoad = callback; } } };
    f.cc.settings = { querySettings: () => server };
    f.sdk.onShow = () => {};
    class Application {
        init() { events.push('init'); }
        async start() {
            beforeLoad();
            events.push('remote-bundles');
            if (failStart) throw Error('download failed');
            events.push('scene');
        }
    }
    const System = { warmup() {}, import: async name => name === 'cc' ? f.cc : { Application } };
    const modules = { './app-version': generated, './resource-version': { prepare }, './import-map.js': { default: {} } };
    vm.runInNewContext(template, { tt: f.sdk, System, canvas: null, console: { info() {}, warn() {}, error() {} },
        require: name => modules[name] || {}, globalThis: {} });
    await new Promise(resolve => setImmediate(resolve));
    return { f, events };
}
(async () => {
    const migrated = await startup('0.0.2.1');
    assert.deepEqual(migrated.events, ['init', 'clear', 'remote-bundles', 'scene']);
    assert.equal(migrated.f.data.get(STORAGE_KEY), config.version);
    const codeOnly = await startup('0.0.3.0');
    assert.equal(codeOnly.f.clears(), 0);
    const failedStart = await startup('0.0.2.1', true);
    assert.equal(failedStart.f.data.get(STORAGE_KEY), '0.0.2.1');
    for (const server of ['https://example.com/tt/0.0.1/', 'https://example.com/release/', 'https://example.com/tt/0.0.3', '']) {
        const customDirectory = await startup('0.0.2.1', false, server);
        assert.deepEqual(customDirectory.events, ['init', 'clear', 'remote-bundles', 'scene']);
        assert.equal(customDirectory.f.data.get(STORAGE_KEY), config.version, '资源目录名不得阻止启动');
    }
    console.log('PASS: 版本同步、第四位保留缓存、前三位迁移/回滚、首次接入、存档保留、启动顺序及失败重试。');
})().catch(error => { console.error(error); process.exitCode = 1; });
