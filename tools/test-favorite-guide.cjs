const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} }).outputText;
class Label {}
class BlockInputEvents {}
class Button {}
class Component { isValid = true; }
class Color {}
class UITransform { hitTest() { return true; } }
class Node {
    constructor(name) { this.name = name; this.children = []; this.isValid = true; this.active = true; this.components = new Map(); this.listeners = new Map(); }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    getComponent(Type) { return this.components.get(Type) || null; }
    addComponent(Type) { const c = new Type(); this.components.set(Type, c); return c; }
    on(type, fn, ctx) { const events = this.listeners.get(type) || []; events.push({ fn, ctx }); this.listeners.set(type, events); }
    off(type, fn, ctx) { this.listeners.set(type, (this.listeners.get(type) || []).filter(event => event.fn !== fn || event.ctx !== ctx)); }
    emit(type) { for (const event of this.listeners.get(type) || []) event.fn.call(event.ctx); }
    setSiblingIndex() {}
}
const cc = { _decorator: { ccclass: () => Type => Type }, Component, Color, Label, BlockInputEvents, Button, UITransform,
    Node, Input: { EventType: { TOUCH_END: 'end' } } };
function load(file, deps) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, console: { warn() {} }, setTimeout, clearTimeout,
        require: name => name === 'cc' ? cc : deps[name] });
    return exports;
}
const screenModule = load('assets/scripts/ui/UIScreen.ts', {});
const { FavoriteGift } = load('assets/scripts/ui/FavoriteGift.ts', {
    './UIScreen': screenModule, '../services/SidebarService': { sidebarDay: () => '2026-11-04' },
});
const scene = JSON.parse(fs.readFileSync('assets/scene/game.scene', 'utf8'));
const lobby = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/LobbyScreen.prefab', 'utf8'));
function authored(graph, index) {
    const data = graph[index], node = new Node(data._name); node.active = data._active;
    for (const ref of data._components) {
        const src = graph[ref.__id__];
        if (src.__type__ === 'cc.Label') node.addComponent(Label).string = src._string;
        if (src.__type__ === 'cc.UITransform') node.addComponent(UITransform);
        if (src.__type__ === 'cc.BlockInputEvents') node.addComponent(BlockInputEvents);
    }
    node.children = data._children.map(ref => { const child = authored(graph, ref.__id__); child.parent = node; return child; });
    return node;
}
function setup({ unsupported = false } = {}) {
    let insideClick = false;
    const calls = [], messages = [], host = { tt: {
        getSystemInfoSync: () => ({ platform: 'android' }), getLaunchOptionsSync: () => ({}),
        showFavoriteGuide(options) { assert.equal(insideClick, true, 'Native API invoked in the button click stack'); calls.push(options); },
    } };
    if (unsupported) delete host.tt.showFavoriteGuide;
    const platformModule = {};
    vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8')), {
        exports: platformModule, globalThis: host, setTimeout, clearTimeout,
        require: name => name === 'cc/env' ? { BYTEDANCE: true, WECHAT: false, HTML5: false }
            : name.includes('Sidebar') ? { SidebarService: class { subscribe() { return () => {}; } matchesEntryToday() { return false; } } }
                : { PlayerInfoService: class {} },
    });
    const platform = new platformModule.PlatformService();
    const root = new Node('Canvas'), home = new Node('Lobby'); home.parent = root;
    const entry = authored(lobby, lobby.findIndex(node => node.__type__ === 'cc.Node' && node._name === 'CollectGame'));
    entry.parent = home; home.children.push(entry); root.children.push(home);
    const modal = authored(scene, scene.findIndex(node => node.__type__ === 'cc.Node' && node._name === 'ADDCollectGame'));
    modal.parent = root; root.children.push(modal);
    const flow = { platform, lobby: { node: home }, toast: text => messages.push(text),
        save: { hasClaimedFavorite: () => false, claimFavorite() { assert.fail('Guide result is not a favorite-entry reward'); } } };
    screenModule.registerGameFlow(flow);
    const gift = new FavoriteGift(); gift.node = root;
    gift.start(); gift.bindLobby(); gift.bindLobby();
    return { gift, entry, modal, calls, messages, home,
        click() { insideClick = true; try { entry.emit('end'); } finally { insideClick = false; } },
        finish(data) { calls.at(-1).success(data); }, fail() { calls.at(-1).fail({ errMsg: 'offline' }); } };
}
const tick = () => new Promise(setImmediate);
(async () => {
    let f = setup();
    assert.equal(f.entry.listeners.get('end').length, 1, 'Repeated lobby binding does not duplicate listeners');
    f.click(); f.click(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].type, 'customize');
    assert.equal(f.modal.active, false, 'Custom teaching does not cover native guide');
    f.finish({ isFavorited: true }); await tick();
    assert.deepEqual(f.messages, ['已收藏游戏']); assert.equal(f.modal.active, false);
    f.click(); f.finish({ isFavorited: false }); await tick();
    assert.equal(f.messages.at(-1), '暂未收藏游戏'); assert.equal(f.modal.active, false, 'Normal cancellation does not open another modal');
    f.click(); f.finish({}); await tick();
    assert.equal(f.messages.at(-1), '收藏引导已打开，请在抖音中确认'); assert.equal(f.modal.active, false, 'Missing state is not reported as not-favorited');
    f.click(); f.fail(); await tick();
    assert.equal(f.messages.at(-1), 'offline'); assert.equal(f.modal.active, true);
    const close = f.gift.findChildDeep(f.modal, 'BtnClose'); close.emit('end'); assert.equal(f.modal.active, false);
    f.gift.onDestroy(); assert.equal(f.entry.listeners.get('end').length, 0);

    f = setup({ unsupported: true }); f.click(); await tick();
    assert.equal(f.calls.length, 0); assert.equal(f.modal.active, true);
    assert.equal(f.messages.at(-1), '当前版本暂不支持此功能'); f.gift.onDestroy();

    f = setup(); f.click(); f.home.active = false; f.gift.update(); f.home.active = true;
    f.fail(); await tick();
    assert.equal(f.messages.length, 0); assert.equal(f.modal.active, false, 'Late callback cannot reopen guide after leaving and returning');
    f.click(); f.gift.onDestroy(); f.fail(); await tick();
    assert.equal(f.modal.active, false); assert.equal(f.messages.length, 0, 'Destroyed component ignores callback');
    console.log('PASS favorite guide: authored entry to synchronous native API, duplicate tap guard, favorite/cancel/unknown state, failure fallback, original close buttons, stale callbacks and no return reward from guide results');
})().catch(error => { console.error(error); process.exitCode = 1; });
