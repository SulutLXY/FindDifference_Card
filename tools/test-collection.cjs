const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} }).outputText;
let raw = null, failWrite = false;
const saveExports = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: saveExports, console: { warn() {} }, require: () => ({ sys: { localStorage: {
        getItem: () => raw, setItem(_, text) { if (failWrite) throw Error('disk full'); raw = text; },
    } } }),
});
const { SaveService } = saveExports;
function methods(file, names, globals) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Flow {${body}};Flow;`), { console: { warn() {} }, ...globals });
}
const Flow = methods('assets/scripts/GameFlow.ts', ['requestCollectibleUnlock', 'requestReward', 'isCityUnlocked', 'isLevelUnlocked'], {});
class Component {
    isValid = true; scheduled = new Set();
    scheduleOnce(fn) { this.scheduled.add(fn); }
    unschedule(fn) { this.scheduled.delete(fn); }
    renderFrame() { const queued = [...this.scheduled]; this.scheduled.clear(); for (const fn of queued) fn.call(this); }
}
class Label { string = ''; }
class Button {}
class Color {}
class SpriteFrame {}
class Sprite { static SizeMode = { CUSTOM: 0 }; spriteFrame = null; grayscale = false; }
class UITransform {
    width = 100; height = 100; anchorX = .5; anchorY = .5;
    hitTest() { return true; }
    getBoundingBoxToWorld() { return { visible: this.node.onScreen !== false, intersects: other => other.visible !== false }; }
}
class Layout { updateLayout() { this.visibleCount = this.node.children.filter(n => n.active).length; } }
class Animation {
    enabledInHierarchy = true; played = [];
    getState(name) { return this.source._clips.length && name === 'An_BtnClik_01' ? {} : null; }
    play(name) { this.played.push(name); }
}
class Node {
    static EventType = { TOUCH_END: 'end', TOUCH_START: 'start' };
    constructor(name) { this.name = name; this.children = []; this.active = true; this.isValid = true; this.components = new Map(); this.events = new Map(); this.position = { x: 0, y: 0, z: 0 }; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    set parent(node) { this._parent = node; node.children.push(this); }
    get parent() { return this._parent; }
    setPosition(x, y, z) { this.position = { x, y, z }; }
    getChildByName(name) { return this.children.find(n => n.name === name) || null; }
    getComponent(Type) { return this.components.get(Type) || null; }
    getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean); }
    addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c; }
    on(type, action, ctx) { this.events.set(type, () => action.call(ctx)); }
    hasEventListener(type) { return this.events.has(type); }
    off(type) { this.events.delete(type); }
    removeFromParent() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this._parent = null; }
    destroy() { this.isValid = false; }
}
const cc = { _decorator: { ccclass: () => Type => Type, property: () => () => {} }, Component, Label, Button, Color,
    SpriteFrame, Sprite, UITransform, Layout, Animation, Node, Input: { EventType: Node.EventType }, instantiate: clone,
    warn: message => { throw Error(message); } };
function moduleFrom(file, dependencies) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, require: name => name === 'cc' ? cc : dependencies[name] });
    return exports;
}
const screenModule = moduleFrom('assets/scripts/ui/UIScreen.ts', {});
const { CollectScreen } = moduleFrom('assets/scripts/ui/CollectScreen.ts', { './UIScreen': screenModule });
const { UIAnimationBinding } = moduleFrom('assets/scripts/ui/UIAnimationBinding.ts', { './WindowOpenAnimation': {} });
const graph = JSON.parse(fs.readFileSync('assets/LobbySources/SecondaryUI/prefabs/CollectScreen.prefab', 'utf8'));
const binding = graph.find(o => 'itemTemplate' in o);
const types = { 'cc.Label': Label, 'cc.Sprite': Sprite, 'cc.UITransform': UITransform, 'cc.Layout': Layout, 'cc.Animation': Animation };
const frames = new Map();
function frame(uuid) { if (!frames.has(uuid)) frames.set(uuid, { uuid, isValid: true }); return frames.get(uuid); }
function authored(index, nodes) {
    const data = graph[index], node = new Node(data._name);
    node.active = data._active; node.position = { ...data._lpos }; nodes.set(index, node);
    for (const ref of data._components) {
        const src = graph[ref.__id__], Type = types[src.__type__]; if (!Type) continue;
        const c = node.addComponent(Type); c.source = src;
        if (Type === Label) c.string = src._string;
        if (Type === Sprite) c.spriteFrame = src._spriteFrame ? frame(src._spriteFrame.__uuid__) : null;
        if (Type === UITransform) Object.assign(c, { width: src._contentSize.width, height: src._contentSize.height,
            anchorX: src._anchorPoint.x, anchorY: src._anchorPoint.y });
    }
    for (const ref of data._children) authored(ref.__id__, nodes).parent = node;
    return node;
}
function clone(source) {
    const node = new Node(source.name); node.active = source.active; node.position = { ...source.position };
    for (const [Type, original] of source.components) {
        const copy = node.addComponent(Type);
        for (const key of Object.keys(original)) if (key !== 'node') copy[key] = original[key];
    }
    for (const child of source.children) clone(child).parent = node;
    return node;
}
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture({ count = 24, setupSave = () => {}, category = () => undefined } = {}) {
    raw = null; failWrite = false;
    const save = new SaveService(); setupSave(save);
    const foods = Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, name: `藏品${i}`, levelKey: `city-A/id-${i}`,
        icon: `food-icons/icon-${i}`, desc: '说明', cityName: '城市', category: category(i), reviews: [] }));
    const city = { key: 'city-A', levels: foods.map((_, i) => `pinyin-${i}`),
        levelIds: Object.fromEntries(foods.map((food, i) => [`pinyin-${i}`, food.levelKey])) };
    const flow = new Flow(), requests = [], ads = [], messages = [], details = [];
    Object.assign(flow, { save, _foods: foods, foods, _cities: [city], _cityIndex: { topics: [{ chapters: ['city-A'], defaultChapter: 'other' }] },
        _isPaused: true, _rewardPending: false, toast: text => messages.push(text),
        platform: { recoverInterstitialOnTouch() {}, showRewardedAd: placement => new Promise((resolve, reject) => ads.push({ placement, resolve, reject })) },
        loadPageSpriteFrame: path => new Promise(resolve => requests.push({ path, resolve })), releasePageSpriteFrames() {},
        showCatalogFood: item => details.push(item.id) });
    screenModule.registerGameFlow(flow);
    const nodes = new Map(), screen = new CollectScreen(); screen.node = authored(1, nodes);
    for (const key of ['btnBack', 'listRoot', 'itemTemplate', 'collectionBar', 'tabAll', 'tabFood', 'tabPorcelain']) screen[key] = nodes.get(binding[key].__id__);
    for (const key of ['selectedTabFrame', 'normalTabFrame']) screen[key] = frame(binding[key].__uuid__);
    screen.onLoad(); screen.open();
    return { screen, flow, save, foods, city, requests, ads, messages, details,
        iconResults(start = 0, end = requests.length) { for (let i = start; i < end; i++) requests[i].resolve(frame(`loaded-${i}`)); } };
}
function pressTab(f, key) {
    const button = f.screen[key], animation = new UIAnimationBinding(); animation.node = f.screen.node;
    animation._onPress({ target: button.getChildByName('button_primary') });
    assert.equal(button.getComponent(Animation).played.at(-1), 'An_BtnClik_01');
    button.events.get(Node.EventType.TOUCH_END)();
}
(async () => {
    // Collectible + level + city are persisted together; gameplay completion is independent.
    raw = null; let save = new SaveService();
    save.completeLevel('level-a', 2, 10);
    assert.equal(save.isCollectibleObtained('natural', 'level-a'), true);
    assert.equal(save.hasViewedCollectible('natural'), false);
    assert.equal(save.unlockCollectible('video', 'level-b', 'city-B'), true);
    assert.equal(save.isCollectibleObtained('video', 'level-b'), true);
    assert.equal(save.isLevelUnlocked('level-b'), true); assert.equal(save.isCityUnlocked('city-B'), true);
    assert.equal(save.isCompleted('level-b'), false); assert.equal(save.totalScore, 1);
    const before = JSON.stringify(save.data); failWrite = true;
    assert.equal(save.unlockCollectible('failed', 'level-c', 'city-C'), false);
    assert.equal(save.markCollectiblesViewed(['video']), false);
    assert.equal(JSON.stringify(save.data), before);
    failWrite = false; save = new SaveService();
    assert.equal(save.isCollectibleObtained('failed', 'level-c'), false);
    assert.equal(save.markCollectiblesViewed(['video']), true);
    assert.equal(new SaveService().hasViewedCollectible('video'), true);
    assert.equal(save.unlockCollectible('video', 'level-b', 'city-B'), true);
    assert.equal(save.hasViewedCollectible('video'), true, 'Repeated unlock cannot reset viewed state');

    let f = fixture({ setupSave(s) { for (let i = 0; i < 15; i++) s.completeLevel(`city-A/id-${i}`, 1, 10); } });
    const { screen } = f;
    assert.equal(screen._cards.length, 9); assert.equal(f.requests.length, 9);
    assert.equal(screen._statsLabel.string, '已收藏：15/24'); assert.equal(screen._pageLabel.string, '1/3');
    assert.equal(screen._barFill.getComponent(UITransform).width, 350 * 15 / 24);
    assert.equal(screen._barFill.position.x - screen._barFill.getComponent(UITransform).width / 2, -175, 'Bar fills from authored left edge');
    assert.equal(screen._btnPrev.active, false); assert.equal(screen._btnNext.active, true);
    assert.ok(screen._cards.every(card => card.getChildByName('TipsIcon').active));
    f.iconResults(); await tick();
    assert.equal(f.save.hasViewedCollectible('item-0'), false, 'Download alone does not mark seen before display');
    screen._cards[0].onScreen = false;
    screen.renderFrame();
    assert.equal(f.save.hasViewedCollectible('item-0'), false, 'Off-screen card remains new');
    for (let i = 1; i < 9; i++) assert.equal(f.save.hasViewedCollectible(`item-${i}`), true);
    assert.equal(f.save.hasViewedCollectible('item-9'), false, 'Unopened page stays new');
    assert.equal(screen._cards[1].getChildByName('TipsIcon').active, false);
    assert.equal(screen.items[0].id, 'item-0', 'Marking seen does not reshuffle current session');
    screen._turnPage(1); assert.equal(screen._pageLabel.string, '2/3');
    assert.equal(screen._cards[6].getChildByName('LockIcon').active, true);
    assert.equal(screen._cards[6].getChildByName('Thumbnail').getComponent(Sprite).grayscale, true);
    screen.close(); screen.open();
    assert.equal(screen.items.slice(0, 7).map(item => item.id).join(','), 'item-0,item-9,item-10,item-11,item-12,item-13,item-14');
    assert.equal(screen.items[7].id, 'item-1', 'Viewed obtained items precede locked items');
    pressTab(f, 'tabPorcelain');
    assert.equal(screen._cards.length, 0); assert.equal(screen._pageLabel.string, '0/0');
    assert.equal(screen._btnPrev.active, false); assert.equal(screen._btnNext.active, false);
    assert.equal(screen._statsLabel.string, '已收藏：15/24', 'Filter does not change global progress');
    assert.equal(screen.tabPorcelain.getChildByName('button_primary').getComponent(Sprite).spriteFrame, screen.selectedTabFrame);
    assert.equal(screen.tabAll.getChildByName('button_primary').getComponent(Sprite).spriteFrame, screen.normalTabFrame);
    pressTab(f, 'tabFood'); assert.equal(screen._cards.length, 9);
    pressTab(f, 'tabAll'); assert.equal(screen._page, 0);

    // Future porcelain entries use the same filtering; current food records need no category changes.
    f = fixture({ category: i => i < 4 ? 'porcelain' : 'food' });
    pressTab(f, 'tabPorcelain'); assert.equal(f.screen._cards.length, 4);
    assert.equal(f.screen._pageLabel.string, '1/1');
    assert.equal(f.screen._barFill.active, false, 'Zero obtained produces empty bar');
    pressTab(f, 'tabFood'); assert.equal(f.screen._pageLabel.string, '1/3');
    f.screen._turnPage(2); assert.equal(f.screen._cards.length, 2); assert.equal(f.screen._btnNext.active, false);

    // All categories share priority groups: new unlocked, viewed unlocked, locked; then natural ID order.
    f = fixture({ count: 60, category: i => i >= 40 ? 'porcelain' : 'food',
        setupSave(s) {
            for (const id of [0,10,49,58]) s.completeLevel(`city-A/id-${id}`, 1, 10);
            s.markCollectiblesViewed(['item-10','item-58']);
        } });
    assert.equal(f.screen._pageLabel.string, '1/7');
    const lockedIds = Array.from({length:60}, (_,i)=>i).filter(i=>![0,10,49,58].includes(i));
    assert.equal(f.screen.items.map(item=>item.id).join(','),
        [0,49,10,58,...lockedIds].map(i=>`item-${i}`).join(','),
        'Unlocked food/porcelain precede locked entries globally; each priority group uses ID order');
    assert.equal(f.screen._statsLabel.string, '已收藏：4/60');
    const pages = f.screen._pages();
    assert.deepEqual(Array.from(pages, page => page.length), [9,9,9,9,9,9,6]);
    assert.equal(pages.flat().map(item => item.id).join(','), f.screen.items.map(item => item.id).join(','),
        'Unified pagination preserves order without omitting or duplicating collectibles');
    assert.deepEqual(Array.from(pages[0].slice(0,4), item => item.category), ['food','porcelain','food','porcelain'],
        'Category must not outrank new/obtained state or ID');
    f.iconResults(); await tick(); f.screen.renderFrame();
    assert.equal(f.save.hasViewedCollectible('item-49'), true);
    assert.equal(f.save.hasViewedCollectible('item-0'), true, 'Visible new food is marked seen on the same page as porcelain');
    assert.equal(f.save.hasViewedCollectible('item-20'), false, 'Unopened entries remain unseen');
    f.screen._turnPage(2); assert.equal(f.screen._cards.length, 9); assert.equal(f.screen._pageLabel.string, '3/7');
    assert.equal(f.screen._cards.map(card=>card.name).join(','), pages[2].map(item=>`CollectItem-${item.id}`).join(','));
    f.screen._turnPage(4); assert.equal(f.screen._cards.length, 6); assert.equal(f.screen._pageLabel.string, '7/7');
    assert.equal(f.screen._btnNext.active, false);
    pressTab(f, 'tabFood'); assert.equal(f.screen._pageLabel.string, '1/5');
    f.screen._turnPage(4); assert.equal(f.screen._cards.length, 4); assert.equal(f.screen._btnNext.active, false);
    pressTab(f, 'tabPorcelain'); assert.equal(f.screen._pageLabel.string, '1/3');
    pressTab(f, 'tabAll'); assert.equal(f.screen._pageLabel.string, '1/7');

    f = fixture({ count: 3 });
    assert.equal(f.flow.isCityUnlocked(0), false);
    let pending = f.screen._onItemClick(f.screen.items[0]);
    await f.screen._onItemClick(f.screen.items[0]); assert.equal(f.ads.length, 1, 'Double tap coalesces ad');
    assert.equal(f.ads[0].placement, 'unlock-level');
    f.ads[0].resolve({ success: true, completed: false }); await pending;
    assert.equal(f.save.isCollectibleObtained('item-0', 'city-A/id-0'), false);
    pending = f.screen._onItemClick(f.screen.items[0]); f.ads[1].reject(Error('offline')); await pending;
    assert.equal(f.save.totalScore, 0); assert.equal(f.save.isLevelUnlocked('city-A/id-0'), false);
    pending = f.screen._onItemClick(f.screen.items[0]); failWrite = true;
    f.ads[2].resolve({ success: true, completed: true }); await pending; failWrite = false;
    assert.equal(f.save.isCollectibleObtained('item-0', 'city-A/id-0'), false, 'Failed persistence grants neither reward');
    pending = f.screen._onItemClick(f.screen.items[0]);
    f.screen.close(); f.ads[3].resolve({ success: true, completed: true }); await pending;
    assert.equal(f.screen._cards.length, 0, 'Late ad completion does not reopen a closed collection page');
    assert.equal(f.save.isCollectibleObtained('item-0', 'city-A/id-0'), true);
    assert.equal(f.flow.isLevelUnlocked(0, 0), true, 'Reward also opens corresponding first level in a gated city');
    assert.equal(f.save.isCompleted('city-A/id-0'), false); assert.equal(f.save.totalScore, 0);
    f.screen.open(); assert.equal(f.screen._statsLabel.string, '已收藏：1/3');
    assert.equal(f.screen._cards[0].getChildByName('LockIcon').active, false);
    const adCount = f.ads.length;
    await f.screen._onItemClick(f.screen.items[0]);
    assert.equal(f.ads.length, adCount); assert.deepEqual(f.details, ['item-0']);
    const oldIcon = f.screen._cards[0].getChildByName('Thumbnail').getComponent(Sprite), oldFrame = oldIcon.spriteFrame;
    pressTab(f, 'tabPorcelain'); f.iconResults(); await tick(); f.screen.renderFrame();
    assert.equal(oldIcon.spriteFrame, oldFrame, 'Late image cannot write into a previous filter');
    assert.equal(f.save.hasViewedCollectible('item-0'), false, 'Hidden page is not marked viewed by late image');
    assert.equal(await f.flow.requestCollectibleUnlock('unknown-id'), false);
    f.foods[1].levelKey = ''; assert.equal(await f.flow.requestCollectibleUnlock('item-1'), false);

    // ID order is authoritative even when input order and asset numbers disagree.
    f = fixture({ count: 3 }); f.foods[0].assetNumber = 5; f.foods[1].assetNumber = 1; f.foods[2].assetNumber = 3;
    f.foods[0].id='collect-10';f.foods[1].id='collect-2';f.foods[2].id='collect-1';
    f.screen.close(); f.screen.open(); assert.equal(f.screen.items.map(item => item.id).join(','), 'collect-1,collect-2,collect-10');
    f = fixture({ count: 1, setupSave: s => s.completeLevel('city-A/id-0', 1, 10) });
    f.iconResults(); await tick(); failWrite = true; f.screen.renderFrame(); failWrite = false;
    assert.equal(f.save.hasViewedCollectible('item-0'), false);
    assert.equal(f.screen._cards[0].getChildByName('TipsIcon').active, true, 'Failed seen-state save retains badge');
    f.screen.close(); f.screen.open(); f.iconResults(); await tick(); f.screen.renderFrame();
    assert.equal(f.save.hasViewedCollectible('item-0'), true, 'Seen-state write retries on next visible display');
    assert.equal(f.screen._cards[0].getChildByName('TipsIcon').active, false);
    const ids = [];
    for (let i = 0; i < graph.length; i++) if (graph[i].__type__ === 'cc.Node') {
        ids.push(i); for (const c of graph[i]._components) assert.equal(graph[c.__id__].node.__id__, i);
    }
    for (const key of ['collectionBar', 'tabAll', 'tabFood', 'tabPorcelain']) assert.ok(ids.includes(binding[key].__id__));
    console.log('PASS collection: global progress, categories/backgrounds/animations, 9/page, cross-category new/obtained/ID ordering, visible-only seen state, atomic collectible+level unlock, cancellation/failure and stale callbacks');
})().catch(error => { console.error(error); process.exitCode = 1; });
