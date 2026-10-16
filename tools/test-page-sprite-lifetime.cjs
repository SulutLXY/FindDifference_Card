const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const file = 'assets/scripts/GameFlow.ts';
const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['_pageSpriteFrames', '_pageSpritesDisposed', 'loadPageSpriteFrame', 'releasePageSpriteFrames', '_levelImageTarget', 'acquireLevelFrame'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const requests = [];
const bundle = { load(path, type, callback) { requests.push({ path, callback }); } };
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, { SpriteFrame: class {}, Sprite: class {}, resources: bundle });
function frame() {
    return { refs: 0, isValid: true, addRef() { assert.ok(this.isValid); this.refs++; },
        decRef() { assert.ok(this.refs > 0); if (--this.refs === 0) this.isValid = false; } };
}
function page() {
    const sprite = { spriteFrame: null };
    return { isValid: true, activeInHierarchy: true, sprite, getComponentsInChildren: () => [sprite] };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function finish(loaded, error = null) { assert.ok(requests.length); requests.shift().callback(error, loaded); }
const path = 'levels/city-00-HotTips/level-07/scene-a/spriteFrame';
(async () => {
    const flow = new Flow(); flow._loadCityBundle = async () => bundle;
    const a = page(), b = page();
    const first = flow.loadPageSpriteFrame(path, a);
    assert.equal(flow.loadPageSpriteFrame(path, a), first, 'Same-page concurrent loads are merged');
    const second = flow.loadPageSpriteFrame(path, b);
    await flush(); assert.equal(requests.length, 2);
    const shared = frame(); finish(shared); finish(shared);
    a.sprite.spriteFrame = await first; b.sprite.spriteFrame = await second;
    assert.equal(shared.refs, 2);
    const playing = flow.acquireLevelFrame(path); await flush(); finish(shared); await playing;
    assert.equal(shared.refs, 3);
    flow.releasePageSpriteFrames(a);
    assert.equal(a.sprite.spriteFrame, null); assert.equal(shared.refs, 2);
    assert.equal(b.sprite.spriteFrame, shared); assert.ok(shared.isValid);
    shared.decRef(); assert.equal(shared.refs, 1, 'Leaving gameplay preserves the other page');
    flow.releasePageSpriteFrames(b); assert.equal(shared.refs, 0); assert.equal(shared.isValid, false);
    flow.releasePageSpriteFrames(b); // idempotent close / disable / destroy
    assert.equal(flow._pageSpriteFrames.size, 0);

    // Close and immediately reopen the same owner before its old download finishes.
    const old = flow.loadPageSpriteFrame(path, a); await flush();
    flow.releasePageSpriteFrames(a);
    const fresh = flow.loadPageSpriteFrame(path, a); await flush();
    const staleFrame = frame(); finish(staleFrame);
    assert.equal(await old, null); assert.equal(staleFrame.refs, 0);
    const freshFrame = frame(); finish(freshFrame); assert.equal(await fresh, freshFrame);
    assert.equal(freshFrame.refs, 1); flow.releasePageSpriteFrames(a); assert.equal(freshFrame.refs, 0);

    // Failure allows retry, including the existing SpriteFrame suffix fallback.
    const retryPath = 'thumbnails/city-00-HotTips/level-01/icon';
    const failed = flow.loadPageSpriteFrame(retryPath, a);
    const rejection = assert.rejects(failed, /missing/);
    await flush(); finish(null, Error('missing')); finish(null, Error('missing')); await rejection;
    const retry = flow.loadPageSpriteFrame(retryPath, a); await flush();
    finish(null, Error('suffix required'));
    assert.ok(requests[0].path.endsWith('/spriteFrame'));
    const fallback = frame(); finish(fallback); assert.equal(await retry, fallback);
    flow.releasePageSpriteFrames(a); assert.equal(fallback.refs, 0);

    // A destroyed flow must not retain a late asset or start further requests.
    const pending = flow.loadPageSpriteFrame(path, a); await flush();
    flow._pageSpritesDisposed = true; flow.releasePageSpriteFrames(a);
    const late = frame(); finish(late); assert.equal(await pending, null); assert.equal(late.refs, 0);
    assert.equal(await flow.loadPageSpriteFrame(path, a), null); assert.equal(requests.length, 0);
    console.log('PASS page images: per-page deduplication, shared gameplay references, close/reopen, late results, retry/fallback and disposal');
})().catch(error => { console.error(error); process.exitCode = 1; });
