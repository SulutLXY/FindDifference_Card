'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const creator = process.env.COCOS_CREATOR_ROOT || 'D:/CocosCreator/v3.8.8';
const ejs = require(path.join(creator, 'resources/resources/3d/engine/node_modules/ejs'));
const ts = require(path.join(creator, 'resources/resources/3d/engine/node_modules/typescript'));
const root = 'build-templates/bytedance-mini-game/';
const read = file => fs.readFileSync(file, 'utf8');
assert.equal(JSON.parse(read(root + 'game.json')).enableIOSHighPerformanceMode, true);
const render = options => ejs.render(read(root + 'game.ejs'), {
    isUsePhysX: false, polyfillsBundleFile: '', systemJsBundleFile: './system.js',
    importMapFile: './import-map.js', applicationJs: './application.js', appid: 'test-app', ...options,
});
function strict(file, source) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    assert.equal(tree.parseDiagnostics.length, 0, file);
    assert.equal(tree.statements[0]?.expression?.text, 'use strict', file + ' must use strict mode');
    new vm.Script(source, { filename: file });
}
for (const isUsePhysX of [false, true]) for (const polyfillsBundleFile of ['', './polyfills.js'])
    strict('game.js', render({ isUsePhysX, polyfillsBundleFile }));
for (const file of ['resource-version.js', 'app-version.js', 'openDataContext/index.js', 'openDataContext/rank-core.js'])
    strict(file, read(root + file));
assert.ok(read('tools/sync-app-version.cjs').includes("`'use strict';\\n"), 'Regeneration must retain strict mode');

async function launch({ highPerformance, width, height, dpr }) {
    let clock = 1000, infrastructure, commits = 0, earlyFeed, earlyShow;
    const logs = [], host = {}, canvas = { width, height };
    const cc = { game: { onPostInfrastructureInitDelegate: { add(fn) { infrastructure = fn; } } } };
    class Application {
        init() { clock += 30; }
        start() { infrastructure(); clock += 50; }
    }
    const modules = { './app-version': { version: '0.1.5.2' }, './resource-version': { prepare() { return () => { commits++; }; } },
        './import-map.js': { default: {} } };
    const native = highPerformance === undefined ? {} : { isIOSHighPerformanceMode: highPerformance };
    const context = {
        globalThis: host, GameGlobal: native, canvas, screen: { width: 390, height: 844 }, window: { devicePixelRatio: dpr },
        Date: { now: () => clock }, console: { info: (...args) => logs.push(args), warn() {}, error(error) { throw error; } },
        tt: { canIUse: () => true, onFeedStatusChange(fn) { earlyFeed = fn; }, onShow(fn) { earlyShow = fn; },
            getLaunchOptionsSync: () => ({ scene: '023041' }) },
        System: { warmup() {}, import: async name => name === 'cc' ? cc : { Application } },
        require: name => modules[name] || {},
    };
    if (highPerformance === undefined) delete context.GameGlobal;
    vm.runInNewContext(render(), context);
    earlyShow({ scene: '023041' }); earlyFeed({ type: 'feedEnter' });
    await new Promise(setImmediate);
    assert.equal(commits, 1, 'Resource cache migration still commits after successful start');
    assert.deepEqual(canvas, { width, height }, 'DPR must not multiply the adapter framebuffer');
    const state = host.__findDifferencePerformance;
    assert.equal(state.isIOSHighPerformanceMode, highPerformance === true);
    assert.deepEqual(Object.keys(state.stages), ['script-start', 'engine-ready', 'scene-started']);
    assert.equal(state.stages['engine-ready'], 30); assert.equal(state.stages['scene-started'], 80);
    clock += 20; state.mark('playable'); const count = logs.length;
    clock += 200; state.mark('playable');
    assert.equal(state.stages.playable, 100); assert.equal(logs.length, count, 'One log per stage, no repeated logging');
    assert.equal(host.__findDifferenceFeed.latest.type, 'feedEnter', 'Performance hooks preserve early Feed events');
    assert.equal(host.__findDifferenceSidebar.latest.scene, '023041');
}

// Keep module trimming safe as future prefab/script edits are added.
const removed = new Map([['video', ['VideoPlayer']], ['webview', ['WebView']],
    ['websocket', ['WebSocket']], ['particle-2d', ['ParticleSystem2D', 'ParticleAsset']]]);
const config = JSON.parse(read('settings/v2/packages/engine.json')).modules.configs.defaultConfig;
for (const name of removed.keys()) {
    assert.equal(config.cache[name]._value, false, name);
    assert.ok(!config.includeModules.includes(name), name);
}
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);
for (const file of walk('assets')) {
    if (/\.(prefab|scene|anim)$/.test(file)) {
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            for (const names of removed.values()) assert.ok(!names.some(name => value.__type__ === `cc.${name}`), file);
            Object.values(value).forEach(visit);
        };
        visit(JSON.parse(read(file)));
    } else if (file.endsWith('.ts')) {
        const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        const check = node => {
            if (ts.isImportSpecifier(node)) for (const names of removed.values())
                assert.ok(!names.includes((node.propertyName || node.name).text), file);
            if (ts.isIdentifier(node) && node.text === 'WebSocket') assert.fail('WebSocket usage in ' + file);
            ts.forEachChild(node, check);
        };
        check(tree);
    }
}
(async () => {
    for (const highPerformance of [undefined, false, true]) for (const dpr of [1, 2, 3])
        await launch({ highPerformance, width: 390 * dpr, height: 844 * dpr, dpr });
    const flow = read('assets/scripts/GameFlow.ts');
    const begin = flow.slice(flow.indexOf('const begin = () => {'), flow.indexOf('if (this.feed?.isPreview) {', flow.indexOf('const begin = () => {')));
    assert.ok(begin.indexOf("mark('playable')") > begin.indexOf('consumeEnergy()'), 'Playable records actual entry, not Feed preview');
    console.log('PASS: high-performance config/strict templates, normal and iOS runtime startup, DPR 1/2/3, one-shot timings, cache/Feed preservation and trimmed-module dependency audit.');
})().catch(error => { console.error(error); process.exitCode = 1; });
