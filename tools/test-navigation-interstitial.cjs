const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const logs = [], ads = [];
const config = JSON.parse(fs.readFileSync('assets/resources/configs/platform-config.json', 'utf8'));
const host = { tt: {
    getSystemInfoSync: () => ({ platform: 'android' }),
    createInterstitialAd(options) {
        assert.equal(options.adUnitId, config.douyinInterstitialAdUnitId);
        const ad = { onClose(fn) { this.close = fn; }, onError(fn) { this.fail = fn; }, offClose() {}, offError() {},
            load: async () => {}, show: async () => { ad.shown = true; }, destroy() { this.destroyed = true; } };
        ads.push(ad);
        return ad;
    },
} };
const platformExports = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/PlatformService.ts', 'utf8')), {
    exports: platformExports, globalThis: host, setTimeout, clearTimeout,
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    require: name => name === 'cc/env' ? { BYTEDANCE: true } : name.includes('Sidebar')
        ? { SidebarService: class {} } : { PlayerInfoService: class {} },
});
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['showLobby', 'returnToLobby', 'showCitySelect', 'enterLevelSelection', 'requestLevelSelectAccess',
    'requestReward', '_switchTo', '_cancelSecondaryNavigation'];
const methods = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
    .map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow { ${methods} }; Flow;`), { console });
function setup(access = true) {
    const flow = new Flow();
    flow.isValid = true;
    flow._secondaryNavigationVersion = flow._levelLoadVersion = flow._comboSoundRequest = 0;
    flow.platform = new platformExports.PlatformService();
    flow.platform.configure(config);
    flow.platform.canShowInterstitial = () => false; // Reproduce protected first round.
    flow.platform._lastInterstitialAttempt = Date.now(); // Navigation must bypass an active local cooldown.
    const screen = active => ({ node: { activeInHierarchy: active }, preloadHero() {},
        open() { this.node.activeInHierarchy = true; }, close() { this.node.activeInHierarchy = false; } });
    flow.lobby = screen(false);
    flow.citySelect = screen(false);
    flow.game = screen(true);
    flow.save = { hasLevelSelectAccess: () => access, grantLevelSelectAccess: () => access = true };
    flow._playPageMusic = () => {};
    flow._stopResultTone = () => {};
    flow.toast = () => {};
    return flow;
}
function bindScreen(screenName, flow) {
    const file = `assets/scripts/ui/${screenName}.ts`;
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(ts.isClassDeclaration);
    const load = cls.members.find(m => m.name?.getText(ast) === 'onLoad');
    // Execute the actual onLoad bindings and the chosen callback against the real flow/platform.
    const Screen = vm.runInNewContext(compile(`class Screen { ${load.getText(ast)} }; Screen;`), {
        EnergyDisplay: { attach() {} }, BlockInputEvents: class {}, Toggle: class {},
        Animation: class {}, Sprite: class {}, LobbyEntries: class {}, FavoriteGift: class {},
    });
    const callbacks = new Map();
    const screen = new Screen();
    Object.assign(screen, { flow, node: { children: [], getComponent: () => ({}), getChildByName: () => null },
        wireButton: (_, name, callback) => callbacks.set(name, callback), resolveNode: () => null,
        _ensureCloseButton() {}, _ensureBackButton() {}, _ensureList() {}, _setupScrollContainer() {} });
    screen.onLoad();
    return callbacks;
}
async function assertHomeClick(screenName, buttonName) {
    const flow = setup();
    const callbacks = bindScreen(screenName, flow);
    assert.ok(callbacks.has(buttonName), `${screenName}/${buttonName} must be bound`);
    const before = ads.length;
    callbacks.get(buttonName)();
    await tick();
    assert.equal(flow.lobby.node.activeInHierarchy, true);
    assert.equal(ads.length, before + 1, `${screenName}/${buttonName} must request native interstitial`);
    assert.equal(ads.at(-1).shown, true, 'First-round protection and local cooldown cannot drop return-home ads');
    ads.at(-1).close();
    await tick();
    assert.equal(flow._returnAdPending, false);
}
(async () => {
    for (const [screen, button] of [['SettingsModal', 'BtnHome'], ['ResultModal', 'BtnHome'],
        ['ResultModal', 'BtnClose'], ['CitySelectScreen', 'BtnBack'], ['CollectScreen', 'BtnBack'], ['RankScreen', 'BtnBack']]) {
        await assertHomeClick(screen, button);
    }
    const f = setup();
    f.showLobby();
    f.node = { parent: { getComponent: () => ({}) } };
    const lobbyCallbacks = bindScreen('LobbyScreen', f);
    assert.ok(lobbyCallbacks.has('BtnLevels'));
    lobbyCallbacks.get('BtnLevels')();
    await tick();
    assert.equal(f.citySelect.node.activeInHierarchy, true, 'Details page opens before native ad closes');
    assert.equal(f.lobby.node.activeInHierarchy, false);
    assert.equal(ads.at(-1).shown, true);
    await f.enterLevelSelection();
    ads.at(-1).close();
    await tick();
    assert.equal(f._levelSelectEntryPending, false);
    // A native frequency rejection must preserve the destination and release all busy flags.
    f.returnToLobby();
    await tick();
    ads.at(-1).fail({ errCode: 2002, errMsg: 'frequency limit' });
    await tick();
    assert.equal(f.lobby.node.activeInHierarchy, true);
    assert.equal(f.platform.interstitialBusy, false);
    assert.equal(f._returnAdPending, false);
    assert.ok(logs.some(([message, context]) => message.includes('未展示') && context.placement === 'return-home'
        && context.errCode === 2002 && context.errMsg === 'frequency limit'));
    // Reward close and first entry use the same real platform busy-state cleanup.
    let finishReward;
    host.tt.createRewardedVideoAd = () => ({ onClose(fn) { finishReward = fn; }, onError() {}, offClose() {}, offError() {}, show: async () => {} });
    const first = setup(false);
    first.showLobby();
    const count = ads.length;
    const unlocking = first.enterLevelSelection();
    await first.enterLevelSelection();
    assert.equal(ads.length, count);
    finishReward({ isEnded: true });
    await tick();
    assert.equal(first.citySelect.node.activeInHierarchy, true);
    assert.equal(ads.length, count + 1, 'Newly unlocked entry also reaches native SDK');
    ads.at(-1).close();
    await unlocking;
    // Cancel a pending load by leaving the page; its late completion cannot display.
    let loaded;
    const create = host.tt.createInterstitialAd;
    host.tt.createInterstitialAd = options => {
        const ad = create(options); ad.load = () => new Promise(resolve => loaded = resolve); return ad;
    };
    f.showLobby();
    const stale = f.enterLevelSelection();
    f.showLobby();
    loaded(); await stale;
    assert.equal(ads.at(-1).shown, undefined);
    assert.equal(ads.at(-1).destroyed, undefined, 'Cancelled unshown ads remain reusable on native SDK');
    assert.equal(f._levelSelectEntryPending, false);
    assert.ok(logs.some(([message, context]) => message.includes('跳过') && context.reason.includes('页面')));
    // The authored icon is editable in Creator and lies inside the button, left of its label.
    const scene = JSON.parse(fs.readFileSync('assets/scene/game.scene', 'utf8'));
    const button = scene.find(item => item._name === 'BtnLevels');
    const child = name => button._children.map(ref => scene[ref.__id__]).find(item => item._name === name);
    const icon = child('icon_videoplay'), label = child('Label');
    assert.equal(icon._active, true);
    const ui = node => node._components.map(ref => scene[ref.__id__]).find(c => c.__type__ === 'cc.UITransform');
    const sprite = icon._components.map(ref => scene[ref.__id__]).find(c => c.__type__ === 'cc.Sprite');
    assert.equal(sprite._spriteFrame.__uuid__, '645554eb-c26d-4151-bfb6-22acd54e7700@f9941');
    assert.ok(icon._lpos.x < label._lpos.x, 'Video icon stays left of the label; preserve editor-authored text placement');
    assert.ok(icon._lpos.x - ui(icon)._contentSize.width / 2 >= -ui(button)._contentSize.width / 2);
    function validate(value) {
        if (!value || typeof value !== 'object') return;
        if ('__id__' in value) assert.ok(scene[value.__id__], `Missing scene reference ${value.__id__}`);
        Object.values(value).forEach(validate);
    }
    validate(scene);
    console.log('PASS: actual home button bindings, native SDK on protected return/entry, first reward entry, frequency rejection diagnostics, stale load cancellation, editable left video icon.');
})().catch(error => { console.error(error); process.exitCode = 1; });
