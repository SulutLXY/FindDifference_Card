const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
let nativeAd = null, creates = 0, loads = 0, shows = 0, destroys = 0, rejectShow = false;
const logs = [];
const host = { tt: {
    getSystemInfoSync: () => ({ platform: 'android' }),
    createInterstitialAd() {
        // Native SDK can reject another instance if an unshown one could not be destroyed.
        if (nativeAd) throw { errNo: 1003, errMsg: 'A usable ad already exists' };
        creates++;
        const ad = {
            loaded: false, shown: false, failedLoad: false,
            onLoad(fn) { this.loadedCallback = fn; }, offLoad() {},
            onError(fn) { this.errorCallback = fn; }, offError() {},
            onClose(fn) { this.closeCallback = fn; }, offClose() {},
            finishLoad() { this.loaded = true; this.loadedCallback(); },
            load() {
                loads++;
                // Creating an instance already starts loading. Duplicating it is invalid.
                if (!this.failedLoad) throw { errNo: 1003, errMsg: "Needn't load again!" };
                this.failedLoad = false;
                // Exercise callback-only native bridges: this intentionally returns undefined.
            },
            show() {
                assert.equal(this.loaded, true, 'Show must wait for native onLoad');
                shows++;
                if (rejectShow) {
                    rejectShow = false;
                    return Promise.reject({ errNo: 2002, errMsg: "Just shown an Ad, can't show now!" });
                }
                this.shown = true;
                return Promise.resolve();
            },
            destroy() {
                assert.equal(this.shown, true, 'Native SDK does not allow destroying an unshown ad');
                destroys++; nativeAd = null;
            },
        };
        nativeAd = ad;
        return ad;
    },
} };
const exportsObject = {};
const source = fs.readFileSync(process.env.PLATFORM_SOURCE_PATH || 'assets/scripts/services/PlatformService.ts', 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS },
}).outputText, {
    exports: exportsObject, globalThis: host, setTimeout, clearTimeout,
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    require: name => name === 'cc/env' ? { BYTEDANCE: true } : name.includes('Sidebar')
        ? { SidebarService: class {} } : { PlayerInfoService: class {} },
});
(async () => {
    const p = new exportsObject.PlatformService();
    p.configure({ douyinInterstitialAdUnitId: 'native-ad', douyinRewardedAdUnitId: 'reward' });
    // First entry: auto-load only; a real frequency rejection must not strand the instance.
    rejectShow = true;
    const first = p.showInterstitial(() => true, true, true, 'return-home');
    assert.equal(creates, 1);
    assert.equal(loads, 0, 'New instances must not load twice');
    assert.equal(shows, 0);
    nativeAd.finishLoad(); await first;
    assert.equal(destroys, 0);
    assert.equal(p.interstitialBusy, false);
    assert.ok(logs.some(([message, context]) => message.includes('未展示') && context.errCode === 2002
        && context.errNo === 2002 && context.phase === 'show'));
    const retry = p.showInterstitial(() => true, true, true, 'level-select-entry');
    await tick();
    assert.equal(creates, 1, 'Reuse the still-usable native ad after frequency rejection');
    assert.equal(loads, 0);
    assert.equal(p.interstitialBusy, true);
    nativeAd.closeCallback(); await retry;
    assert.equal(destroys, 1); assert.equal(nativeAd, null);
    // An actual auto-load failure is retried on the same instance via load -> onLoad.
    const failed = p.showInterstitial(() => true, true, true, 'return-home');
    nativeAd.failedLoad = true;
    nativeAd.errorCallback({ errCode: 1004, errMsg: 'no ad data' }); await failed;
    assert.equal(destroys, 1);
    const reloaded = p.showInterstitial(() => true, true, true, 'return-home');
    assert.equal(creates, 2); assert.equal(loads, 1);
    const beforeLoad = shows;
    await tick(); assert.equal(shows, beforeLoad, 'Undefined load() result is not proof that data is ready');
    nativeAd.finishLoad(); await tick();
    assert.equal(shows, beforeLoad + 1);
    nativeAd.closeCallback(); await reloaded;
    // Page cancellation retains the native instance; late onLoad never displays by itself.
    let active = true;
    const stale = p.showInterstitial(() => active, true, true, 'level-select-entry');
    active = false; const beforeStale = shows;
    nativeAd.finishLoad(); await stale;
    assert.equal(shows, beforeStale); assert.equal(destroys, 2);
    const reused = p.showInterstitial(() => true, true, true, 'return-home');
    await tick(); assert.equal(creates, 3); assert.equal(shows, beforeStale + 1);
    nativeAd.closeCallback(); await reused;
    // A reward request can cancel a slow load; completing that old load cannot overlay the video.
    let finishReward;
    host.tt.createRewardedVideoAd = () => ({ onClose(fn) { finishReward = fn; }, onError() {}, offClose() {}, offError() {}, show: async () => {} });
    const waiting = p.showInterstitial(() => true, true, true, 'return-home');
    const reward = p.showRewardedAd('hint'); await waiting;
    const beforeReward = shows;
    nativeAd.finishLoad(); await tick();
    assert.equal(shows, beforeReward);
    await p.showInterstitial(() => true, true, true, 'return-home');
    assert.equal(shows, beforeReward);
    finishReward({ isEnded: true }); await reward;
    const afterReward = p.showInterstitial(() => true, true, true, 'return-home');
    await tick(); assert.equal(creates, 4); assert.equal(shows, beforeReward + 1);
    nativeAd.closeCallback(); await afterReward;
    assert.equal(destroys, 4);
    console.log('PASS: native auto-load, no duplicate load, unshown instance retention/reuse, errNo diagnostics, callback-only load, page cancellation and reward overlap.');
})().catch(error => { console.error(error); process.exitCode = 1; });
