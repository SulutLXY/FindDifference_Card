'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_ensureSharedUI', 'loadCommonPrefab', '_sharedUIReady', '_sharedUIPending'];
const cls = tree.statements.find(ts.isClassDeclaration);
const body = cls.members.filter(member => names.includes(member.name?.getText(tree))).map(member => member.getText(tree)).join('\n');
class Node {
    constructor(name, active = false) { this.name = name; this.active = active; this.children = []; this.isValid = true; this.position = { x: 12, y: 34 }; }
    set parent(value) {
        if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1);
        this._parent = value; value?.children.push(this);
    }
    get parent() { return this._parent; }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    destroy() { this.isValid = false; this.children.forEach(node => node.destroy()); }
}
let instances = 0, mounted;
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText, { Prefab: class {}, console,
    instantiate() {
        instances++; const root = new Node('GameplaySupport');
        mounted = ['Settings', 'FoodTips', 'EventTips', 'GameTips', 'ADDSubscription'].map(name => {
            const child = new Node(name); child.parent = root; return child;
        });
        return root;
    },
});
const config = read('config/loading-only/migration.json');
const before = read('config/loading-only/game.scene.before.json'), prefab = read(config.supportPrefab);
const current = read('assets/scene/game.scene');
assert.deepEqual(current.filter(item => item.__type__ === 'cc.Node').map(item => item._name),
    ['Canvas', 'Camera', 'GameFlow', 'Screens', 'Loading', 'BG_Lobby', 'FooterEnv', 'loading_sliderBG', 'loading_slider', 'Londing_ICON', 'FooterEnv-001']);
assert.equal(read('assets/PleyGame.meta').userData.bundleConfigID, '66NbM5tAFFNImQdJTJ7bY+');
// Every extracted authored node retains geometry, active flag, text, and sprite binding.
function nodes(graph, root) {
    const map = new Map();
    function visit(id, prefix) {
        const node = graph[id], key = prefix ? prefix + '/' + node._name : node._name;
        map.set(key, node); (node._children || []).forEach(ref => visit(ref.__id__, key));
    }
    visit(root, ''); return map;
}
for (const name of config.rootNodes) {
    const oldRoot = before.findIndex(item => item.__type__ === 'cc.Node' && item._name === name
        && ['Canvas', 'Screens'].includes(before[item._parent?.__id__]?._name));
    const newRoot = prefab[1]._children.map(ref => ref.__id__).find(id => prefab[id]._name === name);
    const oldNodes = nodes(before, oldRoot), newNodes = nodes(prefab, newRoot);
    assert.deepEqual([...newNodes.keys()], [...oldNodes.keys()]);
    for (const [key, old] of oldNodes) {
        const node = newNodes.get(key);
        for (const field of ['_lpos', '_lscale', '_lrot', '_active', '_layer']) assert.deepEqual(node[field], old[field], key + ':' + field);
        const a = old._components.map(ref => before[ref.__id__]), b = node._components.map(ref => prefab[ref.__id__]);
        assert.deepEqual(b.map(item => item.__type__), a.map(item => item.__type__));
        for (let i = 0; i < a.length; i++) for (const field of ['_string', '_spriteFrame', '_contentSize', '_color', '_defaultClip'])
            assert.deepEqual(b[i][field], a[i][field], key + ':' + field);
    }
}
for (const move of config.moved) {
    assert.ok(!fs.existsSync(move.from), 'Non-loading asset left local: ' + move.from);
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(move.to)).digest('hex'), move.sha256);
}
const tick = () => new Promise(setImmediate);
(async () => {
    const f = new Flow(), canvas = new Node('Canvas'), screens = new Node('Screens'); screens.parent = canvas;
    f.isValid = true; f.node = { parent: canvas };
    let finishBundle, complete, loads = 0, initialized = 0;
    f._loadGameBundle = () => { loads++; return new Promise(resolve => { finishBundle = resolve; }); };
    f._initSharedUI = () => { initialized++; assert.ok(canvas.getChildByName('Settings')); assert.ok(screens.getChildByName('GameTips')); };
    f._loadComboClip = async () => ({});
    const first = f._ensureSharedUI(), duplicate = f._ensureSharedUI();
    assert.equal(first, duplicate); assert.equal(loads, 1); assert.equal(instances, 0, 'Do not instantiate before remote bundle download');
    const bundle = { load(request, type, done) { assert.equal(request, 'prefabs/GameplaySupport'); complete = done; } };
    finishBundle(bundle); await tick(); complete(Error('offline')); await assert.rejects(first); await assert.rejects(duplicate);
    assert.equal(f._sharedUIReady, false); assert.equal(initialized, 0);
    const retry = f._ensureSharedUI(); finishBundle(bundle); await tick(); complete(null, {}); await retry;
    assert.equal(instances, 1); assert.equal(initialized, 1); assert.equal(f._sharedUIReady, true);
    assert.ok(mounted.every(node => node.isValid && !node.active && node.position.x === 12));
    await f._ensureSharedUI(); assert.equal(loads, 2, 'Reuse mounted support');
    const stale = new Flow(); stale.isValid = true; stale._loadGameBundle = async () => bundle;
    const pending = stale._ensureSharedUI(); await tick(); stale.isValid = false; complete(null, {});
    await assert.rejects(pending, /已销毁/); assert.equal(instances, 1, 'Late download cannot instantiate after destroy');
    console.log('PASS: Loading-only source graph, remote asset moves with unchanged bytes, authored overlay layout/text/UUIDs, download barrier/retry/deduplication and stale cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
