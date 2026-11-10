'use strict';
// One-time extraction. UUIDs, authored coordinates and serialized bindings are retained.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
const target = 'assets/PleyGame/prefabs/GameplaySupport.prefab';
assert.ok(!fs.existsSync(target), 'Migration already applied; do not overwrite editable support prefab');
const original = fs.readFileSync('assets/scene/game.scene'), scene = JSON.parse(original);
const canvas = scene.findIndex(item => item.__type__ === 'cc.Node' && item._name === 'Canvas');
const screens = scene.findIndex(item => item.__type__ === 'cc.Node' && item._name === 'Screens');
const roots = scene[canvas]._children.map(ref => ref.__id__).filter(id => !['Camera', 'GameFlow', 'Screens'].includes(scene[id]._name));
roots.push(...scene[screens]._children.map(ref => ref.__id__).filter(id => scene[id]._name !== 'Loading'));
const selected = new Set();
function collect(id) {
    if (selected.has(id)) return;
    selected.add(id);
    function visit(value, key) {
        if (!value || typeof value !== 'object' || key === '_parent') return;
        if (Number.isInteger(value.__id__)) {
            assert.ok(value.__id__ !== canvas && value.__id__ !== screens, 'External Canvas reference requires explicit rebinding');
            collect(value.__id__); return;
        }
        for (const [k, v] of Object.entries(value)) visit(v, k);
    }
    visit(scene[id]);
}
roots.forEach(collect);
function remap(value, mapping, strict = false) {
    if (Array.isArray(value)) return value.filter(v => !(v && Number.isInteger(v.__id__) && !mapping.has(v.__id__))).map(v => remap(v, mapping, strict));
    if (!value || typeof value !== 'object') return value;
    if (Number.isInteger(value.__id__)) {
        if (!mapping.has(value.__id__)) { assert.ok(!strict, 'External serialized reference ' + value.__id__); return null; }
        return { __id__: mapping.get(value.__id__) };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, mapping, strict)]));
}
const uuid = crypto.randomUUID(), order = [...selected].sort((a, b) => a - b), mapping = new Map(order.map((id, i) => [id, i + 2]));
const container = structuredClone(scene[screens]);
Object.assign(container, { _name: 'GameplaySupport', _parent: null, _children: roots.map(id => ({ __id__: mapping.get(id) })),
    _components: [], _prefab: null, _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 }, _id: '' });
const prefab = [{ __type__: 'cc.Prefab', _name: 'GameplaySupport', _objFlags: 0, __editorExtras__: {}, _native: '', data: { __id__: 1 }, optimizationPolicy: 0, persistent: false }, container];
for (const id of order) {
    const value = structuredClone(scene[id]);
    if (roots.includes(id)) value._parent = null;
    const mapped = remap(value, mapping, true);
    if (roots.includes(id)) mapped._parent = { __id__: 1 };
    prefab.push(mapped);
}
for (const value of [...prefab]) if (value.__type__ === 'cc.Node') {
    value._prefab = { __id__: prefab.length };
    prefab.push({ __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __uuid__: uuid, __expectedType__: 'cc.Prefab' },
        fileId: crypto.randomUUID().replaceAll('-', '').slice(0, 22), instance: null, targetOverrides: null });
}
for (const node of scene.filter(value => value.__type__ === 'cc.Node')) node._children = node._children.filter(ref => !selected.has(ref.__id__));
const live = new Set();
function mark(id) {
    if (live.has(id) || selected.has(id)) return;
    live.add(id);
    function visit(value) { if (!value || typeof value !== 'object') return; if (Number.isInteger(value.__id__)) mark(value.__id__); else Object.values(value).forEach(visit); }
    visit(scene[id]);
}
mark(0);
const kept = [...live].sort((a, b) => a - b), sceneMapping = new Map(kept.map((id, i) => [id, i]));
const startup = kept.map(id => remap(scene[id], sceneMapping));
const inventory = new Map();
for (const file of walk('assets').filter(file => file.endsWith('.meta'))) {
    const meta = read(file);
    for (const id of [meta.uuid, ...Object.values(meta.subMetas || {}).map(sub => sub.uuid)]) inventory.set(id, file.slice(0, -5).replaceAll('\\', '/'));
}
const local = new Set();
function refs(value) {
    if (!value || typeof value !== 'object') return;
    if (value.__uuid__) {
        const file = inventory.get(value.__uuid__);
        if (file && !local.has(file)) { local.add(file); if (/\.(anim|prefab|json|mtl)$/.test(file)) refs(read(file)); }
    }
    Object.values(value).forEach(refs);
}
refs(startup);
const moves = walk('assets/resources').map(file => file.replaceAll('\\', '/')).filter(file => !file.endsWith('.meta')
    && !file.startsWith('assets/resources/configs/') && !file.endsWith('.gitkeep') && !local.has(file))
    .map(from => ({ from, to: from.replace('assets/resources/', 'assets/PleyGame/Common/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex') }));
for (const move of moves) assert.ok(!fs.existsSync(move.to), 'Existing target ' + move.to);
write('config/loading-only/game.scene.before.json', JSON.parse(original));
write(target, prefab);
write(target + '.meta', { ver: '1.1.50', importer: 'prefab', imported: true, uuid, files: ['.json'], subMetas: {}, userData: { syncNodeName: 'GameplaySupport' } });
write('assets/scene/game.scene', startup);
for (const move of moves) {
    fs.mkdirSync(path.dirname(move.to), { recursive: true });
    fs.renameSync(move.from, move.to);
    if (fs.existsSync(move.from + '.meta')) fs.renameSync(move.from + '.meta', move.to + '.meta');
}
for (const file of walk('assets/PleyGame/Common')) {
    let dir = path.dirname(file).replaceAll('\\', '/');
    while (dir.startsWith('assets/PleyGame/Common')) {
        if (!fs.existsSync(dir + '.meta')) write(dir + '.meta', { ver: '1.2.0', importer: 'directory', imported: true, uuid: crypto.randomUUID(), files: [], subMetas: {}, userData: {} });
        dir = path.dirname(dir).replaceAll('\\', '/');
    }
}
const game = read('assets/PleyGame.meta'); game.userData.bundleConfigID = '66NbM5tAFFNImQdJTJ7bY+'; game.userData.priority = 7; write('assets/PleyGame.meta', game);
write('config/loading-only/migration.json', { date: '2026-11-10', localVisualAssets: [...local].sort(),
    moved: moves, supportPrefab: target, rootNodes: roots.map(id => scene[id]._name), configPolicy: 'Small startup index/configuration remains local; all non-loading visual/audio assets load remotely' });
console.log(JSON.stringify({ localAssets: [...local], moved: moves.length, supportNodes: roots.map(id => scene[id]._name) }));
