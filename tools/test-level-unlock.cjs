const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
function methods(file, names) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members
        .filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test { ${body} }; Test;`), { console: { warn() {} } });
}
const storage = new Map(); let failWrite = false;
const exportsSave = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exportsSave, console: { warn() {} }, require: () => ({ sys: { localStorage: {
        getItem: k => storage.get(k), setItem(k, v) { if (failWrite) throw Error('disk full'); storage.set(k, v); },
    } } }),
});
const { SaveService } = exportsSave;
const Flow = methods('assets/scripts/GameFlow.ts', ['isCityUnlocked', 'isLevelUnlocked', 'requestLevelUnlock',
    'watchLevelUnlockVideo', 'requestReward', 'findContinueTarget', '_nextLevelTarget']);
const Screen = methods('assets/scripts/ui/LevelSelectScreen.ts', ['_enterLevel']);
const city = { key: 'city-PetStory', levels: Array.from({ length: 20 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`) };
const key = i => `${city.key}/${city.levels[i]}`;
function createFlow(save = new SaveService()) {
    const flow = new Flow();
    flow.save = save; flow._cities = [city]; flow._currentCity = city; flow.currentCity = city;
    flow._isPaused = true; flow._isGameOver = false; flow._rewardPending = false;
    flow.toast = () => {}; flow._ensureLevel = async (c, i) => ({ key: `${c.key}/${c.levels[i]}` });
    // 此处专测确认后的单关授权与导航；真实弹窗的确认/关闭流程见 test-event-tips.cjs。
    flow._eventTips = { isValid: true, present: (c, i) => flow.watchLevelUnlockVideo(c, i) };
    return flow;
}
(async () => {
    const flow = createFlow(); let ads = 0, finishAd;
    flow.platform = { showRewardedAd: placement => {
        assert.equal(placement, 'unlock-level'); ads++;
        return new Promise(resolve => { finishAd = (completed = true) => resolve({ success: true, completed }); });
    } };
    for (let i = 0; i < city.levels.length; i++) assert.equal(flow.isLevelUnlocked(0, i), i === 0);
    assert.equal(await flow.requestLevelUnlock(city, 0), true); assert.equal(ads, 0, 'First level is free');
    const score = flow.save.totalScore, stock = flow.save.freeHints;
    const unlock = flow.requestLevelUnlock(city, 9);
    assert.equal(ads, 1, 'Selection unlock works while gameplay is paused');
    assert.equal(await flow.requestLevelUnlock(city, 10), false, 'Only one video can be pending');
    finishAd(); assert.equal(await unlock, true);
    assert.equal(flow._isPaused, true, 'Selection video restores the prior pause state');
    assert.equal(flow.save.totalScore, score); assert.equal(flow.save.freeHints, stock);
    assert.equal(flow.save.isCompleted(key(9)), false, 'Video cannot fabricate completion');
    assert.equal(flow.isLevelUnlocked(0, 9), true);
    assert.equal(flow.isLevelUnlocked(0, 8), false); assert.equal(flow.isLevelUnlocked(0, 10), false);
    assert.equal(await flow.requestLevelUnlock(city, 9), true); assert.equal(ads, 1, 'No second video for an unlocked level');
    const restored = createFlow(new SaveService()); assert.equal(restored.isLevelUnlocked(0, 9), true);
    assert.equal(restored.save.isCompleted(key(9)), false);
    assert.equal(restored.save.setLastPlayedLevel(city.key, key(9)), true);
    assert.equal((await createFlow(new SaveService()).findContinueTarget()).levelIndex, 9, 'Restart resumes unfinished jumped level');
    restored.save.completeLevel(key(9), 2, 15);
    assert.equal(restored.isLevelUnlocked(0, 10), true, 'Winning the jumped level grants free next level');
    assert.equal(restored.isLevelUnlocked(0, 8), false, 'Intermediate skipped levels stay locked');
    assert.equal((await createFlow(new SaveService()).findContinueTarget()).levelIndex, 10, 'Continue moves forward instead of returning to earlier holes');
    assert.equal(restored.isLevelUnlocked(0, 9), true, 'Completed levels can be replayed without their predecessor');
    restored.platform = { showRewardedAd() { throw Error('Normal progression must not request a video'); } };
    assert.equal(await restored.requestLevelUnlock(city, 10), true);

    const cancelled = flow.requestLevelUnlock(city, 12); finishAd(false);
    assert.equal(await cancelled, false); assert.equal(flow.save.isLevelUnlocked(key(12)), false);
    flow.platform.showRewardedAd = async () => { throw Error('offline'); };
    assert.equal(await flow.requestLevelUnlock(city, 12), false); assert.equal(flow._rewardPending, false);
    assert.equal(flow._isPaused, true);
    flow.platform.showRewardedAd = async () => ({ success: false, completed: true });
    assert.equal(await flow.requestLevelUnlock(city, 12), false, 'Both success and completion are required');
    flow.platform.showRewardedAd = async () => ({ success: true, completed: true });
    const raw = storage.get('find-difference.save.v3'); failWrite = true;
    assert.equal(await flow.requestLevelUnlock(city, 12), false);
    assert.equal(flow.isLevelUnlocked(0, 12), false); assert.equal(storage.get('find-difference.save.v3'), raw);
    assert.equal(flow.save.setLastPlayedLevel(city.key, key(12)), false, 'Failed cursor write also rolls back');
    failWrite = false;
    assert.equal(await flow.requestLevelUnlock(city, 12), true, 'Retry works after a write failure');
    for (const index of [-1, 20, NaN, 1.5]) assert.equal(await flow.requestLevelUnlock(city, index), false);
    assert.equal(await flow.requestLevelUnlock({ ...city }, 1), false, 'Reject unregistered chapters');

    // Navigation during an ad saves the unlock, but cannot force entry into an old selection.
    let enter = [], rebuilds = 0;
    flow.startLevel = async (_, i) => enter.push(i);
    flow.platform.showRewardedAd = () => new Promise(resolve => { finishAd = () => resolve({ success: true, completed: true }); });
    const screen = new Screen(); screen.flow = flow; screen.isValid = true;
    screen.node = { activeInHierarchy: true }; screen._selectionVersion = 1; screen._unlockPending = false;
    screen.rebuild = () => { screen._selectionVersion++; rebuilds++; };
    const late = screen._enterLevel(15);
    await screen._enterLevel(16); assert.equal(flow.save.isLevelUnlocked(key(16)), false);
    screen._selectionVersion++; screen.node.activeInHierarchy = false;
    finishAd(); await late;
    assert.equal(flow.save.isLevelUnlocked(key(15)), true); assert.equal(enter.length, 0); assert.equal(rebuilds, 0);
    screen.node.activeInHierarchy = true;
    await screen._enterLevel(15); assert.deepEqual(enter, [15]); assert.equal(rebuilds, 1);
    enter = [];
    const selected = screen._enterLevel(17); finishAd(); await selected;
    assert.deepEqual(enter, [17]); assert.equal(rebuilds, 2);
    const oldCompleted = createFlow(new SaveService());
    oldCompleted.save.completeLevel(key(18), 1, 30);
    assert.equal(oldCompleted.isLevelUnlocked(0, 18), true, 'An old completion record does not require a new video');
    flow.save.reset(); assert.equal(flow.save.isLevelUnlocked(key(9)), false);
    assert.equal(flow.save.data.lastPlayedLevelKey, undefined);
    console.log('PASS: permanent single-level video unlock, free progression, restart continuation, replay, ad cancel/error, write rollback, concurrent taps and late navigation callbacks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
