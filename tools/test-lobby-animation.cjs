const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)]);
const root = 'assets/Bundle/MainGameAimation';
const remoteUuids = new Set();
const firstFrameMeta = read(`assets/resources/textures/UI_Sprite/V3/lobby-hero-still.png.meta`);
const allowedFirstFrame = Object.values(firstFrameMeta.subMetas).find(item => item.importer === 'sprite-frame').uuid;
for (const file of walk(root).filter(file => file.endsWith('.meta'))) {
    const meta = read(file);
    remoteUuids.add(meta.uuid);
    for (const sub of Object.values(meta.subMetas || {})) remoteUuids.add(sub.uuid);
}
for (const file of ['assets/scene/game.scene', ...walk('assets/resources').filter(file => /\.(prefab|anim)$/.test(file))]) {
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        assert.ok(!remoteUuids.has(value.__uuid__), `${file}: homepage decoration must use independent local stills, never remote animation assets`);
        Object.values(value).forEach(visit);
    };
    visit(read(file));
}
const meta = read(`${root}.meta`).userData;
assert.equal(meta.isBundle, true);
assert.equal(meta.bundleName, 'MainGameAimation');
assert.equal(read('settings/v2/packages/builder.json').bundleConfig.custom[meta.bundleConfigID].configs.miniGame.fallbackOptions.isRemote, true);
const scene = read('assets/scene/game.scene');
const heroNode = scene.find(item => item._name === 'bg_showIcon');
const components = heroNode._components.map(ref => scene[ref.__id__]);
assert.equal(components.find(item => item.__type__ === 'cc.Sprite')._spriteFrame.__uuid__, allowedFirstFrame);
const animationData = components.find(item => item.__type__ === 'cc.Animation');
assert.equal(animationData.playOnLoad, false);
assert.equal(animationData._defaultClip, null);
assert.deepEqual(animationData._clips, []);

