const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['_maybeShowAssistTutorial', '_presentAssistTutorial', 'ASSIST_STUCK_SECONDS', 'ASSIST_LOW_TIME_SECONDS',
    'unlimitedAssists', 'canWatchHintAd', 'canWatchAddTimeAd', 'requestHint', 'requestAddTime', 'requestReward', 'addTime']);
const methods = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.has(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
class GameTips {}
const Flow = vm.runInNewContext(compile(`class GameFlow { ${methods} }; GameFlow;`), { GameTips, console });
function setup(kind, stock = 0) {
    let close, error, ads = 0, hints = 0, zooms = 0, overlay;
    const host = { tt: { createRewardedVideoAd() {
        ads++;
        return { onClose(fn) { close = fn; }, onError(fn) { error = fn; }, offClose() {}, offError() {}, show: () => Promise.resolve() };
    } } };
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8')), {
        exports, globalThis: host, console: { info() {}, warn() {} }, setTimeout, clearTimeout,
        require: name => name === 'cc/env' ? { BYTEDANCE: true, WECHAT: false, HTML5: false }
            : name.includes('Sidebar') ? { SidebarService: class {} } : { PlayerInfoService: class {} },
    });
    const platform = new exports.PlatformService(); platform.configure({ douyinRewardedAdUnitId: 'test-reward' });
    const flow = new Flow();
    flow.platform = platform; flow.isValid = true; flow._isGameOver = flow._isPaused = false;
    flow._assistRoundVersion = 1; flow._hintAdsUsed = flow._addTimeAdsUsed = 0;
    flow.hintAdsPerLevel = flow.addTimeAdsPerLevel = 2;
    flow._currentLevel = { differences: [{ id: 'a' }] }; flow._foundIds = new Set();
    flow._elapsedTime = 21; flow._lastFoundElapsed = 0; flow._remainingTime = kind === 'add-time' ? 20 : 120;
    flow.save = { data: { tutorialCompleted: true, tutorialHintShown: kind === 'zoom' }, freeHints: stock, freeAddTimes: stock,
        markAssistTutorialShown(value) { this.data[{ hint: 'tutorialHintShown', zoom: 'tutorialZoomShown', 'add-time': 'tutorialAddTimeShown' }[value]] = true; },
        consumeFreeHint() { if (!this.freeHints) return false; this.freeHints--; return true; },
        consumeAddTime() { if (!this.freeAddTimes) return false; this.freeAddTimes--; return true; },
        grantAssist(value) { this[value === 'hint' ? 'freeHints' : 'freeAddTimes']++; return true; },
    };
    const tutorial = { node: { activeInHierarchy: false }, present(node, local, radius, callback, text) {
        this.node.activeInHierarchy = true; overlay = { callback, text };
    } };
    flow.node = { parent: { getChildByPath: () => ({ getComponent: () => tutorial }) } };
    flow.game = { node: { activeInHierarchy: true }, tutorialControl: () => ({ node: {}, local: {}, radius: 50 }),
        tutorialZoom() { zooms++; }, refreshHud() {} };
    flow.useHint = () => hints++; flow.playHintSound = flow.playAddTimeSound = () => {};
    const messages = []; flow.toast = message => messages.push(message);
    flow._maybeShowAssistTutorial();
    return { flow, messages, overlay: () => overlay, ads: () => ads, hints: () => hints, zooms: () => zooms,
        tap(hit = true) { tutorial.node.activeInHierarchy = false; overlay.callback(hit); },
        close(completed) { close({ isEnded: completed }); }, error() { error({ errMsg: 'offline' }); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    for (const kind of ['hint', 'add-time']) {
        for (const outcome of ['complete', 'cancel', 'error']) {
            const ctx = setup(kind);
            assert.ok(ctx.overlay().text.includes('看广告'));
            assert.equal(ctx.ads(), 0, 'Idle warning alone must never open an ad');
            const before = ctx.flow._remainingTime;
            ctx.tap(); await tick();
            assert.equal(ctx.ads(), 1, 'Clicking the tutorial must invoke the real Douyin rewarded adapter');
            assert.equal(ctx.hints(), 0); assert.equal(ctx.flow._remainingTime, before, 'Do not grant before ad completion');
            if (outcome === 'error') ctx.error(); else ctx.close(outcome === 'complete');
            await tick();
            assert.equal(ctx.hints(), kind === 'hint' && outcome === 'complete' ? 1 : 0);
            assert.equal(ctx.flow._remainingTime, before + (kind === 'add-time' && outcome === 'complete' ? 30 : 0));
            assert.equal(ctx.flow._isPaused, false);
        }
        const stock = setup(kind, 1); const before = stock.flow._remainingTime;
        stock.tap(); await tick();
        assert.equal(stock.ads(), 0);
        assert.equal(stock.flow.save[kind === 'hint' ? 'freeHints' : 'freeAddTimes'], 0);
        assert.equal(stock.hints(), kind === 'hint' ? 1 : 0);
        assert.equal(stock.flow._remainingTime, before + (kind === 'add-time' ? 30 : 0));
        const limit = setup(kind); limit.flow._hintAdsUsed = limit.flow._addTimeAdsUsed = 2;
        limit.tap(); await tick(); assert.equal(limit.ads(), 0); assert.equal(limit.messages.length, 1);
        const stale = setup(kind); stale.flow._assistRoundVersion++; stale.tap(); await tick(); assert.equal(stale.ads(), 0);
        const miss = setup(kind); miss.tap(false); await tick(); assert.equal(miss.ads(), 0); assert.equal(miss.flow._isPaused, false);
    }
    const zoom = setup('zoom'); zoom.tap(); assert.equal(zoom.zooms(), 1); assert.equal(zoom.ads(), 0);
    console.log('PASS: idle/low-time tutorial clicks use Douyin rewarded ads with empty inventory; completion/cancel/error, stock consumption, round limits, stale callbacks and zoom behavior.');
})().catch(error => { console.error(error); process.exitCode = 1; });
