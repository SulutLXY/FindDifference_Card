const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const assets = new Map();
for (const file of walk('assets').filter(f => f.endsWith('.meta'))) {
    const meta = read(file);
    for (const uuid of [meta.uuid, ...Object.values(meta.subMetas || {}).map(m => m.uuid)]) {
        assert.ok(!assets.has(uuid), `Duplicate asset UUID: ${uuid}`);
        assets.set(uuid, file.slice(0, -5));
    }
}
function validate(file) {
    const data = read(file);
    function visit(value) {
        if (!value || typeof value !== 'object') return;
        if (Number.isInteger(value.__id__)) assert.ok(data[value.__id__], `${file}: dangling object reference`);
        if (value.__uuid__) assert.ok(assets.has(value.__uuid__), `${file}: missing asset ${value.__uuid__}`);
        for (const item of Object.values(value)) visit(item);
    }
    visit(data);
    return data;
}
const scene = validate('assets/scene/game.scene');
for (const file of walk('assets').filter(f => /\.(prefab|anim)$/.test(f))) validate(file);
assert.ok(!scene.some(o => ['Game', 'ResultModal'].includes(o._name)), 'Gameplay UI must leave the startup scene');
function assertLocal(value) {
    if (!value || typeof value !== 'object') return;
    if (value.__uuid__) {
        const asset = assets.get(value.__uuid__)?.replace(/\\/g, '/');
        assert.ok(!asset?.includes('PleyGame'), 'Startup must not reference gameplay assets');
        assert.ok(!asset?.startsWith('assets/Bundle/'), 'Startup templates must load remote city images dynamically');
    }
    for (const item of Object.values(value)) assertLocal(item);
}
assertLocal(scene);
for (const file of walk('assets/resources').filter(f => /\.(prefab|anim)$/.test(f))) assertLocal(read(file));
const settings = read('settings/v2/packages/builder.json').bundleConfig.custom;
const gameMeta = read('assets/PleyGame.meta').userData;
assert.equal(gameMeta.bundleName, 'MainGameSources');
assert.equal(settings.default.configs.miniGame.overwriteSettings['bytedance-mini-game'].isRemote, false);
assert.equal(settings[gameMeta.bundleConfigID].configs.miniGame.fallbackOptions.isRemote, true);
assert.equal(settings[gameMeta.bundleConfigID].configs.miniGame.overwriteSettings['bytedance-mini-game'].compressionType, 'merge_dep');
assert.equal(read('profiles/v2/packages/bytedance-mini-game.json').builder.common.mainBundleIsRemote, false);

const gameFiles = walk('assets/PleyGame').filter(f => !f.endsWith('.meta'));
const localFiles = walk('assets/resources').filter(f => !f.endsWith('.meta'));
function exists(files, root, request) {
    const normalized = request.replace(/\/spriteFrame$/, '');
    return files.some(f => path.relative(root, f).replace(/\\/g, '/').replace(/\.[^.]+$/, '') === normalized);
}
const loads = [];
class AudioClip {}
class Prefab {}
class GameScreen {}
class ResultModal {}
const bundle = {
    load(request, type, done) {
        assert.ok(exists(gameFiles, 'assets/PleyGame', request), `Missing gameplay path: ${request}`);
        loads.push(request);
        done(null, type === Prefab ? { request } : { name: request });
    },
    getDirWithPath(dir) { return gameFiles.filter(f => f.includes('voice') && /\.(mp3)$/i.test(f))
        .map(f => ({ path: path.relative('assets/PleyGame', f).replace(/\\/g, '/').replace(/\.[^.]+$/, '') }))
        .filter(info => info.path.startsWith(dir + '/')); },
};
let bundleCalls = 0, finishBundle;
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_bootstrap', '_loadGameBundle', '_ensureGameScreens', '_comboClipRef', '_loadComboClip', '_discoverComboGroups',
    '_loadTapClip', '_loadResultClip', '_currentGameMusic', 'DEFAULT_COMBO_GROUP', 'BUNDLE_COMBO_ROOT',
    'startContinue', 'findContinueTarget', 'isCityUnlocked', 'isLevelUnlocked'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const created = [];
