const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const warnings = [];
class Component { isValid = true; }
class Color { constructor(...rgba) { this.rgba = rgba; } }
class Label { static Overflow = { SHRINK: 2 }; string = ''; }
class Sprite { static SizeMode = { CUSTOM: 0 }; spriteFrame = null; }
class Button {}
class UITransform { hitTest() { return true; } }
class Layout {
    static ResizeMode = { NONE: 0 }; enabled = true;
    updateLayout() { this.lastVisible = this.node.children.filter(node => node.active).length; }
}
class ScrollView {}
class Animation { played = []; enabledInHierarchy = true; getState() { return {}; } play(name) { this.played.push(name); } }
class Node {
    static EventType = { TOUCH_END: 'end', TOUCH_START: 'start', CHILD_ADDED: 'added' };
    constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.active = true; this.isValid = true; this.events = new Map(); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    set parent(node) { this._parent = node; node.children.push(this); }
    get parent() { return this._parent; }
    getChildByName(name) { return this.children.find(node => node.name === name) || null; }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component; }
    getComponent(Type) { return this.components.get(Type) || null; }
    on(type, fn, ctx) { this.events.set(type, () => fn.call(ctx)); }
    off(type) { this.events.delete(type); }
    destroy() { this.destroyPending = true; } // Cocos destroys at frame end, so old cards must already be inactive.
}
const cc = { _decorator: { ccclass: () => Type => Type, property: () => () => {} },
    Color, Component, Label, Sprite, Button, UITransform, Layout, ScrollView, Animation, Node,
    Input: { EventType: Node.EventType }, warn: message => warnings.push(message), instantiate: clone };
function moduleFrom(file, dependencies) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, require: name => name === 'cc' ? cc : dependencies[name] });
    return exports;
}
const screenModule = moduleFrom('assets/scripts/ui/UIScreen.ts', {});
const { LevelSelectScreen } = moduleFrom('assets/scripts/ui/LevelSelectScreen.ts', {
    './UIScreen': screenModule, './EnergyDisplay': { EnergyDisplay: { attach: async () => {} } },
});
const { UIAnimationBinding } = moduleFrom('assets/scripts/ui/UIAnimationBinding.ts', {
    './WindowOpenAnimation': { WINDOW_OPEN_CLIPS: [] },
});
const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/LevelSelectScreen.prefab', 'utf8'));
const bindings = prefab.find(entry => entry.__type__ === 'dbc3bsMgU9Bq66sQ4N0YM1O');
const types = { 'cc.Label': Label, 'cc.Sprite': Sprite, 'cc.Layout': Layout,
    'cc.UITransform': UITransform, 'cc.Animation': Animation, 'cc.ScrollView': ScrollView };
