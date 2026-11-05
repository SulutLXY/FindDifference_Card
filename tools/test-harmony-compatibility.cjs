const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
} }).outputText;
function load(file, deps = {}, globals = {}) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, setTimeout, clearTimeout,
        console: { info() {}, warn() {}, error() {} }, require: name => deps[name] || {}, ...globals });
    return exports;
}
const players = load('assets/scripts/services/PlayerInfoService.ts');
const sidebarModule = load('assets/scripts/services/SidebarService.ts');
function setup({ info = { platform: 'openHarmony' }, syncError = false, asyncInfo, canIUse } = {}) {
    const forbidden = [], systems = [], calls = { login: 0, share: 0, feed: 0, status: 0, favorite: 0, desktop: 0, jump: 0, reward: 0, interstitial: 0 };
    const events = new Set(); let rewardClose, interstitialClose;
    const tt = {
        getSystemInfoSync() { if (syncError) throw Error('sync unavailable'); return info; },
        getSystemInfo(options) { systems.push(options); if (asyncInfo) options.success(asyncInfo); },
        getLaunchOptionsSync: () => ({}), onShow: fn => events.add(fn), offShow: fn => events.delete(fn),
        checkScene: options => options.success({ isExist: true }),
        navigateToScene(options) { calls.jump++; assert.equal(options.scene, 'sidebar'); options.success({}); },
        login(options) { calls.login++; options.success({ code: 'ticket' }); options.complete?.(); },
        shareAppMessage() { calls.share++; },
        requestFeedSubscribe(options) { calls.feed++; options.success({ success: true }); },
        checkFeedSubscribeStatus(options) { calls.status++; options.success({ status: false }); },
        setImRankData() { forbidden.push('setImRankData'); }, getImRankList() { forbidden.push('getImRankList'); },
        showFavoriteGuide(options) { calls.favorite++; options.success({ isFavorited: true }); },
        addShortcut(options) { calls.desktop++; options.success({}); },
        createRewardedVideoAd() {
            calls.reward++;
            return { onClose(fn) { rewardClose = fn; }, onError() {}, offClose() {}, offError() {}, load: async () => {}, show: async () => {} };
        },
        createInterstitialAd() {
            calls.interstitial++;
            return { onClose(fn) { interstitialClose = fn; }, onError() {}, offClose() {}, offError() {}, destroy() {}, load: async () => {}, show: async () => {} };
        },
    };
    if (canIUse) tt.canIUse = canIUse;
    const platformModule = load('assets/scripts/services/PlatformService.ts', {
        'cc/env': { BYTEDANCE: true, WECHAT: false, HTML5: false },
        './PlayerInfoService': players, './SidebarService': sidebarModule,
    }, { globalThis: { tt } });
    const platform = new platformModule.PlatformService();
    platform.configure({ douyinRewardedAdUnitId: 'reward', douyinInterstitialAdUnitId: 'interstitial' });
    return { platform, tt, calls, forbidden, systems, events,
        rewardClose: value => rewardClose(value), interstitialClose: () => interstitialClose() };
}
class Node {
    constructor(name, children = []) {
        this.name = name; this.children = children; this.active = true; this.isValid = true; this.parts = new Map(); this.handlers = [];
        for (const child of children) child.parent = this;
    }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    getChildByName(name) { return this.children.find(child => child.name === name); }
    getComponent(Type) { return this.parts.get(Type); }
    getComponentInChildren(Type) { return this.getComponent(Type) || this.children.map(n => n.getComponentInChildren(Type)).find(Boolean); }
    on(type, fn, owner) { this.handlers.push({ fn, owner }); }
    off(type, fn) { this.handlers = this.handlers.filter(handler => handler.fn !== fn); }
}
class UIScreen {
    isValid = true;
    findChildDeep(root, name) { return root.getChildByName(name) || root.children.map(child => this.findChildDeep(child, name)).find(Boolean); }
    buttonTouchHandler(node, fn) { return fn; }
    resolveNode(bound, name) { return bound || this.findChildDeep(this.node, name); }
    resolveLabel() { return null; } setLabel() {}
    open() { this.node.active = true; } onDisable() {} onDestroy() {}
}
const cc = { _decorator: { ccclass: () => Type => Type, property: () => () => {} }, Node, Color: class {},
    Input: { EventType: { TOUCH_END: 'end' } } };
