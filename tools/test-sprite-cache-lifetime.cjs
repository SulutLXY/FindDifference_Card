const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_loadSpriteFrom', 'acquireLevelFrame', 'releaseLevelFrame', '_levelFrameBundles', 'loadSpriteFrame', '_levelImageTarget', '_chapterSpriteTarget'];
const methods = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${methods} }; Flow;`, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText, { SpriteFrame: class {} });
(async () => {
    for (const fallback of [false, true]) {
        const flow = new Flow();
        flow._spriteFrameCache = new Map();
        const frame = { refs: 0, isValid: true, texture: {}, addRef() { this.refs++; }, decRef() { if (--this.refs === 0) { this.texture = null; this.isValid = false; } } };
        const path = 'levels/city-00-HotTips/level-07/scene-a/spriteFrame';
        const bundle = { load(request, Type, done) { queueMicrotask(() => done(fallback && request === 'cover' ? Error('retry') : null, frame)); } };
        flow._loadCityBundle = async () => bundle;
        flow._contentBundles = {retain: () => () => {}, use: async (_, action) => action(bundle)};
        const playing = await flow.acquireLevelFrame(path);
        await Promise.all([flow._loadSpriteFrom(bundle, path, 'cover'), flow._loadSpriteFrom(bundle, path, 'cover')]);
        assert.equal(frame.refs, 2, 'Concurrent thumbnail loads retain exactly one cache reference plus the gameplay reference');
        flow.releaseLevelFrame(playing);
        assert.ok(frame.texture, 'Leaving level 7 must not destroy the thumbnail texture');
        assert.equal(await flow.loadSpriteFrame(path), frame);
        const replay = await flow.acquireLevelFrame(path);
        flow.releaseLevelFrame(replay);
        assert.equal(frame.refs, 1, 'Repeated entry/exit must preserve only the cache reference');
        frame.decRef();
        assert.equal(frame.texture, null);
    }
    console.log('PASS: shared level/thumbnail texture survives exit, concurrent loads, replay, and fallback loading.');
})().catch(error => { console.error(error); process.exitCode = 1; });