function authoredNode(index, nodes) {
    const src = prefab[index], node = new Node(src._name);
    node.active = src._active; nodes.set(index, node);
    for (const ref of src._components) {
        const data = prefab[ref.__id__], Type = types[data.__type__];
        if (!Type) continue;
        const component = node.addComponent(Type);
        component.string = data._string ?? ''; component.source = data;
    }
    for (const child of src._children) authoredNode(child.__id__, nodes).parent = node;
    return node;
}
function clone(source) {
    const node = new Node(source.name); node.active = source.active;
    for (const [Type, component] of source.components) Object.assign(node.addComponent(Type), { source: component.source });
    for (const child of source.children) clone(child).parent = node;
    return node;
}
function city(key, count) {
    return { key, name: key, levelsLoaded: true, levels: Array.from({ length: count }, (_, i) => `folder-${i}`),
        levelConfigs: Array.from({ length: count }, (_, i) => ({ key: `${key}/id-${i}`, name: `名称${i}`, icon: `${key}/icon-${i}` })) };
}
function fixture(count = 30, optional = false, options = {}) {
    const nodes = new Map(), root = authoredNode(1, nodes), screen = new LevelSelectScreen();
    screen.node = root; root.active = true;
    for (const key of ['btnBack', 'pageTitle', 'listRoot', 'cardTemplate', 'chapterProgress', 'pageLabel', 'btnPrevious', 'btnNext']) {
        const data = prefab[bindings[key].__id__];
        screen[key] = data.__type__ === 'cc.Node' ? nodes.get(bindings[key].__id__)
            : nodes.get(data.node.__id__).getComponent(types[data.__type__]);
    }
    if (optional) {
        screen.chapterProgress = screen.pageLabel = screen.btnPrevious = screen.btnNext = null;
        nodes.get(23).name = 'RemovedOptionalProgress';
    }
    const chapter = city('A', count), requests = [], entered = [], checks = [], releases = [];
    const flow = {
        cities: [chapter], currentCity: chapter,
        platform: { recoverInterstitialOnTouch() {} },
        cityProgress: c => ({ done: c.levelConfigs.filter((_, i) => i < 3).length, total: c.levels.length }),
        save: { progressOf: options.progressOf ?? (key => ({ stars: key.endsWith('id-0') ? 2 : 0 })) },
        isLevelUnlocked: (cityIndex, index) => {
            checks.push([cityIndex, index]); return options.isUnlocked ? options.isUnlocked(index) : index < 3;
        },
        requestLevelUnlock: async () => true,
        startLevel: async (c, index) => entered.push([c.key, index]),
        returnToChapterSelection() {},
        releasePageSpriteFrames: owner => releases.push(owner),
        loadPageSpriteFrame: path => new Promise(resolve => requests.push({ path, resolve })),
    };
    screenModule.registerGameFlow(flow);
    screen.onLoad(); screen.open();
    return { screen, flow, root, nodes, requests, entered, checks, releases };
}
function press(f, direction) {
    const node = direction === 'next' ? f.screen.btnNext : f.screen.btnPrevious;
    assert.ok(node.active, 'Visible page navigation');
    const animation = new UIAnimationBinding(); animation.node = f.root;
    animation._onPress({ target: node.getChildByName('btn_icon') });
    assert.equal(node.getComponent(Animation).played.at(-1), 'An_BtnClik_01');
    node.events.get(Node.EventType.TOUCH_END)();
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
(async () => {
    let f = fixture();
    assert.equal(f.screen.pageLabel.string, '1/4');
    assert.equal(f.screen.chapterProgress.string, '3/30');
    assert.equal(f.screen.btnPrevious.active, false); assert.equal(f.screen.btnNext.active, true);
    assert.equal(f.requests.length, 8, 'Only first-page thumbnails requested');
    assert.equal(f.screen._runtimeCards.length, 8);
    assert.equal(f.screen.listRoot.getComponent(ScrollView), null, 'No scrolling component added');
    assert.equal(f.screen.listRoot.getComponent(Layout).lastVisible, 8);
    assert.deepEqual(f.checks.slice(-8), Array.from({ length: 8 }, (_, i) => [0, i]));
    const firstCard = f.screen._runtimeCards[0];
    assert.equal(firstCard.getChildByName('CardName').getComponent(Label).string, '名称0');
    const stars = firstCard.getChildByName('CardDetail').children.map(bg => bg.getChildByName('CardDetail_star').active);
    assert.deepEqual(stars, [true, true, false]);
    assert.equal(f.screen._runtimeCards[7].getChildByName('LockIcon').active, true);
    const oldThumbnail = f.screen.findChildDeep(firstCard, 'Thumbnail').getComponent(Sprite);
    const oldFrame = { isValid: true };
    press(f, 'next');
    assert.equal(f.screen.pageLabel.string, '2/4');
    assert.equal(firstCard.active, false, 'Old cards are hidden before deferred destruction');
    assert.equal(f.screen.listRoot.getComponent(Layout).lastVisible, 8, 'Old cards do not affect grid');
    assert.equal(f.requests.length, 16);
    assert.equal(f.requests[8].path, 'A/icon-8');
    f.requests[0].resolve(oldFrame); await tick();
    assert.equal(oldThumbnail.spriteFrame, null, 'Late old-page download cannot write a released image');
    const freshFrame = { isValid: true }; f.requests[8].resolve(freshFrame); await tick();
    assert.equal(f.screen.findChildDeep(f.screen._runtimeCards[0], 'Thumbnail').getComponent(Sprite).spriteFrame, freshFrame);
    f.screen._runtimeCards[0].events.get(Node.EventType.TOUCH_END)(); await tick();
    assert.deepEqual(f.entered, [['A', 8]], 'First card on page two opens chapter index eight');
    assert.equal(f.screen.pageLabel.string, '2/4', 'Unlock rebuild keeps current page');
    press(f, 'next'); press(f, 'next');
    assert.equal(f.screen.pageLabel.string, '4/4');
    assert.equal(f.screen._runtimeCards.length, 6); assert.equal(f.screen.btnNext.active, false);
    assert.equal(f.screen.btnPrevious.active, true);
    const before = f.requests.length;
    for (const index of [-1, 4, NaN, 1.5]) f.screen._goToPage(index);
    assert.equal(f.requests.length, before, 'Out-of-bounds pages ignored');
    press(f, 'prev'); assert.equal(f.screen.pageLabel.string, '3/4');
    f.screen.close(); f.screen.open(); assert.equal(f.screen.pageLabel.string, '1/4', 'Reopening locates earliest locked level again');
    f.screen._goToPage(2);

    // A page change during an unlock prevents stale navigation into the previous page.
    let finish; f.flow.requestLevelUnlock = () => new Promise(resolve => { finish = resolve; });
    const pending = f.screen._enterLevel(16);
    press(f, 'prev'); finish(true); await pending;
    assert.deepEqual(f.entered, [['A', 8]]);
    const other = city('B', 8); f.flow.cities.push(other); f.flow.currentCity = other; f.screen.rebuild();
    assert.equal(f.screen.pageLabel.string, '1/1');
    assert.equal(f.screen.btnPrevious.active, false); assert.equal(f.screen.btnNext.active, false);
    assert.equal(f.screen._runtimeCards.length, 8);
    f.flow.currentCity = city('C', 0); f.screen.rebuild();
    assert.equal(f.screen.pageLabel.string, '0/0'); assert.equal(f.screen._runtimeCards.length, 0);
    assert.equal(f.screen.btnPrevious.active, false); assert.equal(f.screen.btnNext.active, false);

    f = fixture(9, true); // No progress component, and paging uses name lookup instead of bindings.
    assert.equal(f.nodes.get(135).getComponent(Label).string, '1/2');
    assert.equal(f.screen.btnPrevious.active, false); press(f, 'next');
    assert.equal(f.nodes.get(135).getComponent(Label).string, '2/2');
    assert.equal(f.screen._runtimeCards.length, 1);
    assert.deepEqual(warnings, [], 'Missing optional progress is skipped silently');

    // Earlier locked levels take priority over an unlocked jump on page four and all star records.
    f = fixture(30, false, { isUnlocked: index => index < 8 || index >= 24 });
    assert.equal(f.screen.pageLabel.string, '2/4');
    assert.equal(f.requests.length, 8, 'Initial selection loads only the target page');
    assert.equal(f.requests[0].path, 'A/icon-8');
    assert.equal(f.screen.btnPrevious.active, true); assert.equal(f.screen.btnNext.active, true);
    press(f, 'next'); assert.equal(f.screen.pageLabel.string, '3/4', 'Manual paging does not snap back');
    f.screen.rebuild(); assert.equal(f.screen.pageLabel.string, '3/4', 'State refresh preserves manual page');
    f.screen.close(); f.screen.open(); assert.equal(f.screen.pageLabel.string, '2/4');

    // All unlocked: lower stars beat an earlier two-star level; ties use chapter order.
    f = fixture(30, false, { isUnlocked: () => true, progressOf: key => ({
        stars: ['A/id-17', 'A/id-25'].includes(key) ? 1 : key === 'A/id-9' ? 2 : 3,
    }) });
    assert.equal(f.screen.pageLabel.string, '3/4');
    assert.equal(f.requests.length, 8); assert.equal(f.requests[0].path, 'A/icon-16');
    f.flow.save.progressOf = key => key === 'A/id-25' ? undefined : { stars: 3 };
    f.screen.close(); f.screen.open();
    assert.equal(f.screen.pageLabel.string, '4/4', 'Unlocked level without progress is zero stars');
    assert.equal(f.screen.btnNext.active, false);
    f.flow.save.progressOf = () => ({ stars: 3 });
    f.screen.close(); f.screen.open();
    assert.equal(f.screen.pageLabel.string, '1/4', 'All three stars returns to the earliest tied level');
    const newChapter = city('B', 30); f.flow.cities.push(newChapter); f.flow.currentCity = newChapter;
    f.flow.isLevelUnlocked = (cityIndex, index) => { assert.equal(cityIndex, 1); return index < 16; };
    f.screen.close(); f.screen.open();
    assert.equal(f.screen.pageLabel.string, '3/4', 'New chapter uses its own unlock state');

    f = fixture(0); assert.equal(f.screen.pageLabel.string, '0/0');
    assert.equal(f.requests.length, 0); assert.equal(f.screen.btnPrevious.active, false); assert.equal(f.screen.btnNext.active, false);

    // Authored two-column/four-row geometry fits inside List without runtime resizing.
    const list = prefab[127]._contentSize, card = prefab[120]._contentSize, layout = prefab[129];
    assert.ok(card.width * 2 + layout._spacingX + layout._paddingLeft + layout._paddingRight <= list.width);
    assert.ok(card.height * 4 + layout._spacingY * 3 + layout._paddingTop + layout._paddingBottom <= list.height);
    const clip = JSON.parse(fs.readFileSync('assets/PleyGame/Common/Animation/An_BtnClik_01.anim.meta', 'utf8')).uuid;
    for (const id of [150, 162]) assert.equal(prefab[id]._defaultClip.__uuid__, clip, 'Existing arrow animation retained');
    console.log('PASS level pagination: earliest locked / lowest-star entry, 8/page, chapter indices, progress, arrows, animations, late results and optional labels');
})().catch(error => { console.error(error); process.exitCode = 1; });
