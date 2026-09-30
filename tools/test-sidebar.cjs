// Run: node tools/test-sidebar.cjs. No real platform API calls or player saves.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('D:/CocosCreator/v3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}, logger = console) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => deps[name] || {}, console: logger, setTimeout, clearTimeout });
    return exports;
}
const sidebarModule = load('assets/scripts/services/SidebarService.ts');
const { SidebarService, sidebarDay } = sidebarModule;
const sidebarOptions = { launch_from: 'homepage', location: 'sidebar_card', scene: '021036' };
function sdkHost(options = {}) {
    const listeners = new Set();
    const host = { tt: {
        onShow: listener => listeners.add(listener), offShow: listener => listeners.delete(listener),
        getLaunchOptionsSync: () => options,
        checkScene: request => request.success({ isExist: true }),
        navigateToScene: request => request.success({ errMsg: 'navigateToScene:ok' }),
    } };
    return { host, listeners, show: options => [...listeners].forEach(listener => listener(options)) };
}
let raw = null;
let failWrite = false;
const storage = { getItem: () => raw, setItem: (_, value) => {
    if (failWrite) throw Error('mock disk full');
    raw = value;
}, removeItem: () => { raw = null; } };
const saveWarnings = [];
const { SaveService } = load('assets/scripts/services/SaveService.ts', { cc: { sys: { localStorage: storage } } },
    { ...console, warn: (...args) => saveWarnings.push(args) });
const decorator = () => () => {};
const { GameFlow } = load('assets/scripts/GameFlow.ts', {
    cc: { Component: class {}, _decorator: { ccclass: decorator, property: decorator } },
    './services/SidebarService': sidebarModule,
});

