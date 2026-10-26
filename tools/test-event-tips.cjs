const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
function methods(file, names) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
        .map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test { ${body} }; Test;`), { console: { warn() {} } });
}
const storage = new Map(); let failWrite = false;
const exportsSave = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exportsSave, console: { warn() {} }, require: () => ({ sys: { localStorage: {
        getItem: key => storage.get(key), setItem(key, value) { if (failWrite) throw Error('disk full'); storage.set(key, value); },
    } } }),
});
const { SaveService } = exportsSave;
const Flow = methods('assets/scripts/GameFlow.ts', ['isCityUnlocked', 'isLevelUnlocked', 'requestLevelUnlock',
    'watchLevelUnlockVideo', 'watchChapterUnlockVideo', 'requestReward', '_switchTo']);
const Selection = methods('assets/scripts/ui/LevelSelectScreen.ts', ['_enterLevel']);
class Label { static Overflow = { SHRINK: 1 }; }
class Button {}
class BlockInputEvents {}
class UITransform { hitTest(point) { return point.inside; } }
class Node { static EventType = { TOUCH_END: 'touch-end' }; }
class UIScreen {
    open() {
        this.node.active = true;
        if (!this.loaded) { this.loaded = true; this.onLoad(); }
    }
    close() { this.node.active = false; this.onDisable(); }
    onDisable() {}
    onDestroy() {}
    resolveNode(_, name) {
        const node = name.split('/').reduce((n, key) => n?.children.find(child => child.name === key), this.node);
        assert.ok(node, 'Missing authored EventTips node: ' + name);
        return node;
    }
    resolveLabel(_, name) {
        const label = this.resolveNode(null, name).getComponent(Label);
        assert.ok(label, 'Missing authored EventTips label: ' + name); return label;
    }
    setLabel(_, name, text) { this.resolveLabel(null, name).string = text; }
    wireButton(_, name, action) { this.resolveNode(null, name).action = action; }
}
const exportsModal = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/ui/EventTips.ts', 'utf8')), {
    exports: exportsModal, console,
    require: name => name === 'cc' ? { _decorator: { ccclass: () => c => c }, BlockInputEvents, Button, Label, Node, UITransform }
        : { UIScreen },
});
const { EventTips } = exportsModal;
const scene = JSON.parse(fs.readFileSync('assets/scene/game.scene', 'utf8'));
const eventIndex = scene.findIndex(n => n.__type__ === 'cc.Node' && n._name === 'EventTips');
assert.ok(eventIndex > 0, 'Use the scene-authored EventTips');
assert.equal(scene[scene[eventIndex]._parent.__id__]._name, 'Canvas');
function sceneNode(index) {
    const src = scene[index], components = new Map();
    for (const ref of src._components || []) {
        const data = scene[ref.__id__];
        const Type = { 'cc.Label': Label, 'cc.UITransform': UITransform, 'cc.Button': Button, 'cc.BlockInputEvents': BlockInputEvents }[data.__type__];
        if (Type) components.set(Type, new Type());
    }
    return { name: src._name, active: false, isValid: true, children: (src._children || []).map(c => sceneNode(c.__id__)),
        get activeInHierarchy() { return this.active; },
        getComponent: Type => components.get(Type), addComponent(Type) { const c = new Type(); components.set(Type, c); return c; },
        on() {}, off() {}, setSiblingIndex() {}, parent: { children: [] } };
}
const city = { key: 'city-A', name: 'A', levels: ['level-01', 'level-02', 'level-03', 'level-04', 'level-05'] };
const other = { key: 'city-B', name: 'B', levels: ['level-01', 'level-02', 'level-03'] };
const key = i => `${city.key}/${city.levels[i]}`;
function fixture() {
    storage.clear(); failWrite = false;
    const flow = new Flow(); flow.save = new SaveService();
    flow._cities = [city, other]; flow.currentCity = city; flow._isPaused = true; flow._isGameOver = false;
    const tips = new EventTips(); tips.flow = flow; tips.isValid = true; tips.node = sceneNode(eventIndex);
    flow._eventTips = tips;
    let ads = 0, finishAd, placement;
    flow.platform = { showRewardedAd(where) {
        ads++; placement = where;
        return new Promise(resolve => { finishAd = (success = true, completed = true) => resolve({ success, completed }); });
    } };
    const messages = []; flow.toast = text => messages.push(text);
    const screen = new Selection(); screen.flow = flow; screen.isValid = true; screen.node = { activeInHierarchy: true };
    screen._selectionVersion = 1; screen._unlockPending = false;
    let enters = []; screen.rebuild = () => { screen._selectionVersion++; };
    flow.startLevel = async (c, i) => enters.push([c.key, i]);
    return { flow, tips, screen, messages, enters, ads: () => ads, placement: () => placement,
        finish: (success = true, completed = true) => finishAd(success, completed) };
}
const flush = () => new Promise(setImmediate);
async function watch(f, success = true, completed = true) {
    const operation = f.tips._unlockAll(); f.finish(success, completed); await operation;
}
(async () => {
    let f = fixture();
    await f.screen._enterLevel(0); assert.equal(f.ads(), 0); assert.equal(f.tips.node.active, false);
    assert.deepEqual(f.enters, [[city.key, 0]]);
    const dismissed = f.screen._enterLevel(3);
    assert.equal(f.tips.node.active, true); assert.equal(f.ads(), 0, 'Card click must never launch an ad');
    assert.equal(await f.flow.requestLevelUnlock(city, 2), false, 'Cannot replace an open confirmation');
    f.tips.resolveNode(null, 'BtnClose').action(); await dismissed;
    assert.equal(f.enters.length, 1); assert.equal(f.flow.save.isLevelUnlocked(key(3)), false);
    const outside = f.flow.requestLevelUnlock(city, 3);
    const insideTap = { getLocation: () => ({ inside: true }) };
    f.tips._onOutsideTap(insideTap); assert.equal(f.tips.node.active, true, 'Panel/buttons must stay interactive');
    const outsideTap = { getLocation: () => ({ inside: false }) };
    f.tips._onOutsideTap(outsideTap); assert.equal(await outside, false);
    assert.equal(outsideTap.propagationStopped, true, 'Closing background cannot click a card underneath');

    const single = f.screen._enterLevel(3);
    f.tips.resolveNode(null, 'ResultCard/BtnUnlock').action(); assert.equal(f.ads(), 1); assert.equal(f.placement(), 'unlock-level');
    await f.tips._unlockSingle(); await f.tips._unlockAll(); assert.equal(f.ads(), 1, 'Ignore duplicate and cross-option clicks while pending');
    f.finish(); await single;
    assert.equal(f.tips.node.active, false); assert.deepEqual(f.enters.at(-1), [city.key, 3]);
    assert.equal(new SaveService().isLevelUnlocked(key(3)), true); assert.equal(f.flow.isLevelUnlocked(0, 2), false);

    f = fixture(); let confirmation = f.flow.requestLevelUnlock(city, 3);
    await watch(f, true, false); assert.equal(f.tips._watched, 0, 'Cancellation is not progress');
    await watch(f, false, true); assert.equal(f.tips._watched, 0, 'Failed ad is not progress');
    f.flow.platform.showRewardedAd = async () => { throw Error('offline'); };
    await f.tips._unlockAll(); assert.equal(f.tips._watched, 0); assert.equal(f.tips._pending, false);
    f.tips.close(); assert.equal(await confirmation, false);

    f = fixture(); confirmation = f.flow.requestLevelUnlock(city, 3);
    await watch(f); assert.equal(f.placement(), 'unlock-chapter'); assert.equal(f.tips._watched, 1);
    assert.equal(f.tips.resolveLabel(null, 'ResultCard/BtnUnlockAll/Label').string, '全部解锁（1/3）');
    await watch(f); assert.equal(f.tips._watched, 2);
    assert.ok(city.levels.every((_, i) => !f.flow.save.isLevelUnlocked(key(i))), 'Partial chapter progress grants no level');
    f.tips.close(); assert.equal(await confirmation, false); assert.equal(f.tips._watched, 0);
    confirmation = f.flow.requestLevelUnlock(other, 2); f.flow.currentCity = other;
    assert.equal(f.tips._watched, 0, 'Another chapter cannot inherit partial videos');
    f.tips.close(); await confirmation; f.flow.currentCity = city;
    confirmation = f.flow.requestLevelUnlock(city, 3); assert.equal(f.tips._watched, 0);
    const stock = f.flow.save.freeHints;
    await watch(f); await watch(f); await watch(f);
    assert.equal(await confirmation, true); assert.equal(f.tips.node.active, false);
    assert.equal(f.ads(), 5, 'Two discarded videos plus three newly completed videos');
    const restored = new SaveService();
    assert.ok(city.levels.every((_, i) => restored.isLevelUnlocked(key(i))));
    assert.equal(restored.isLevelUnlocked('city-B/level-02'), false);
    assert.equal(restored.totalScore, 0); assert.equal(restored.freeHints, stock);
    assert.equal(Object.keys(restored.data.completed).length, 0, 'Chapter unlock does not award stars, score or food');
    assert.equal(await f.flow.requestLevelUnlock(city, 4), true); assert.equal(f.ads(), 5, 'Already-unlocked levels skip confirmation and ads');

    f = fixture(); confirmation = f.flow.requestLevelUnlock(city, 3);
    await watch(f); await watch(f); failWrite = true;
    const oldData = storage.get('find-difference.save.v3');
    await watch(f); assert.equal(f.tips._watched, 3); assert.equal(f.tips.node.active, true);
    assert.equal(f.flow.save.isLevelUnlocked(key(3)), false);
    assert.equal(storage.get('find-difference.save.v3'), oldData, 'Failed chapter save must be atomic');
    assert.equal(f.tips.resolveLabel(null, 'ResultCard/BtnUnlockAll/Label').string, '重试保存解锁');
    failWrite = false; await f.tips._unlockAll(); assert.equal(await confirmation, true);
    assert.equal(f.ads(), 3, 'Retrying storage must not require a fourth ad');

    f = fixture(); confirmation = f.flow.requestLevelUnlock(city, 3);
    await watch(f); await watch(f);
    const late = f.tips._unlockAll(); f.tips.close(); assert.equal(await confirmation, false);
    const reopened = f.flow.requestLevelUnlock(city, 2);
    f.finish(); await late;
    assert.equal(f.tips._watched, 0, 'Late third-ad callback cannot unlock or count toward reopened popup');
    assert.equal(f.flow.save.isLevelUnlocked(key(3)), false);
    f.tips.onDestroy(); assert.equal(await reopened, false, 'Destroy must resolve the pending selection');

    // Late single-level reward remains earned, but closing confirmation must prevent automatic entry.
    f = fixture(); const selection = f.screen._enterLevel(3);
    const lateSingle = f.tips._unlockSingle(); f.tips.close(); await selection;
    f.finish(); await lateSingle; await flush();
    assert.equal(f.flow.save.isLevelUnlocked(key(3)), true); assert.equal(f.enters.length, 0);
    const nav = f.flow.requestLevelUnlock(city, 2);
    f.flow._cancelSecondaryNavigation = f.flow._stopResultTone = () => {};
    f.flow._switchTo(null); assert.equal(await nav, false, 'Changing screen closes confirmation');
    f.flow.save.reset(); assert.equal(new SaveService().isLevelUnlocked(key(3)), false);
    console.log('PASS EventTips: authored scene bindings, confirmation before ads, single/three-video choices, session-only progress, background/back dismissal, atomic persistent grants and stale-ad guards.');
})().catch(error => { console.error(error); process.exitCode = 1; });
