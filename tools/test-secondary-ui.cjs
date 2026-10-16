const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const uuids = new Map();
for (const file of walk('assets').filter(f => f.endsWith('.meta'))) {
    const visit = meta => {
        if (meta.uuid) {
            assert.ok(!uuids.has(meta.uuid), `Duplicate UUID ${meta.uuid}`);
            uuids.set(meta.uuid, file.slice(0, -5).replace(/\\/g, '/'));
        }
        for (const sub of Object.values(meta.subMetas || {})) visit(sub);
    };
    visit(read(file));
}
function references(value, visit) {
    if (!value || typeof value !== 'object') return;
    visit(value);
    for (const child of Object.values(value)) references(child, visit);
}
const scene = read('assets/scene/game.scene');
const screens = scene.find(o => o._name === 'Screens');
for (const ref of screens._children) assert.ok(!['Rank', 'Collect', 'RankScreen', 'CollectScreen'].includes(scene[ref.__id__]._name));
const flowBinding = scene.find(o => 'rank' in o && 'collect' in o);
assert.equal(flowBinding.rank, null); assert.equal(flowBinding.collect, null);
for (const name of ['Rank', 'Collect']) {
    const file = `assets/SecondaryUI/prefabs/${name}Screen.prefab`;
    const data = read(file), root = data[data[0].data.__id__];
    assert.equal(root._active, false); assert.equal(root._parent, null);
    assert.equal(data.filter(o => o.__type__ === 'cc.Node').length, name === 'Rank' ? 36 : 26);
    references(data, obj => {
        if (Number.isInteger(obj.__id__)) assert.ok(data[obj.__id__], `${file}: dangling reference`);
        if (obj.__uuid__) {
            assert.ok(uuids.has(obj.__uuid__), `${file}: unknown asset ${obj.__uuid__}`);
        }
    });
    const scriptUuid = read(`assets/scripts/ui/${name}Screen.ts.meta`).uuid;
    const hex = scriptUuid.replaceAll('-', '');
    // Resolve the root's authored component using its serialized class id prefix.
    assert.ok(root._components.some(ref => data[ref.__id__].__type__.startsWith(hex.slice(0, 5))), `${name}: missing page script`);
    if (name === 'Collect') assert.equal(data.find(o => 'itemTemplate' in o).modal, null);
}
assert.equal(walk('assets/SecondaryUI/textures').filter(f => !f.endsWith('.meta')).length, 8);
references(scene, obj => {
    if (Number.isInteger(obj.__id__)) assert.ok(scene[obj.__id__], 'Scene has dangling reference');
    if (obj.__uuid__) assert.ok(!uuids.get(obj.__uuid__)?.startsWith('assets/SecondaryUI/'), 'Startup directly references SecondaryUI');
});
const bundleMeta = read('assets/SecondaryUI.meta').userData;
assert.equal(bundleMeta.bundleName, 'SecondaryUI');
assert.equal(read('settings/v2/packages/builder.json').bundleConfig.custom[bundleMeta.bundleConfigID].configs.miniGame.fallbackOptions.isRemote, true);
console.log('PASS secondary assets: 62 page nodes removed, valid prefab bindings, 8 isolated textures, no startup references');

class RankScreen {}
class CollectScreen {}
class Prefab {}
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_secondaryPagesPending', '_secondaryPrefabs', '_secondaryNavigationVersion', '_secondaryPageLoading', '_secondaryDisposed',
    '_loadSecondaryBundle', '_ensureSecondaryPage', '_openSecondaryPage', '_cancelSecondaryNavigation', '_disposeSecondaryPages', 'showRank', 'showCollect'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
