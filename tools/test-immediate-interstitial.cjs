const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise(setImmediate);
let now = 100000, native = null, shown = 0, attempts = 0, creates = 0, loads = 0, destroys = 0;
const logs = [], timers = new Set();
const host = { tt: { getSystemInfoSync: () => ({ platform: 'android' }), createInterstitialAd() {
    assert.equal(native, null, 'Never create a duplicate unshown native ad'); creates++;
    const ad = { shown: false, ready: false, onLoad(fn) { this.loaded = () => { this.ready = true; fn(); }; }, onClose(fn) { this.closed = fn; }, onError(fn) { this.failed = fn; },
        offLoad() {}, offClose() {}, offError() {},
        load() { loads++; }, // Callback-only retry; fresh instances already auto-load.
        show() { attempts++; if(this.rejectNext){const error=this.rejectNext;this.rejectNext=null;return Promise.reject(error);} if (!this.ready) return Promise.reject({errNo:21000,errMsg:'Ad has not completed loading'}); shown++; this.shown = true; return Promise.resolve(); },
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
const names = ['showSettings', '_showNativeRank', 'finishLevel', '_openingNativeRank', 'openDailySignIn', '_openSecondaryPage', 'showCollect'];
const body = ast.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow {${body}}; Flow;`), { console, sidebarDay:()=> '2026-11-19' });
(async () => {
    const p = new exports_.PlatformService(); p.configure({ douyinInterstitialAdUnitId: 'ad' });
    p.canShowInterstitial = () => false; p._lastInterstitialAttempt = now;
    p.preloadInterstitial(); p.preloadInterstitial();
    assert.equal(creates, 1); assert.equal(loads, 0); assert.equal(shown, 0); assert.equal(p.interstitialBusy, false);
    await p.onRoundFinished(() => true);
    assert.equal(shown, 0); assert.equal(attempts, 1, 'Even a missing ready flag must attempt SDK.show immediately');
    assert.equal(timers.size, 0, 'Cold immediate entries never wait or schedule a later popup');
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

    const stale = p.showInterstitial(() => false, true, true, 'settings', true);
    await stale;
    assert.equal(shown, 5); assert.equal(native.shown, false, 'Navigation cancellation preserves the unshown instance');
    p._rewardedBusy = true; await p.onRoundFinished(() => true); assert.equal(shown, 5);
    p._rewardedBusy = false;
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'round-success' && ctx.immediate && ctx.bypassRoundProtection && ctx.bypassCooldown));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'round-failure' && ctx.immediate));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'rank' && ctx.immediate));
    assert.ok(logs.some(([_, ctx]) => ctx?.placement === 'settings' && ctx.immediate));
    assert.equal(timers.size, 0); assert.equal(destroys, 5);
    const last = p.onRoundFinished(() => true); await tick();
    native.closed(); await last;
    const beforeRetry = shown;
    now += 16000; p.preloadInterstitial();
    assert.equal(loads, 1, 'A stalled background auto-load can be retried on the next entry');
    native.loaded(); await tick();
    assert.equal(shown, beforeRetry, 'A recovered background load still cannot display on its own');

    // A native ad may be usable before onLoad reaches JavaScript. Client flags must not drop the request.
    p._interstitialState.ready = false;
    const withoutCallback = p.showInterstitial(() => true, true, true, 'settings', true);
    await tick(); assert.equal(shown, beforeRetry + 1);
    await closeAndWarm(); await withoutCallback;
    let closeSignIn;
    const modal={node:{activeInHierarchy:false},present(){this.node.activeInHierarchy=true;return new Promise(resolve=>closeSignIn=()=>{this.node.activeInHierarchy=false;resolve();});}};
    f._dailyConfig={};f._dailyOpening=false;f._ensureDailySignIn=async()=>modal;
    f.save.dailyStatus=()=>({canClaim:true});f.save.data={};f.save.markDailyPrompt=()=>true;
    const beforeSign=shown;
    const manual=f.openDailySignIn();await tick();assert.equal(shown,beforeSign+1,'Clicking sign-in requests an immediate interstitial');
    await closeAndWarm();closeSignIn();await manual;
    const automatic=f.openDailySignIn(true);await tick();assert.equal(shown,beforeSign+1,'Automatic daily prompt must not request a click-placement ad');
    closeSignIn();await automatic;
    const page={isValid:true,node:{activeInHierarchy:false}};
    f._secondaryNavigationVersion=0;f._ensureSecondaryPage=async()=>page;f._setLoadingProgress=()=>{};
    f._switchTo=()=>{page.node.activeInHierarchy=true;f._secondaryNavigationVersion++;};
    const collect=f.showCollect();await tick();assert.equal(shown,beforeSign+2,'Collection bypasses first-round protection');
    await closeAndWarm();await collect;
    for(const placement of ['sign-in','collect']) assert.ok(logs.some(([_,ctx])=>ctx?.placement===placement&&ctx.immediate&&ctx.bypassRoundProtection&&ctx.bypassCooldown));
    assert.equal(timers.size,0);
    const usable=native,beforeRejected=shown;
    native.rejectNext={errNo:2002,errMsg:'Just shown an Ad, cannot show now'};
    await p.showInterstitial(()=>true,true,true,'settings',true);
    assert.equal(native,usable);assert.equal(p.interstitialPending,false);assert.equal(p.interstitialBusy,false);
    native.rejectNext={errNo:2005,errMsg:'There is no Ad to show!'};
    const beforeLoad=loads;
    await p.showInterstitial(()=>true,true,true,'collect',true);
    assert.equal(native,usable,'No-fill must retain the unshown native handle');assert.equal(loads,beforeLoad+1);
    native.loaded();await tick();assert.equal(shown,beforeRejected,'No-fill background retry must never pop later');
    const retry=p.showInterstitial(()=>true,true,true,'collect',true);await tick();assert.equal(shown,beforeRejected+1);
    await closeAndWarm();await retry;
    assert.match(flowText, /this\.platform\.configure\([^;]+;\s*this\.platform\.preloadInterstitial/);
    console.log('PASS immediate interstitials: direct SDK show despite missing ready callback, cold SDK failure without delayed popup, home/in-game settings, native rank, manual-only sign-in, collection, win/loss dialogs, protection bypass, warmup, stale pages and reward exclusion.');
})().catch(error => { console.error(error); process.exitCode = 1; });