(async () => {
    assert.equal(sidebarDay(Date.parse('2026-09-30T15:59:59Z')), '2026-09-30');
    assert.equal(sidebarDay(Date.parse('2026-09-30T16:00:00Z')), '2026-10-01');
    let now = Date.parse('2026-09-30T12:00:00Z');
    const runtime = sdkHost();
    const service = new SidebarService(runtime.host, () => now, 10);
    await service.start();
    await service.start();
    assert.equal(runtime.listeners.size, 1);
    assert.equal(service.supported, true);
    assert.equal(service.fromSidebarToday, false);
    assert.equal((await service.navigate()).success, true);
    assert.equal(service.fromSidebarToday, false, 'jump success must not grant a reward');
    runtime.show(sidebarOptions);
    assert.equal(service.fromSidebarToday, true);
    runtime.show({ scene: '021036' });
    assert.equal(service.fromSidebarToday, false, 'scene number alone is not proof');
    runtime.show(sidebarOptions);
    now += 86400000;
    assert.equal(service.fromSidebarToday, false, 'yesterday return cannot unlock today');
    runtime.show(sidebarOptions);
    assert.equal(service.fromSidebarToday, true);
    runtime.show({ launch_from: 'share', location: 'sidebar_card' });
    assert.equal(service.fromSidebarToday, false, 'latest non-sidebar return clears eligibility');
    runtime.host.tt.navigateToScene = request => request.fail({});
    assert.equal((await service.navigate()).success, false);
    assert.equal(service.navigating, false);
    runtime.host.tt.navigateToScene = () => {};
    const waiting = service.navigate();
    assert.equal((await service.navigate()).success, false, 'duplicate jump blocked');
    assert.equal((await waiting).success, false, 'timeout releases button');
    service.dispose();
    assert.equal(runtime.listeners.size, 0);

    for (const mode of ['absent', 'false', 'fail', 'throw', 'timeout', 'malformed']) {
        const r = sdkHost();
        if (mode === 'absent') delete r.host.tt.checkScene;
        else r.host.tt.checkScene = request => {
            if (mode === 'throw') throw Error('mock');
            if (mode === 'false') request.success({ isExist: false });
            if (mode === 'malformed') request.success({});
            if (mode === 'fail') request.fail({});
        };
        const s = new SidebarService(r.host, () => now, 5);
        await s.start();
        assert.equal(s.supported, false, mode);
        s.dispose();
    }
    const h5 = new SidebarService({});
    await h5.start();
    assert.equal(h5.supported, false);

    // Execute the actual game.ejs preamble before starting the application service.
    const template = fs.readFileSync(path.join(root, 'build-templates/bytedance-mini-game/game.ejs'), 'utf8');
    const bridgeRuntime = sdkHost();
    const bridgeContext = vm.createContext({ ...bridgeRuntime.host, console, Date });
    const preamble = template.slice(0, template.indexOf('<%'));
    vm.runInContext(preamble, bridgeContext);
    vm.runInContext(preamble, bridgeContext);
    assert.equal(bridgeRuntime.listeners.size, 1, 'bootstrap is idempotent');
    bridgeRuntime.show(sidebarOptions); // Happens BEFORE scene initialization.
    const bridged = new SidebarService(bridgeContext);
    await bridged.start();
    assert.equal(bridged.fromSidebarToday, true, 'cold start preserved');
    bridgeRuntime.show({});
    assert.equal(bridged.fromSidebarToday, false);
    bridgeRuntime.show(sidebarOptions);
    assert.equal(bridged.fromSidebarToday, true);
    bridged.dispose();
    assert.equal(bridgeContext.__findDifferenceSidebar.listeners.length, 0);

    // Actual SaveService and GameFlow claim/consume methods, with memory-only storage.
    const flow = Object.create(GameFlow.prototype);
    flow.save = new SaveService();
    flow.platform = { sidebar: { supported: true, fromSidebarToday: false } };
    flow.toast = () => {};
    assert.equal(flow.save.freeHints, 0, 'existing saves default to no inventory');
    assert.equal(flow.claimSidebarReward(), false);
    flow.platform.sidebar.fromSidebarToday = true;
    assert.equal(flow.claimSidebarReward(), true);
    assert.equal(flow.save.freeHints, 2);
    assert.equal(flow.claimSidebarReward(), false);
    assert.equal(new SaveService().freeHints, 2, 'reward survives reload');
    assert.equal(new SaveService().hasClaimedSidebar(sidebarDay()), true);
    flow._isPaused = false;
    flow._isGameOver = false;
    flow.game = { node: { activeInHierarchy: true }, refreshHud() {} };
    flow._currentLevel = { differences: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    flow._foundIds = new Set();
    flow.onDifferenceFound = difference => flow._foundIds.add(difference.id);
    let adCalls = 0;
    flow.requestReward = async (_, reward) => { adCalls++; reward(); };
    await flow.requestHint();
    assert.equal(flow.save.freeHints, 1);
    assert.equal(flow._foundIds.has('a'), true);
    await flow.requestHint();
    assert.equal(flow.save.freeHints, 0);
    assert.equal(adCalls, 0);
    await flow.requestHint();
    assert.equal(adCalls, 1, 'ads resume only after free hints are exhausted');
    assert.equal(flow._foundIds.size, 3);
    await flow.requestHint();
    assert.equal(adCalls, 1, 'no remaining differences does not consume or launch ads');

    assert.equal(flow.save.claimSidebar('2099-01-01', 2), 'claimed');
    const saved = raw;
    failWrite = true;
    assert.equal(flow.save.claimSidebar('2099-01-02', 2), 'storage-error');
    assert.equal(flow.save.freeHints, 2);
    assert.equal(flow.save.hasClaimedSidebar('2099-01-02'), false);
    assert.equal(raw, saved);
    assert.equal(flow.save.consumeFreeHint(), false);
    assert.equal(flow.save.freeHints, 2);
    flow._foundIds.clear();
    await flow.requestHint();
    assert.equal(flow._foundIds.size, 0, 'failed inventory write cannot apply a hint');
    failWrite = false;
    flow._isPaused = true;
    await flow.requestHint();
    flow._isPaused = false;
    flow._isGameOver = true;
    await flow.requestHint();
    assert.equal(flow.save.freeHints, 2, 'paused/finished games cannot spend inventory');
    assert.equal(flow.save.claimSidebar('2098-12-31', 2), 'already-claimed', 'clock rollback blocked');
    assert.equal(flow.save.claimSidebar('2099-01-02', 2), 'claimed');
    assert.equal(new SaveService().freeHints, 4);
    assert.equal(saveWarnings.length, 3, 'all injected storage failures reported');

    // Drive the real gift component through its user flow, with lightweight Cocos UI doubles.
    class Transform { setContentSize(w, h) { this.width = w; this.height = h; } }
    class Graphics { roundRect() {} rect() {} fill() {} stroke() {} }
    class Label {}
    Label.HorizontalAlign = Label.VerticalAlign = { CENTER: 1 };
    Label.Overflow = { SHRINK: 1 };
    class Color {}
    Color.WHITE = {};
    class Node {
        constructor(name) { this.name = name; this.children = []; this.parts = new Map(); this.events = {}; this.active = true; this.isValid = true; }
        set parent(p) { this._parent = p; p.children.push(this); }
        get parent() { return this._parent; }
        get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
        addComponent(type) { const part = new type(); this.parts.set(type, part); return part; }
        getComponent(type) { return this.parts.get(type); }
        setPosition() {} setSiblingIndex() {}
        on(name, callback, owner) { this.events[name] = callback.bind(owner); }
        destroy() { this.isValid = false; }
    }
    class UIScreen { schedule() {} }
    const { SidebarGift } = load('assets/scripts/ui/SidebarGift.ts', {
        cc: { _decorator: { ccclass: decorator }, Node, Label, Color, Graphics, UITransform: Transform,
            BlockInputEvents: class {}, Input: { EventType: { TOUCH_END: 'click' } } },
        '../services/SidebarService': sidebarModule, './UIScreen': { UIScreen },
    });
    raw = null;
    const uiRuntime = sdkHost();
    const uiSidebar = new SidebarService(uiRuntime.host);
    await uiSidebar.start();
    flow.save = new SaveService();
    flow.platform.sidebar = uiSidebar;
    const gift = new SidebarGift();
    gift.flow = flow;
    gift.isValid = true;
    gift.node = new Node('Gameflow');
    gift.node.parent = new Node('Lobby');
    gift.node.addComponent(Transform);
    gift.onLoad();
    gift.node.events.click();
    assert.equal(gift._modal.active, true);
    assert.equal(gift._action.string, '去首页侧边栏');
    await gift._performAction();
    assert.equal(gift._modal.active, false);
    assert.equal(flow.save.freeHints, 0);
    uiRuntime.show(sidebarOptions);
    assert.equal(gift._modal.active, true, 'return reopens the reward dialog');
    assert.equal(gift._action.string, '领取奖励');
    await gift._performAction();
    await gift._performAction();
    assert.equal(flow.save.freeHints, 2);
    assert.equal(gift._action.string, '今日已领取');
    assert.equal(gift._inventory.string, '当前免费提示：2 次');
    gift.onDisable();
    assert.equal(gift._modal.active, false, 'leaving lobby closes dialog');
    gift.onDestroy();
    assert.equal(gift._modal.isValid, false);
    uiSidebar.dispose();
    console.log('PASS: startup bridge, latest return source, support/failure/timeout, daily rollover, persistence, duplicate claims, free hints and ad fallback.');
    console.log('PASS: lobby entry -> guide -> jump -> return -> claim -> already claimed; dialog cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