let bundleRequests = [], prefabRequests = [], instances = [];
const bundle = { load(request, type, done) { prefabRequests.push({ request, done }); } };
function makePrefab(request) { return { request, refs: 0, addRef() { this.refs++; }, decRef() { this.refs--; } }; }
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow;`, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText, {
    RankScreen, CollectScreen, Prefab, console: { warn() {} },
    assetManager: { loadBundle(name, done) { assert.equal(name, 'SecondaryUI'); bundleRequests.push(done); } },
    instantiate(prefab) {
        const node = { active: true, isValid: true, destroy() { this.isValid = false; }, getComponent(Type) { return Type === (prefab.request.includes('Rank') ? RankScreen : CollectScreen) ? page : null; } };
        const page = { isValid: true, node, close() { node.active = false; } };
        instances.push(node); return node;
    },
});
function setup() {
    bundleRequests = []; prefabRequests = []; instances = [];
    const flow = new Flow(); flow.isValid = true;
    flow.node = { parent: { getChildByName: () => ({}) } };
    flow._loadingNode = { active: false, parent: { children: [] }, setSiblingIndex() {} };
    flow._setLoadingProgress = () => {};
    flow.opened = []; flow.ads = 0; flow.errors = 0;
    flow.platform = { kind: 'web', showInterstitial() { flow.ads++; } };
    flow._switchTo = page => { flow._cancelSecondaryNavigation(); flow._loadingNode.active = false; flow.opened.push(page); };
    flow.toast = () => { flow.errors++; };
    return flow;
}
const tick = () => new Promise(setImmediate);
(async () => {
    const flow = setup();
    const a = flow._openSecondaryPage('collect'), b = flow._openSecondaryPage('collect');
    assert.equal(bundleRequests.length, 1); assert.equal(flow._loadingNode.active, true);
    bundleRequests.shift()(null, bundle); await tick(); assert.equal(prefabRequests.length, 1);
    let task = prefabRequests.shift(), prefab = makePrefab(task.request); task.done(null, prefab);
    await Promise.all([a, b]);
    assert.equal(instances.length, 1); assert.equal(flow.opened.length, 1); assert.equal(flow.ads, 1);
    assert.equal(prefab.refs, 1); assert.equal(flow._loadingNode.active, false);
    await flow._openSecondaryPage('collect'); assert.equal(instances.length, 1); assert.equal(flow.opened.length, 2);

    const cancelled = flow._openSecondaryPage('rank'); await tick();
    flow._cancelSecondaryNavigation(); task = prefabRequests.shift(); task.done(null, makePrefab(task.request));
    await cancelled; assert.equal(flow.opened.length, 2, 'Late load cannot steal navigation');
    assert.equal(flow._loadingNode.active, false);
    await flow._openSecondaryPage('rank'); assert.equal(instances.length, 2); assert.equal(flow.opened.length, 3);
    flow._disposeSecondaryPages(); assert.equal(prefab.refs, 0);
    assert.ok(instances.every(node => !node.isValid)); assert.equal(flow._secondaryPrefabs.size, 0);

    const retry = setup(); const fail = retry._openSecondaryPage('collect');
    bundleRequests.shift()(Error('offline')); await fail;
    assert.equal(retry.errors, 1); assert.equal(retry._loadingNode.active, false);
    const again = retry._openSecondaryPage('collect'); bundleRequests.shift()(null, bundle); await tick();
    task = prefabRequests.shift(); task.done(Error('missing prefab')); await again;
    assert.equal(retry.errors, 2);
    const succeeds = retry._openSecondaryPage('collect'); await tick();
    task = prefabRequests.shift(); task.done(null, makePrefab(task.request)); await succeeds;
    assert.equal(retry.opened.length, 1);

    const dead = setup(); const late = dead._openSecondaryPage('rank');
    bundleRequests.shift()(null, bundle); await tick();
    dead._disposeSecondaryPages();
    task = prefabRequests.shift(); const orphan = makePrefab(task.request); task.done(null, orphan); await late;
    assert.equal(orphan.refs, 0); assert.equal(dead.opened.length, 0); assert.equal(instances.length, 0);

    const native = setup(); native.platform.kind = 'douyin'; let nativeOpens = 0;
    native._showNativeRank = () => { nativeOpens++; }; native.showRank();
    assert.equal(nativeOpens, 1); assert.equal(bundleRequests.length, 0);
    console.log('PASS secondary loading: deduplication, node reuse, navigation cancellation, bundle/prefab retry, late destruction and native rank');
})().catch(error => { console.error(error); process.exitCode = 1; });
