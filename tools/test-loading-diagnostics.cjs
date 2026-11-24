const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS,
} }).outputText;
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_levelFrameBundles', 'acquireLevelFrame', 'releaseLevelFrame', '_levelImageTarget'];
const body = tree.statements.find(ts.isClassDeclaration).members
    .filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const tick = () => new Promise(setImmediate);
function fixture(enabled = true) {
    let now = 1000;
    const host = { __findDifferenceLoadingDebug: enabled }, logs = [], manifests = [], preloads = [], loads = [], removed = [];
    const frame = { refs: 0, addRef() { this.refs++; }, decRef() { this.refs--; } };
    const cc = { SpriteFrame: class {}, assetManager: {
        assets: { get: () => undefined },
        preloadAny(request, options, callback) { preloads.push({ request, callback }); },
        loadBundle(name, callback) { manifests.push({ name, callback }); },
        removeBundle(b) { removed.push(b.name); },
    } };
    const context = { ...cc, globalThis: host, Date: { now: () => now },
        console: { info: (...args) => logs.push(args) } };
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/ContentBundlePool.ts', 'utf8')),
        { ...context, exports, require: () => cc });
    const pool = new exports.ContentBundlePool();
    const Flow = vm.runInNewContext(compile(`class Flow { ${body} } Flow;`), context);
    const f = new Flow();f._contentBundles = pool;f._loadCityBundle = (_, name) => pool.load(name);
    const bundle = { name: 'chapter', getInfoWithPath: () => ({ uuid: 'image' }),
        load(path, type, callback) { loads.push({ path, callback }); } };
    return { f, host, manifests, preloads, loads, frame, bundle, logs, removed, time: n => { now = n; } };
}
(async () => {
    const path = 'levels/chapter/one/scene-a/spriteFrame';
    let s = fixture();
    const loading = s.f.acquireLevelFrame(path);
    s.time(1100);s.manifests.shift().callback(null, s.bundle);await tick();
    assert.equal(s.loads.length, 0, 'Diagnostic mode separates file readiness from asset creation');
    s.time(1500);s.preloads.shift().callback(null);await tick();
    s.time(1700);s.loads.shift().callback(null, s.frame);await loading;
    const result = s.host.__findDifferenceImageLoads[0];
    assert.equal(result.bundleWaitMs, 100);assert.equal(result.filesReadyMs, 400);
    assert.equal(result.assetReadyMs, 200);assert.equal(result.durationMs, 700);
    assert.equal(result.memoryCached, false);assert.equal(result.diagnosticPreload, true);
    assert.equal(s.host.__findDifferenceBundleLoads[0].durationMs, 100);
    assert.equal(s.frame.refs, 1);s.f.releaseLevelFrame(s.frame);await tick();
    assert.equal(s.frame.refs, 0);assert.deepEqual(s.removed, ['chapter']);

    s = fixture();const failed = s.f.acquireLevelFrame(path), rejected = assert.rejects(failed, /offline/);
    s.manifests.shift().callback(null, s.bundle);await tick();
    s.time(1600);s.preloads.shift().callback(Error('offline'));await rejected;await tick();
    assert.equal(s.host.__findDifferenceImageLoads[0].phase, 'files');
    assert.equal(s.host.__findDifferenceImageLoads[0].status, 'failed');
    assert.equal(s.loads.length, 0);assert.deepEqual(s.removed, ['chapter']);
    const retry = s.f.acquireLevelFrame(path);s.manifests.shift().callback(null, s.bundle);await tick();
    s.preloads.shift().callback(null);await tick();s.loads.shift().callback(null, s.frame);await retry;
    s.f.releaseLevelFrame(s.frame);await tick();assert.equal(s.frame.refs, 0);

    s = fixture(false);const normal = s.f.acquireLevelFrame(path);
    s.manifests.shift().callback(null, s.bundle);await tick();
    assert.equal(s.preloads.length, 0, 'Normal gameplay does not add a preload pass');
    s.loads.shift().callback(null, s.frame);await normal;s.f.releaseLevelFrame(s.frame);await tick();
    assert.equal(s.host.__findDifferenceImageLoads, undefined);
    assert.equal(s.host.__findDifferenceBundleLoads, undefined);assert.equal(s.logs.length, 0);
    console.log('PASS loading diagnostics: manifest/file/asset phase timings, opt-in-only preload, normal path unchanged, failure cleanup and retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
