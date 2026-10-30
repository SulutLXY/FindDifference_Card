const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText;
const platformSource = fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8');
function platform(env, host) {
    const exports = {};
    vm.runInNewContext(compile(platformSource), {
        exports, globalThis: host, console: { info() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
        require: name => name === 'cc/env' ? env : name.includes('Sidebar')
            ? { SidebarService: class {} } : { PlayerInfoService: class {} },
    });
    const p = new exports.PlatformService();
    p.configure({ douyinRewardedAdUnitId: 'douyin', wechatRewardedAdUnitId: 'wechat', douyinInterstitialAdUnitId: 'interstitial' });
    return p;
}
const flowSource = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', flowSource, ts.ScriptTarget.Latest, true);
const cls = tree.statements.find(ts.isClassDeclaration);
const names = ['requestReward', 'unlimitedAssists', 'requestHint', 'requestAddTime', 'addTime'];
const method = cls.members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow { ${method} }; Flow;`), { console });

(async () => {
    let sdkCalls = 0;
    const fakeSdk = { createRewardedVideoAd() { sdkCalls++; throw Error('H5 must never call native ad SDK'); },
        createInterstitialAd() { sdkCalls++; throw Error('H5 must never call native ad SDK'); }, login() {} };
    // A web build must remain H5 even inside a browser exposing both SDKs.
    const h5 = platform({ HTML5: true, BYTEDANCE: false, WECHAT: false }, { tt: fakeSdk, wx: fakeSdk });
    assert.equal(h5.kind, 'h5');
    const flow = new Flow(); flow.platform = h5; flow._isPaused = false; flow._isGameOver = false;
    flow._showSimulatedAd = () => { throw Error('Simulation must not run'); };
    flow.toast = () => { throw Error('H5 should not show an ad error'); };
    let rewards = 0;
    for (const placement of ['hint', 'add-time', 'revive', 'unlock-level', 'unlock-chapter']) {
        await flow.requestReward(placement, () => rewards++);
        assert.equal(flow._isPaused, false);
    }
    assert.equal(rewards, 5);
    flow._isGameOver = true;
    await flow.requestReward('revive', () => { rewards++; flow._isGameOver = false; flow._isPaused = false; });
    assert.equal(rewards, 6); assert.equal(flow._isPaused, false);
    await h5.showInterstitial(() => { throw Error('H5 must skip interstitial checks'); }, true);
    await h5.onRoundFinished(() => true);
    assert.equal(sdkCalls, 0);

    // H5 assists stay free and unlimited without touching stock.
    flow._currentLevel = { differences: [{ id: 'a' }] }; flow._foundIds = new Set();
    flow._remainingTime = 100; let hints = 0;
    flow.useHint = () => hints++;
    flow.playHintSound = flow.playAddTimeSound = () => {};
    flow.game = { node: { activeInHierarchy: true }, refreshHud() {} };
    flow.save = { freeHints: 0, freeAddTimes: 0, consumeFreeHint() { throw Error('Must not consume H5 stock'); },
        consumeAddTime() { throw Error('Must not consume H5 stock'); }, grantAssist() { throw Error('Must not grant H5 stock'); } };
    for (let i = 0; i < 20; i++) { await flow.requestHint(); await flow.requestAddTime(); }
    assert.equal(hints, 20); assert.equal(flow._remainingTime, 700);
    flow._isGameOver = true;
    await flow.requestHint(); await flow.requestAddTime();
    assert.equal(hints, 20); assert.equal(flow._remainingTime, 700, 'Game-over guard still applies');
    flow._isGameOver = false;

    // Native builds keep native reward completion/cancellation behavior.
    for (const kind of ['douyin', 'wechat']) {
        let close, created = 0;
        const sdk = { createRewardedVideoAd(options) {
            assert.equal(options.adUnitId, kind); created++;
            return { onClose: cb => { close = cb; }, onError() {}, offClose() {}, offError() {}, show: async () => {} };
        } };
        const p = platform({ HTML5: false, BYTEDANCE: kind === 'douyin', WECHAT: kind === 'wechat' }, { tt: sdk, wx: sdk });
        assert.equal(p.kind, kind);
        flow.platform = p; flow._isGameOver = false; flow._isPaused = false;
        assert.equal(flow.unlimitedAssists, false);
        flow.toast = () => {};
        flow.save = { freeHints: 0, freeAddTimes: 0, consumeFreeHint: () => false, consumeAddTime: () => false, grantAssist: () => true };
        const hintAd = flow.requestHint();
        assert.equal(created, 1, 'Per-level caps removed; native assists open ads');
        close({ isEnded: false }); await hintAd;
        const timeAd = flow.requestAddTime();
        assert.equal(created, 2, 'No per-level cap on add-time either');
        close({ isEnded: false }); await timeAd;
        assert.equal(hints, 20); assert.equal(flow._remainingTime, 700);
        let granted = false;
        const reward = flow.requestReward('hint', () => { granted = true; });
        assert.equal(granted, false); assert.equal(created, 3);
        close({ isEnded: true }); await reward; assert.equal(granted, true);
        granted = false; flow.toast = () => {};
        const cancelled = flow.requestReward('hint', () => { granted = true; });
        close({ isEnded: false }); await cancelled; assert.equal(granted, false);

        // Paused gameplay blocks assists; selection unlocks still allow reward ads.
        flow._isPaused = true;
        await flow.requestReward('hint', () => { throw Error('Paused gameplay must stay blocked'); });
        assert.equal(created, 4);

        granted = false;
        const unlock = flow.requestReward('unlock-level', () => { granted = true; });
        assert.equal(created, 5, 'Level selection must allow a native video while gameplay is paused');
        await flow.requestReward('unlock-level', () => { throw Error('Duplicate unlock'); });
        assert.equal(created, 5);
        close({ isEnded: true }); await unlock;
        assert.equal(granted, true); assert.equal(flow._isPaused, true);
        granted = false;
        const cancelledUnlock = flow.requestReward('unlock-level', () => { granted = true; });
        close({ isEnded: false }); await cancelledUnlock;
        assert.equal(granted, false); assert.equal(flow._isPaused, true);

        granted = false;
        const chapter = flow.requestReward('unlock-chapter', () => { granted = true; });
        assert.equal(created, 7);
        close({ isEnded: true }); await chapter;
        assert.equal(granted, true); assert.equal(flow._isPaused, true);

        flow._isGameOver = true;
        const revive = flow.requestReward('revive', () => {});
        await flow.requestReward('revive', () => { throw Error('Duplicate revive'); });
        assert.equal(created, 8, 'Game-over state must not bypass the pending ad guard');
        close({ isEnded: true }); await revive;
    }
    assert.ok(!flowSource.includes('_showSimulatedAd'), 'Remove obsolete simulation UI');
    console.log('PASS: H5 ad bypass and unlimited assists without stock changes; native uncapped assists and complete/cancel behavior retained.');
})().catch(error => { console.error(error); process.exitCode = 1; });
