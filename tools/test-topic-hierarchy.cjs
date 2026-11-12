const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const store = new Map(); let failWrite = false;
const output = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: output, console: { warn() {} }, require: () => ({ sys: { localStorage: {
        getItem: key => store.get(key), setItem(key, value) { if (failWrite) throw Error('disk'); store.set(key, value); },
    } } }),
});
function methods(file, names, globals = {}) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test {${body}};Test;`), { console: { warn() {} }, ...globals });
}
const Flow = methods('assets/scripts/GameFlow.ts', ['_loadCityMeta', 'chapterSelections', 'chapterSelectionTitle',
    'selectionProgress', 'cityProgress', 'enterChapterSelection', 'backFromCitySelection', 'returnToChapterSelection',
    'showCitySelect', 'showLevelSelect', 'requestCityUnlock', 'enterCity', 'isCityUnlocked', 'isLevelUnlocked', 'requestReward']);
(async () => {
    const f = new Flow(); f._cityIndex = read('assets/resources/configs/cities.json');
    f._cities = await Promise.all(f._cityIndex.cities.map(key => f._loadCityMeta(null, key)));
    f.cities = f._cities; f.save = new output.SaveService();
    assert.equal(f.save.migrateContentLayout(f._cities, read('assets/resources/configs/chapter-layout-legacy.json')), true);
    f._selectedTopic = null; f._secondaryNavigationVersion = 0; f.isValid = true; f._isPaused = true;
    let rebuilds = 0, home = 0; const entered = [];
    f.citySelect = { isValid: true, node: { activeInHierarchy: true }, rebuild() { rebuilds++; } };
    f._switchTo = () => { f._secondaryNavigationVersion++; }; f.returnToLobby = () => home++;
    f.showLevelSelect = async city => entered.push(city.key); f.toast = () => {};
    assert.equal(f.chapterSelections.length, 6);
    const porcelain = f._cities.find(city => city.key === 'qing-hua-ci');
    assert.equal(f.isCityUnlocked(f._cities.indexOf(porcelain)), true);
    assert.equal(f.isLevelUnlocked(f._cities.indexOf(porcelain), 0), true);
    assert.equal(f.isLevelUnlocked(f._cities.indexOf(porcelain), 1), false);
    const topic = f.chapterSelections.find(item => item.key === 'lian-ai-mei-shi');
    assert.deepEqual(JSON.parse(JSON.stringify(f.selectionProgress(topic))), { done: 0, total: 120 });
    await f.enterChapterSelection(topic); assert.equal(f.chapterSelectionTitle, '恋爱美食');
    const cities = f.chapterSelections; assert.equal(cities.length, 8);
    assert.equal(cities[0].key, 'bei-jing');
    for (const [i, city] of cities.entries()) {
        assert.equal(f.isCityUnlocked(f._cities.indexOf(city)), i === 0);
        assert.equal(f.isLevelUnlocked(f._cities.indexOf(city), 0), i === 0, 'Saved free first-level grants cannot bypass a locked city');
    }
    let loaded = 0; f._cancelSecondaryNavigation = () => f._secondaryNavigationVersion++;
    f.ensureCity = async () => loaded++;
    await Flow.prototype.showLevelSelect.call(f, cities[3]);
    assert.equal(loaded, 0, 'Direct level-page calls must not load a locked city');
    await f.enterCity(cities[0]); assert.deepEqual(entered, ['bei-jing']);
    let finish, reject, ads = 0;
    f.platform = { showRewardedAd(placement) {
        assert.equal(placement, 'unlock-city'); ads++;
        return new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    } };
    const shanghai = cities[1], ci = f._cities.indexOf(shanghai);
    let pending = f.enterCity(shanghai); await f.enterCity(shanghai); assert.equal(ads, 1);
    finish({ success: true, completed: false }); await pending;
    assert.equal(f.isCityUnlocked(ci), false); assert.equal(entered.length, 1); assert.equal(f._isPaused, true);
    pending = f.enterCity(shanghai); reject(Error('offline')); await pending;
    assert.equal(f.isCityUnlocked(ci), false);
    pending = f.enterCity(shanghai); failWrite = true; finish({ success: true, completed: true }); await pending;
    assert.equal(f.isCityUnlocked(ci), false); failWrite = false;
    pending = f.enterCity(shanghai); finish({ success: true, completed: true }); await pending;
    assert.equal(f.isCityUnlocked(ci), true); assert.equal(entered.at(-1), shanghai.key);
    f.save = new output.SaveService(); assert.equal(f.isCityUnlocked(ci), true);
    assert.equal(f.isLevelUnlocked(ci, 0), true); assert.equal(f.isLevelUnlocked(ci, 1), false);
    const beforeAds = ads; await f.enterCity(shanghai); assert.equal(ads, beforeAds, 'Permanent city entry does not replay ads');
    const nanjing = cities[2]; pending = f.enterCity(nanjing);
    f.backFromCitySelection(); assert.equal(f.chapterSelectionTitle, '关卡选择');
    const beforeEntry = entered.length; finish({ success: true, completed: true }); await pending;
    assert.equal(f.save.isCityUnlocked(nanjing.key), true); assert.equal(entered.length, beforeEntry, 'Late reward persists without navigation');
    f._currentCity = shanghai; f.returnToChapterSelection(); assert.equal(f.chapterSelectionTitle, '恋爱美食');
    f.backFromCitySelection(); f.backFromCitySelection(); assert.equal(home, 1);
    const xian = cities[7]; f.save.completeLevel(xian.levelIds[xian.levels[0]], 2, 20);
    assert.equal(f.isCityUnlocked(f._cities.indexOf(xian)), true, 'Existing progress retains city entry');
    const guangzhou = cities[5]; f.save.unlockCity(guangzhou.legacyKeys[0]);
    assert.equal(f.isCityUnlocked(f._cities.indexOf(guangzhou)), true, 'Legacy city reward retained');
    const chengdu = cities[6]; f.save.unlockLevel(chengdu.levelIds[chengdu.levels[4]]);
    assert.equal(f.isCityUnlocked(f._cities.indexOf(chengdu)), true, 'Old single-level reward is still accessible');
    assert.ok(rebuilds >= 4);
    // Run the production card renderer with both grouped and locked entries.
    class Label {} class Sprite {} class UITransform {}
    const Screen = methods('assets/scripts/ui/CitySelectScreen.ts', ['_fillCard'], { Label, Sprite, UITransform, Input: { EventType: { TOUCH_END: 'touch' } } });
    const screen = new Screen(), labels = {}, selected = [];
    screen.flow = f; f.enterChapterSelection = async item => selected.push(item.key);
    const nodes = {};
    for (const name of ['ProgressPoint', 'BtnUnlock', 'LockIcon', 'CityLockTip', 'Cityaim', 'CityBanner']) nodes[name] = {
        active: false, off() {}, on(_, cb) { this.click = cb; }, getComponent: () => ({}), getComponentInChildren: () => ({}),
    };
    screen._setHeatBadge = () => {};
    screen.findChildDeep = (_, name) => nodes[name]; screen._setCardLabel = (_, name, text) => labels[name] = text; screen._loadBanner = () => {};
    const card = { off() {}, on(_, callback) { this.click = callback; } };
    screen._fillCard(card, topic); assert.equal(labels.Levelnumber, '8个城市 · 120关'); assert.equal(nodes.BtnUnlock.active, false);
    const topicArrow = {}; nodes.Cityaim.click(topicArrow);
    assert.equal(topicArrow.propagationStopped, true); assert.equal(selected.at(-1), topic.key);
    screen._fillCard(card, cities[3]); assert.equal(nodes.BtnUnlock.active, true); assert.equal(nodes.ProgressPoint.active, false);
    const cityArrow = {}; nodes.Cityaim.click(cityArrow);
    assert.equal(cityArrow.propagationStopped, true); assert.equal(selected.at(-1), cities[3].key);
    const event = {}; nodes.BtnUnlock.click(event); assert.equal(event.propagationStopped, true); assert.equal(selected.at(-1), cities[3].key);
    console.log('PASS: six root topics/eight cities, porcelain first level free, Beijing free, seven city gates, permanent complete-only rewards, duplicate/error/cancel/write failure, stale navigation, back stack and legacy progress.');
})().catch(error => { console.error(error); process.exitCode = 1; });
