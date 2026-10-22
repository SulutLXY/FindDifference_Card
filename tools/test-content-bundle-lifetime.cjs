const assert = require('node:assert/strict');
const createFlow = require('./content-test-helper.cjs');
const loads = [], images = [], removed = [], live = new Map();
const resources = {load(path, Type, callback) { images.push({path, callback}); }};
const Flow = createFlow({resources, SpriteFrame: class {}, Sprite: class {}, assetManager: {
    loadBundle(name, callback) { loads.push({name, callback}); },
    removeBundle(bundle) { removed.push(bundle.name); live.delete(bundle.name); },
}});
const flush = async () => { for (let i=0;i<24;i++) await Promise.resolve(); };
const owner = () => ({isValid:true, activeInHierarchy:true, sprites:[{spriteFrame:null}], getComponentsInChildren(){return this.sprites;}});
const frame = () => ({refs:0,isValid:true,addRef(){this.refs++;},decRef(){assert.ok(this.refs>0);this.refs--;}});
function finishBundle() {const {name,callback}=loads.shift();const bundle={name,...resources};live.set(name,bundle);callback(null,bundle);}
function finishImage(asset=frame(), error=null) {assert.ok(images.length);images.shift().callback(error,asset);return asset;}
(async () => {
    const flow = new Flow(), a=owner(), b=owner();
    const path='food-icons/city-02-beijing/food/spriteFrame';
    const p=flow.loadPageSpriteFrame(path,a);
    assert.equal(p,flow.loadPageSpriteFrame(path,a),'Same owner deduplicates');
    const q=flow.loadPageSpriteFrame(path,b);
    assert.equal(loads.length,1,'Concurrent owners share bundle request');
    finishBundle();await flush();
    const shared=frame();finishImage(shared);finishImage(shared);
    a.sprites[0].spriteFrame=await p;b.sprites[0].spriteFrame=await q;
    assert.equal(shared.refs,2);
    flow.releasePageSpriteFrames(a);await flush();
    assert.equal(shared.refs,1);assert.equal(a.sprites[0].spriteFrame,null);assert.equal(removed.length,0);
    flow.releasePageSpriteFrames(b);await flush();
    assert.equal(shared.refs,0);assert.deepEqual(removed,['food-icons']);
    flow.releasePageSpriteFrames(b);await flush();assert.equal(removed.length,1);

    // Close while the bundle is still downloading: finish then discard without loading a picture.
    const late=flow.loadPageSpriteFrame(path,a);flow.releasePageSpriteFrames(a);
    await flush();assert.equal(removed.length,1);
    finishBundle();assert.equal(await late,null);await flush();
    assert.equal(images.length,0);assert.equal(removed.length,2);

    // Close and reopen while an image is pending; the stale request must not release the fresh owner's bundle.
    const old=flow.loadPageSpriteFrame(path,a);finishBundle();await flush();flow.releasePageSpriteFrames(a);
    const fresh=flow.loadPageSpriteFrame(path,a);await flush();
    const stale=finishImage();assert.equal(await old,null);assert.equal(stale.refs,0);
    const current=finishImage();assert.equal(await fresh,current);await flush();assert.equal(removed.length,2);
    flow.releasePageSpriteFrames(a);await flush();assert.equal(removed.length,3);

    // Level selection and gameplay can share one texture, and the bundle survives until both leave.
    const gamePath='levels/city-PetStory/level-01/scene-a/spriteFrame';
    const preview=flow.loadPageSpriteFrame(gamePath,a);finishBundle();await flush();
    const texture=finishImage();await preview;
    const playing=flow.acquireLevelFrame(gamePath);await flush();finishImage(texture);await playing;
    flow.releasePageSpriteFrames(a);await flush();assert.equal(texture.refs,1);assert.equal(removed.length,3);
    flow.releaseLevelFrame(texture);await flush();assert.equal(texture.refs,0);assert.equal(removed.at(-1),'city-PetStory');

    // Failed load releases both its page and operation leases, then can retry.
    const fail=flow.loadPageSpriteFrame(path,a);const rejection=assert.rejects(fail,/offline/);
    loads.shift().callback(Error('offline'));await rejection;await flush();
    const retry=flow.loadPageSpriteFrame(path,a);finishBundle();await flush();finishImage(null,Error('suffix'));
    assert.ok(images[0].path.endsWith('/spriteFrame/spriteFrame'));
    finishImage();await retry;flow.releasePageSpriteFrames(a);await flush();

    // Destruction waits for in-flight work, and rejects new bundle ownership.
    const pending=flow.loadPageSpriteFrame(path,a);finishBundle();await flush();
    flow._pageSpritesDisposed=true;flow.releasePageSpriteFrames(a);flow._contentBundles.dispose();
    const last=finishImage();assert.equal(await pending,null);await flush();assert.equal(last.refs,0);
    assert.equal(live.size,0);assert.equal(await flow.loadPageSpriteFrame(path,a),null);
    assert.equal(flow._levelFrameBundles.size,0);
    assert.throws(()=>flow._contentBundles.retain('food-icons'),/销毁/);
    console.log('PASS content lifetime: shared owners, gameplay/page overlap, pending close/reopen, retry, late results, disposal and bundle removal');
})().catch(error=>{console.error(error);process.exitCode=1;});