const Flow = vm.runInNewContext(ts.transpileModule(`class GameFlow { ${body} }; GameFlow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, {
    AudioClip, Prefab, GameScreen, ResultModal, console,
    assetManager: { loadBundle(name, done) { assert.equal(name, 'MainGameSources'); bundleCalls++; finishBundle = done; } },
    resources: { load(request, type, done) {
        assert.ok(exists(localFiles, 'assets/resources', request), `Missing local path: ${request}`);
        done(null, { name: request });
    } },
    instantiate(prefab) {
        const node = { name: '', active: true, getComponent: Type => Type === (prefab.request.endsWith('GameScreen') ? GameScreen : ResultModal) ? { isValid: true, node } : null, destroy() {} };
        created.push(node); return node;
    },
});
function flow() {
    const f = new Flow();
    f.isValid = true; f._comboClips = new Map(); f._tapClips = new Map(); f._resultClips = new Map(); f._musicClips = new Map();
    f._activeComboGroup = 'Combo _F_type01'; f._setLoadingProgress = () => {};
    return f;
}
(async () => {
    const f = flow();
    f._loadJson = async request => ({ json: read('assets/resources/' + request + '.json') });
    f._loadCityBundle = async () => ({});
    f._loadBundleJson = async (_, request) => ({ json: read('assets/Bundle/' + request + '.json') });
    f._loadCityMeta = async (_, key) => read('assets/resources/configs/cities.json').chapters[key];
    let migrated = false, continueCalls = 0;
    f.platform = { configure() {} }; f.save = { migrateChapterRules() { return true; }, migrateLegacy(keys) {
        assert.equal(keys[0], 'city-02-beijing/level-01', 'Prepending HotTips must not shift legacy save identities');
        assert.equal(keys.length, 120);
        assert.ok(keys.every(key => !key.startsWith('city-00-HotTips/') && !key.startsWith('city-01-2026Hotmeme/') && !key.startsWith('city-2025Hotmeme/') && !key.startsWith('city-PetStory/')));
        migrated = true;
    } };
    f._loadingNode = { active: true };
    f.showLobby = () => { throw Error('Startup must enter the current level directly'); };
    f.startContinue = async () => {
        assert.equal(migrated, true, 'Migrate saves before selecting a level');
        assert.equal(f._loadingNode.active, true, 'Keep loading visible until gameplay is ready');
        continueCalls++;
    };
    await f._bootstrap(); await f._loadComboClip(0);
    assert.equal(f._bootFailed, false);
    assert.equal(continueCalls, 1, 'Bootstrap must start the saved current level');
    assert.equal(bundleCalls, 0, 'Base configuration loading and click sound must not preload gameplay');
    const screens = {}, canvas = { getChildByName: () => screens }; f.node = { parent: canvas };
    const first = f._ensureGameScreens(), repeated = f._ensureGameScreens();
    assert.equal(bundleCalls, 1, 'Concurrent screen loads must share a bundle request');
    finishBundle(Error('offline')); await assert.rejects(first); await assert.rejects(repeated);
    assert.equal(created.length, 0);
    const retry = f._ensureGameScreens(); assert.equal(bundleCalls, 2);
    finishBundle(null, bundle); await retry;
    assert.equal(created.length, 2); assert.equal(f.game.node.parent, screens); assert.equal(f.resultModal.node.parent, canvas);
    assert.equal(f.game.node.active, false); assert.equal(f.game.node.name, 'Game');
    await f._ensureGameScreens(); assert.equal(created.length, 2, 'Reuse the same UI on later rounds');
    for (const group of ['Combo _F_type01', 'Combo _F_type02']) {
        f._activeComboGroup = group;
        for (let stage = 1; stage <= 5; stage++) await f._loadComboClip(stage);
    }
    await f._loadComboClip(-1);
    for (const name of ['voice_Back', 'voice_AddTime', 'voice_MakeCkear', 'voice_Right', 'voice_TipsTik', 'voice_TimeOver']) await f._loadTapClip(name);
    await f._loadResultClip(true); await f._loadResultClip(false);
    assert.ok(exists(gameFiles, 'assets/PleyGame', f._currentGameMusic().path));
    assert.equal(bundleCalls, 2);

    const resume = flow(), completed = new Set(), started = [];
    resume._cities = ['a', 'b'].map(key => ({ key, levels: ['01', '02'], levelConfigs: [{ key: key + '/01' }, { key: key + '/02' }] }));
    resume.save = { isCompleted: key => completed.has(key), isCityUnlocked: () => false };
    resume._ensureLevel = async (city, index) => city.levelConfigs[index];
    resume.startLevel = async (city, index) => { started.push(city.key + '/' + city.levels[index]); };
    await resume.startContinue(); assert.equal(started.pop(), 'a/01', 'New players start at the first level');
    completed.add('a/01');
    await resume.startContinue(); assert.equal(started.pop(), 'a/02', 'Resume the next incomplete level');
    completed.add('a/02');
    await resume.startContinue(); assert.equal(started.pop(), 'b/01', 'Continue into the next unlocked city');
    completed.add('b/01'); completed.add('b/02');
    await resume.startContinue(); assert.equal(started.pop(), 'a/01', 'Retain the all-complete replay behavior');
    console.log('PASS: valid scene/prefab references, no gameplay startup dependencies, lazy UI loading, retry, reuse, and migrated audio paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
