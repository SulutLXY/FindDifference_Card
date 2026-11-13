const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise(setImmediate);
let now = 100000, native = null, shown = 0, creates = 0, loads = 0, destroys = 0;
const logs = [], timers = new Set();
const host = { tt: { getSystemInfoSync: () => ({ platform: 'android' }), createInterstitialAd() {
    assert.equal(native, null, 'Never create a duplicate unshown native ad'); creates++;
    const ad = { shown: false, onLoad(fn) { this.loaded = fn; }, onClose(fn) { this.closed = fn; }, onError(fn) { this.failed = fn; },
        offLoad() {}, offClose() {}, offError() {},
        load() { loads++; }, // Callback-only retry; fresh instances already auto-load.
        show() { shown++; this.shown = true; return Promise.resolve(); },
        destroy() { assert.equal(this.shown, true); destroys++; native = null; },
    };
    native = ad; return ad;
} } };
const exports_ = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8')), {
    exports: exports_, globalThis: host, Date: { now: () => now },
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return timer; }, clearTimeout(timer) { timers.delete(timer); },
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    require: name => name === 'cc/env' ? { BYTEDANCE: true } : name.includes('Sidebar') ? { SidebarService: class {} } : { PlayerInfoService: class {} },
});
const flowText = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const ast = ts.createSourceFile('GameFlow.ts', flowText, ts.ScriptTarget.Latest, true);
const names = ['showSettings', '_showNativeRank', 'finishLevel', '_openingNativeRank'];
const body = ast.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow {${body}}; Flow;`), { console });
(async () => {
    const p = new exports_.PlatformService(); p.configure({ douyinInterstitialAdUnitId: 'ad' });
    p.canShowInterstitial = () => false; p._lastInterstitialAttempt = now;
    p.preloadInterstitial(); p.preloadInterstitial();
    assert.equal(creates, 1); assert.equal(loads, 0); assert.equal(shown, 0); assert.equal(p.interstitialBusy, false);
    await p.onRoundFinished(() => true);
    assert.equal(shown, 0); assert.equal(timers.size, 0, 'Cold immediate entries never wait or schedule a later popup');
    now += 8000; native.loaded(); await tick();
    assert.equal(shown, 0, 'Finishing the old load 8 seconds later must not pop up');

    const f = new Flow(); let rankOpened = 0, wave;
    Object.assign(f, { isValid: true, platform: p, _isPaused: false, _isGameOver: false,
        _settings: { node: { activeInHierarchy: false }, present() { this.node.activeInHierarchy = true; } },
        lobby: { node: { activeInHierarchy: true } }, _cancelSecondaryNavigation() {}, toast() {},
        rankProvider: { openNative: async () => { rankOpened++; return { success: true }; }, submitScore() {} },
    });
    p.detectHarmony = async () => false;
    Object.defineProperty(p, 'supportsRanking', { value: true });
    async function closeAndWarm() {
        const old = native; old.closed(); await tick();
        assert.notEqual(native, old, 'Closing a shown immediate ad prepares the next instance');
        native.loaded(); await tick();
    }
    f.showSettings(false); await tick();
    assert.equal(shown, 1, 'Home settings show immediately despite first-round protection/local cooldown');
    await closeAndWarm();
    f.showSettings(true); await tick();
    assert.equal(shown, 2, 'In-game settings also bypass local cooldown/protection');
    await closeAndWarm();
    const rank = f._showNativeRank(); await tick();
    assert.equal(shown, 3); assert.equal(rankOpened, 0, 'Do not overlap the native rank panel and ad');
    await closeAndWarm(); await rank; assert.equal(rankOpened, 1);

    const level = { key: 'round', timeLimit: 150, differences: [{ id: 'a' }, { id: 'b' }] };
    Object.assign(f, { _currentLevel: level, _foundIds: new Set(['a', 'b']), _remainingTime: 100, _elapsedTime: 50,
        _reviveUsed: false, _foods: [], _isPaused: false, save: { isCompleted: () => false, completeLevel() { return true; } },
        game: { node: { activeInHierarchy: true }, playVictoryWave(callback) { wave = callback; } },
        resultModal: { node: { activeInHierarchy: false }, present() { this.node.activeInHierarchy = true; } },
        _playResultTone() {}, findNextLevel: () => null,
    });
    f.finishLevel(true); await tick();
    assert.equal(shown, 3, 'Victory presentation keeps its existing pre-dialog animation');
    wave(); await tick(); assert.equal(shown, 4, 'The success dialog immediately requests its ready ad');
    await closeAndWarm();
    f._isGameOver = false; f.resultModal.node.activeInHierarchy = false;
    f.finishLevel(false, 'lives'); await tick(); assert.equal(shown, 5, 'Failure dialog immediately shows ready ad');
    await closeAndWarm();

    let active = true;
    const stale = p.showInterstitial(() => active, true, true, 'settings', true);
    active = false; await stale;
    assert.equal(shown, 5); assert.equal(native.shown, false, 'Navigation cancellation preserves the unshown instance');
    p._rewardedBusy = true; await p.onRoundFinished(() => true); assert.equal(shown, 5);
    p._rewardedBusy = false;
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'round-success' && ctx.readyOnly && ctx.bypassRoundProtection && ctx.bypassCooldown));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'round-failure' && ctx.readyOnly));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'rank' && ctx.readyOnly));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'settings' && ctx.readyOnly));
    assert.equal(timers.size, 0); assert.equal(destroys, 5);
    const last = p.onRoundFinished(() => true); await tick();
    native.closed(); await last;
    const beforeRetry = shown;
    now += 16000; p.preloadInterstitial();
    assert.equal(loads, 1, 'A stalled background auto-load can be retried on the next entry');
    native.loaded(); await tick();
    assert.equal(shown, beforeRetry, 'A recovered background load still cannot display on its own');
    assert.match(flowText, /this\.platform\.configure\([^;]+;\s*this\.platform\.preloadInterstitial/);
    console.log('PASS immediate interstitials: preload without duplicate load, no delayed popup, home/in-game settings, native rank, win/loss dialogs, bypass local cooldown/first-round protection, next-ad warmup, stale-page cancellation and reward exclusion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