const { LobbyEntries } = load('assets/scripts/ui/LobbyEntries.ts', { cc, './UIScreen': { UIScreen } });
const { ResultModal } = load('assets/scripts/ui/ResultModal.ts', { cc, './UIScreen': { UIScreen, UIColors: { red: 'red' } }, './LobbyEntries': { LobbyEntries } });
function entriesFor(platform) {
    const live = new Node('LiveStreamingCompanion'); live.active = false;
    const home = new Node('Lobby', [new Node('Subscription'), new Node('Shar'), live]);
    const settings = new Node('Settings', [new Node('moneyTool', [new Node('Subscription'), new Node('AddDesktop')])]);
    const result = new Node('Result', [new Node('moneyTool', [new Node('Subscription'), new Node('AddDesktop')])]);
    const root = new Node('Canvas', [home, settings, result]);
    const entries = new LobbyEntries(); entries.node = root;
    entries.flow = { lobby: { node: home }, platform, toast() {} };
    entries.bindLobby(); entries.bindRewardEntries(settings); entries.bindRewardEntries(result);
    return { entries, home, settings, result, live, root };
}
function resultFor(platform) {
    const share = new Node('BtnShare'), modal = new ResultModal(); modal.node = new Node('Result', [share]);
    modal.flow = { node: { parent: null }, platform };
    return { modal, share };
}
function flowMethods(names) {
    const tree = ts.createSourceFile('Flow.ts', fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const text = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Flow { ${text} }; Flow;`));
}
const tick = () => new Promise(setImmediate);
(async () => {
    for (const info of [{ platform: 'openHarmony' }, { platform: 'devtools', system: 'OpenHarmony 5.0.1' }]) {
        const f = setup({ info }), p = f.platform;
        assert.equal(p.isHarmony, true); assert.equal(p.supportsSharing, false);
        p.prepareFeedLogin(); assert.equal(await p.subscribeFeed(), '鸿蒙系统暂不支持订阅功能');
        assert.equal(await p.checkFeedStatus(), '当前系统暂不支持订阅功能'); assert.equal(p.share('level'), false);
        assert.equal(await p._entryCall('requestFeedSubscribe', {}, () => ''), '当前系统暂不支持订阅功能');
        assert.equal(f.calls.login + f.calls.share + f.calls.feed + f.calls.status, 0, 'Never call unsupported APIs even when SDK methods exist');
        const ui = entriesFor(p); await tick();
        assert.equal(ui.home.getChildByName('Shar').active, false); assert.equal(ui.home.getChildByName('Subscription').active, false);
        for (const root of [ui.settings, ui.result]) {
            assert.equal(root.getChildByName('moneyTool').getChildByName('Subscription').active, false);
            assert.equal(root.getChildByName('moneyTool').getChildByName('AddDesktop').active, true);
        }
        await ui.entries._openSubscription(); ui.entries._requestSubscription();
        ui.entries._nativeTouchEnd({ changedTouches: [{ clientX: 1, clientY: 1 }] });
        assert.equal(f.calls.feed + f.calls.status, 0);
        const result = resultFor(p); result.modal.present({ win: true, stars: 3 }); await tick();
        assert.equal(result.share.active, false, 'Harmony victory has no share action');
        const Rank = load('assets/scripts/services/rank/DouyinRankProvider.ts', {}, { globalThis: { tt: f.tt } }).DouyinRankProvider;
        const rank = new Rank(p, { totalScore: 3 });
        assert.equal((await rank.openNative()).success, false); rank.submitScore(3, 1, 5); await tick();
        assert.equal(f.forbidden.length, 0); assert.equal(f.calls.login, 0);
        const Flow = flowMethods(['_openingNativeRank', '_showNativeRank', 'share']);
        const flow = new Flow(), toasts = []; Object.assign(flow, { platform: p, toast: text => toasts.push(text), _cancelSecondaryNavigation() {} });
        await flow._showNativeRank(); flow.share();
        assert.equal(f.calls.interstitial, 0, 'Unsupported native ranking does not open an ad first');
        assert.equal(toasts.at(-1), '鸿蒙系统暂不支持分享');
    }

    // Async identification is shared and keeps restricted controls hidden before the response.
    let f = setup({ syncError: true }), p = f.platform;
    const ui = entriesFor(p), result = resultFor(p);
    result.modal.present({ win: true, stars: 1 });
    assert.equal(ui.home.getChildByName('Shar').active, false); assert.equal(result.share.active, false);
    p.prepareFeedLogin(); assert.equal(p.share('level'), false); await p.subscribeFeed();
    const status = p.checkFeedStatus();
    assert.equal(f.systems.length, 1, 'Concurrent callers merge system info lookup');
    f.systems[0].success({ platform: 'devtools', system: 'OpenHarmony 5.1' });
    await status; await tick();
    assert.equal(p.isHarmony, true); assert.equal(ui.home.getChildByName('Shar').active, false);
    assert.equal(f.calls.login + f.calls.share + f.calls.feed + f.calls.status, 0);

    f = setup({ syncError: true }); p = f.platform;
    const normalUi = entriesFor(p), normalResult = resultFor(p);
    normalResult.modal.present({ win: true, stars: 1 }); normalResult.modal.present({ win: false, stars: 0 });
    f.systems[0].success({ platform: 'android' }); await tick();
    assert.equal(normalUi.home.getChildByName('Shar').active, true, 'Android restores designed social entries after detection');
    assert.equal(normalUi.live.active, false, 'Never reactivate artist-hidden entries');
    assert.equal(normalResult.share.active, false, 'Late OS response cannot restore sharing on a failed result');
    normalResult.modal.present({ win: true, stars: 1 }); await tick(); assert.equal(normalResult.share.active, true);
    p.prepareFeedLogin(); assert.equal(await p.subscribeFeed(), '订阅成功'); assert.equal(await p.checkFeedStatus(), null);
    assert.equal(p.share('level'), true); assert.equal(f.calls.feed, 1); assert.equal(f.calls.share, 1);
    assert.equal(await p.favoriteGame(), '已收藏游戏'); assert.match(await p.addDesktop(), /请求已完成/);

    // Harmony keeps supported ad, sidebar, desktop and favorite capabilities.
    f = setup(); p = f.platform;
    const reward = p.showRewardedAd('hint'); await tick(); f.rewardClose({ isEnded: true });
    assert.equal((await reward).completed, true);
    const cancelled = p.showRewardedAd('hint'); await tick(); f.rewardClose({ isEnded: false });
    assert.equal((await cancelled).completed, false);
    const interstitial = p.showInterstitial(() => true, true, true); await tick(); f.interstitialClose(); await interstitial;
    assert.equal(f.calls.reward, 2); assert.equal(f.calls.interstitial, 1);
    assert.equal(await p.favoriteGame(), '已收藏游戏'); await p.addDesktop();
    await p.sidebar.start(); assert.equal(p.sidebar.supported, true); await p.sidebar.navigate();
    assert.equal(p.sidebar.fromSidebarToday, false);
    for (const event of f.events) event({ launch_from: 'homepage', location: 'sidebar_card' });
    assert.equal(p.sidebar.fromSidebarToday, true); p.sidebar.dispose();
    assert.equal(f.calls.favorite, 1); assert.equal(f.calls.desktop, 1); assert.equal(f.calls.jump, 1);

    f = setup({ canIUse: () => false }); p = f.platform;
    assert.equal((await p.showRewardedAd('hint')).completed, false);
    await p.showInterstitial(() => true, true, true); await p.favoriteGame(); await p.addDesktop();
    assert.equal(f.calls.reward + f.calls.interstitial + f.calls.favorite + f.calls.desktop, 0, 'Unavailable capabilities never invoke SDK stubs');
    console.log('PASS Harmony: platform/system/async identification, conservative unknown state, all-page social hiding, share/feed/rank guards, stale results, Android restoration and supported ad/sidebar/favorite/desktop capability paths');
})().catch(error => { console.error(error); process.exitCode = 1; });
