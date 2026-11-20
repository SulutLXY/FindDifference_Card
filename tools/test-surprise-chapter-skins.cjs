const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
class Prefab {}
function asset(name, refs = 0) {
    return { name, refs, addRef() { this.refs++; }, decRef() { assert.ok(this.refs > 0, name); this.refs--; } };
}
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const member = tree.statements.find(ts.isClassDeclaration).members.find(item => item.name?.getText(tree) === 'acquireSurpriseAssistPrefab');
const Flow = vm.runInNewContext(compile(`class Test {${member.getText(tree)}}; Test;`), { Prefab, console: { warn() {} } });
const moduleExports = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/ui/SurpriseAssist.ts', 'utf8')), {
    exports: moduleExports, require: () => ({}), console: { warn() {} },
});
const { SurpriseAssist } = moduleExports;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const level = { key: 'stable-level', differences: [], maxLives: 3, timeLimit: 300 };
(async () => {
    const flow = new Flow(), themed = asset('chapter'), shared = asset('shared');
    let present = true, failLoad = false, failBundle = false, defaultLoads = 0, leases = 0;
    const requested = [];
    flow.loadGamePrefab = async name => { assert.equal(name, 'Item_Tips_surprise'); defaultLoads++; return shared; };
    flow._contentBundles = { async use(key, action) {
        requested.push(key); leases++;
        try {
            if (failBundle) throw Error('bundle offline');
            return await action({
                getInfoWithPath(path, Type) { assert.equal(path, 'prefabs/Item_Tips_surprise'); assert.equal(Type, Prefab); return present ? {} : null; },
                load(path, Type, callback) { assert.equal(path, 'prefabs/Item_Tips_surprise'); callback(failLoad ? Error('prefab offline') : null, themed); },
            });
        } finally { leases--; }
    } };
    const chapter = await flow.acquireSurpriseAssistPrefab('qing-hua-ci');
    assert.equal(chapter, themed); assert.equal(chapter.refs, 1); assert.equal(defaultLoads, 0); assert.equal(leases, 0);
    chapter.decRef();
    present = false;
    const fallback = await flow.acquireSurpriseAssistPrefab('wang-luo-re-dian');
    assert.equal(fallback, shared); assert.equal(fallback.refs, 1); fallback.decRef();
    present = true; failLoad = true;
    const broken = await flow.acquireSurpriseAssistPrefab('meng-chong-san-guo');
    assert.equal(broken, shared); assert.equal(broken.refs, 1); broken.decRef();
    failLoad = false; failBundle = true;
    const offline = await flow.acquireSurpriseAssistPrefab('chong-wu-gu-shi');
    assert.equal(offline, shared); offline.decRef(); assert.equal(leases, 0);
    const count = requested.length, generic = await flow.acquireSurpriseAssistPrefab('');
    assert.equal(generic, shared); assert.equal(requested.length, count); generic.decRef();

    const loaded = [], spriteLoads = [];
    const liveFlow = { currentCity: { key: 'qing-hua-ci' },
        async loadGameSpriteFrame(path) { spriteLoads.push(path); return { path }; },
        async acquireSurpriseAssistPrefab(key) { const prefab = asset(key, 1); loaded.push(prefab); return prefab; },
    };
    const service = new SurpriseAssist({}, liveFlow);
    service.start(level); await service._prepare();
    const porcelain = service._prefab;
    assert.equal(porcelain.name, 'qing-hua-ci'); assert.equal(porcelain.refs, 1);
    service.start({ ...level, key: 'another-level' }); await service._prepare();
    assert.equal(service._prefab, porcelain); assert.equal(loaded.length, 1, 'Reuse prefab across levels in the same chapter');
    liveFlow.currentCity = { key: 'meng-chong-san-guo' };
    service.start(level); await service._prepare();
    assert.equal(porcelain.refs, 0); assert.equal(service._prefab.name, 'meng-chong-san-guo');
    assert.equal(spriteLoads.length, 3, 'All three shared reward icons remain shared');
    const sanguo = service._prefab;
    service.clear(); service.start(level); await service._prepare();
    assert.equal(service._prefab, sanguo); assert.equal(loaded.length, 2);
    service.dispose(); assert.equal(sanguo.refs, 0);

    const pending = new Map();
    const asyncFlow = { currentCity: { key: 'old' },
        async loadGameSpriteFrame(path) { return { path }; },
        acquireSurpriseAssistPrefab(key) { return new Promise(resolve => pending.set(key, resolve)); },
    };
    const switching = new SurpriseAssist({}, asyncFlow);
    switching.start(level); const oldLoading = switching._loading; await flush();
    asyncFlow.currentCity = { key: 'new' }; switching.start(level);
    const newLoading = switching._loading; await flush();
    const old = asset('old', 1); pending.get('old')(old); await oldLoading;
    assert.equal(old.refs, 0, 'Release late old chapter assets');
    assert.equal(switching._prefab, null);
    assert.equal(switching._loading, newLoading, 'Old finally must not clear a newer request');
    const current = asset('new', 1); pending.get('new')(current); await newLoading;
    assert.equal(switching._prefab, current); assert.equal(current.refs, 1);
    asyncFlow.currentCity = { key: 'destroyed' }; switching.start(level); const closing = switching._loading;
    await flush(); switching.dispose(); const late = asset('destroyed', 1); pending.get('destroyed')(late); await closing;
    assert.equal(current.refs, 0); assert.equal(late.refs, 0); assert.equal(switching._prefab, null);
    console.log('PASS: chapter prefab selection, missing/broken/offline fallback, same-chapter reuse, shared icons, stale chapter requests and reference cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