class Animation {}
class AnimationClip {}
class Sprite {}
class SpriteFrame {}
class UIScreen {
    wireButton() {}
    resolveNode() { return null; }
    resolveLabel() { return null; }
    setLabel() {}
}
const compiled = ts.transpileModule(fs.readFileSync('assets/scripts/ui/LobbyScreen.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, experimentalDecorators: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ cached = false, failure = null, placeholder = null } = {}) {
    const exports = {};
    const queue = [];
    const warnings = [];
    const loads = [];
    let bundleCalls = 0;
    let cachedBundle = cached;
    let fail = failure;
    const asset = name => ({ name, refs: 0, addRef() { ++this.refs; }, decRef() { --this.refs; } });
    const clip = asset('An_MainGame_N_Cat_01');
    const frame = asset('first-frame');
    const bundle = {
        load(request, Type, done) {
            assert.equal(Type, request.endsWith('/spriteFrame') ? SpriteFrame : AnimationClip);
            assert.ok(fs.existsSync(`${root}/${request.replace(/\/spriteFrame$/, '')}${Type === SpriteFrame ? '.png' : '.anim'}`));
            loads.push(request);
            queue.push(() => done(fail === (Type === SpriteFrame ? 'frame' : 'clip') ? Error('asset offline') : null, Type === SpriteFrame ? frame : clip));
        },
    };
    const manager = {
        getBundle(name) { assert.equal(name, meta.bundleName); return cachedBundle ? bundle : null; },
        loadBundle(name, done) {
            assert.equal(name, meta.bundleName);
            ++bundleCalls;
            queue.push(() => {
                if (fail === 'bundle') done(Error('bundle offline'), null);
                else { cachedBundle = true; done(null, bundle); }
            });
        },
    };
    vm.runInNewContext(compiled, { exports, console: { warn: (...args) => warnings.push(args) }, require: name => {
        if (name === 'cc') return { _decorator: { ccclass: () => Type => Type, property: () => () => {} },
            Animation, AnimationClip, Sprite, SpriteFrame, assetManager: manager };
        if (name === './UIScreen') return { UIScreen };
        if (name === './EnergyDisplay') return { EnergyDisplay: { attach() {} } };
        return {};
    } });
    const screen = new exports.LobbyScreen();
    const animation = { isValid: true, playOnLoad: true, defaultClip: null, clips: [], plays: [], stops: 0,
        play(name) { this.plays.push(name); }, stop() { ++this.stops; } };
    const sprite = { isValid: true, enabled: true, spriteFrame: placeholder };
    screen.isValid = screen.enabledInHierarchy = true;
    screen.node = { getChildByName: () => ({ getComponent: Type => Type === Animation ? animation : sprite }) };
    screen.flow = { node: { parent: { getComponent: () => true } }, platform: { isHarmony: false, kind: 'test', detectHarmony: async () => false } };
    screen.onLoad();
    assert.equal(bundleCalls, 0, 'Scene initialization must not download the decoration before the homepage opens');
    assert.equal(animation.playOnLoad, false);
    assert.equal(sprite.enabled, !!placeholder);
    return { screen, animation, sprite, clip, frame, warnings, loads,
        bundleCalls: () => bundleCalls,
        setFailure(value) { fail = value; },
        close() { screen.enabledInHierarchy = false; screen.onDisable(); },
        open() { screen.enabledInHierarchy = true; screen.onOpen(); },
        destroy() { screen.onDestroy(); screen.isValid = false; },
        async flush() { while (queue.length) { queue.shift()(); await tick(); } await tick(); },
    };
}

(async () => {
    const placeholder = { name: 'editor-bound-first-frame' };
    const prefetched = setup({ placeholder });
    prefetched.close();
    const preload = prefetched.screen.preloadHero();
    assert.equal(prefetched.sprite.spriteFrame, placeholder);
    assert.equal(prefetched.sprite.enabled, true);
    await prefetched.flush(); await preload;
    assert.equal(prefetched.animation.plays.length, 0, 'Preloading must not play on a hidden homepage');
    prefetched.open(); await prefetched.flush();
    assert.equal(prefetched.loads.length, 2, 'Opening after preloading must reuse the assets');
    assert.equal(prefetched.animation.plays.length, 1);
    prefetched.destroy();
    const fallback = setup({ placeholder, failure: 'clip' });
    fallback.open();
    assert.equal(fallback.sprite.spriteFrame, placeholder, 'Keep first frame while downloading');
    await fallback.flush();
    assert.equal(fallback.sprite.enabled, true, 'Keep first frame on failure');
    assert.equal(fallback.sprite.spriteFrame, placeholder);
    fallback.setFailure(null);
    await Promise.all([fallback.screen.preloadHero(), fallback.flush()]);
    fallback.open(); await fallback.flush();
    assert.equal(fallback.animation.plays.length, 1);
    fallback.destroy();
    const ctx = setup();
    ctx.open(); ctx.open();
    assert.equal(ctx.bundleCalls(), 1, 'Concurrent opens share a single bundle download');
    await ctx.flush();
    assert.equal(ctx.loads.length, 2);
    assert.equal(ctx.animation.plays.length, 1, 'Only the latest open callback can start playback');
    assert.equal(ctx.sprite.spriteFrame, ctx.frame);
    assert.equal(ctx.sprite.enabled, true);
    assert.equal(ctx.clip.refs, 1); assert.equal(ctx.frame.refs, 1);
    ctx.close();
    assert.equal(ctx.animation.stops, 1);
    ctx.open(); await ctx.flush();
    assert.equal(ctx.loads.length, 2, 'Returning home reuses loaded assets');
    assert.equal(ctx.animation.plays.length, 2);
    ctx.destroy();
    assert.equal(ctx.clip.refs, 0); assert.equal(ctx.frame.refs, 0);
    assert.equal(ctx.sprite.spriteFrame, null);
    assert.equal(ctx.animation.defaultClip, null);

    for (const failure of ['bundle', 'clip', 'frame']) {
        const failed = setup({ failure });
        failed.open(); await failed.flush();
        assert.equal(failed.warnings.length, 1);
        assert.equal(failed.animation.plays.length, 0);
        assert.equal(failed.sprite.enabled, false);
        assert.equal(failed.clip.refs, 0); assert.equal(failed.frame.refs, 0);
        failed.setFailure(null);
        failed.open(); await failed.flush();
        assert.equal(failed.animation.plays.length, 1, `${failure} failure must allow retry`);
        failed.destroy();
    }

    const hidden = setup();
    hidden.open(); hidden.close(); await hidden.flush();
    assert.equal(hidden.animation.plays.length, 0, 'A late load cannot play after leaving home');
    hidden.open(); await hidden.flush();
    assert.equal(hidden.animation.plays.length, 1);
    hidden.destroy();

    for (const cached of [false, true]) {
        const destroyed = setup({ cached });
        destroyed.open(); destroyed.destroy(); await destroyed.flush();
        assert.equal(destroyed.animation.plays.length, 0);
        assert.equal(destroyed.clip.refs, 0); assert.equal(destroyed.frame.refs, 0);
        assert.equal(destroyed.sprite.spriteFrame, null);
    }
    console.log('PASS: static first-frame fallback, hidden preloading, remote animation without static clip references, concurrent opens, reuse, failure retry, late callbacks, and resource cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
