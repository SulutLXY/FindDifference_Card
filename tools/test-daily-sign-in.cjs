const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const config = JSON.parse(fs.readFileSync('assets/resources/configs/daily-sign-in.json', 'utf8'));
const store = new Map(); let fail = false, now = Date.parse('2026-11-02T12:00:00+08:00');
class Clock extends Date { static now() { return now; } }
const daily = {}, saveModule = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/core/DailySignIn.ts', 'utf8')), { exports: daily, Date: Clock });
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: saveModule, Date: Clock, console: { warn() {} }, require: name => name.includes('DailySignIn') ? daily : { sys: { localStorage: {
        getItem: key => store.get(key), setItem(key, value) { if (fail) throw Error('disk'); store.set(key, value); },
    } } },
});
const { SaveService } = saveModule;
const day = () => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
let save = new SaveService();
assert.deepEqual(config.days.map(r => `${r.kind}:${r.amount}`), ['hint:1','energy:1','hint:1','energy:1','hint:1','energy:2','hint:3']);
assert.equal(save.dailyStatus(day(), config).dayIndex, 1);
assert.equal(save.markDailyPrompt(day(), config), true); assert.equal(save.markDailyPrompt(day(), config), false);
assert.equal(save.dailyStatus(day(), config).canClaim, true, 'Prompting never claims rewards');
let expectedHints = 2, expectedEnergy = 15;
for (let i = 0; i < 7; i++) {
    if (i) now += 86400000;
    const multiplier = [1,2,2,1,1,2,2][i];
    const state = save.dailyStatus(day(), config); assert.equal(state.dayIndex, i + 1);
    assert.equal(save.claimDailySignIn(day(), config, multiplier, i + 1), true);
    if (config.days[i].kind === 'hint') expectedHints += config.days[i].amount * multiplier;
    else expectedEnergy += config.days[i].amount * multiplier;
    assert.equal(save.freeHints, expectedHints); assert.equal(save.energy, expectedEnergy);
    assert.equal(save.claimDailySignIn(day(), config, 2, i + 1), false, 'No normal/double double-dip');
    save = new SaveService(); assert.equal(save.dailyStatus(day(), config).claimed, true);
}
now += 86400000; assert.equal(save.dailyStatus(day(), config).dayIndex, 1, 'New seven-day cycle');
assert.equal(save.claimDailySignIn(day(), config, 1, 1), true);
now += 2 * 86400000; assert.equal(save.dailyStatus(day(), config).dayIndex, 1, 'Missed day resets');
assert.equal(save.claimDailySignIn(day(), config, 1, 2), false, 'Stale day index cannot claim');
assert.equal(save.claimDailySignIn(day(), config, 1, 1), true);
now -= 86400000; assert.equal(save.dailyStatus(day(), config).canClaim, false, 'Clock rollback cannot claim again');
now += 2 * 86400000;
const before = JSON.stringify(save.data); fail = true;
assert.equal(save.markDailyPrompt(day(), config), false); assert.equal(JSON.stringify(save.data), before);
assert.equal(save.claimDailySignIn(day(), config, 2, 2), false); assert.equal(JSON.stringify(save.data), before);
fail = false;
assert.throws(() => save.dailyStatus('2026-02-30', config));
assert.throws(() => save.dailyStatus(day(), { days: [] }));
store.clear(); now = Date.parse('2026-11-03T12:00:00+08:00');
store.set('find-difference.save.v3', JSON.stringify({ energy: 99, dailySignIn: { lastClaimDay: '2026-11-02', dayIndex: 1 } }));
save = new SaveService(); assert.equal(save.claimDailySignIn(day(), config, 2, 2), false);
assert.equal(save.dailyStatus(day(), config).canClaim, true, 'Full storage does not consume sign-in');
save.consumeEnergy(); assert.equal(save.claimDailySignIn(day(), config, 2, 2), true); assert.equal(save.energy, 99);

store.clear(); store.set('find-difference.save.v3',JSON.stringify({freeHints:98}));
save=new SaveService();fail=true;
assert.equal(save.claimDailySignIn(day(),config,2,1),false);assert.equal(save.freeHints,98);
assert.equal(save.dailyStatus(day(),config).canClaim,true);
fail=false;assert.equal(save.claimDailySignIn(day(),config,2,1),true);
assert.equal(save.freeHints,99,'Double sign-in reward saturates at 99');
save=new SaveService();assert.equal(save.freeHints,99);assert.equal(save.dailyStatus(day(),config).claimed,true);

function methods(file, names, globals = {}) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test {${body}};Test;`), { console: { warn() {} }, ...globals });
}
(async () => {
    store.clear(); now = Date.parse('2026-11-02T23:59:00+08:00'); save = new SaveService();
    const Flow = methods('assets/scripts/GameFlow.ts', ['requestReward']);
    const Modal = methods('assets/scripts/ui/DailySignInModal.ts', ['_claim'], { sidebarDay: day });
    const flow = new Flow(), modal = new Modal(); flow.save = save; flow._isPaused = true;
    let finish, reject, ads = 0;
    flow.toast = () => {}; flow.platform = { showRewardedAd(placement) {
        assert.equal(placement, 'daily-sign-in'); ads++;
        return new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    } };
    modal.flow = flow; modal._config = config; modal.node = { activeInHierarchy: true }; modal.isValid = true; modal._refresh = () => {};
    let pending = modal._claim(true); await modal._claim(false); await modal._claim(true); assert.equal(ads, 1);
    assert.equal(save.freeHints, 2); finish({ success: true, completed: false }); await pending;
    assert.equal(save.dailyStatus(day(), config).canClaim, true); assert.equal(flow._isPaused, true);
    pending = modal._claim(true); reject(Error('offline')); await pending; assert.equal(save.freeHints, 2);
    pending = modal._claim(true); now += 120000; finish({ success: true, completed: true }); await pending;
    assert.equal(save.freeHints, 2); assert.equal(save.dailyStatus(day(), config).canClaim, true, 'Midnight ad cannot consume next-day reward');
    pending = modal._claim(true); finish({ success: true, completed: true }); await pending;
    assert.equal(save.freeHints, 4); assert.equal(save.dailyStatus(day(), config).claimed, true);
    await modal._claim(false); assert.equal(save.freeHints, 4);
    // Authoring checks: dedicated prefab, seven individually editable cells, owner links and all explicit buttons.
    const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/DailySignInModal.prefab', 'utf8'));
    assert.equal(prefab.filter(n => /^Day[1-7]$/.test(n._name) && n.__type__ === 'cc.Node').length, 7);
    for (const name of ['ResultCard','BtnNormal','BtnDouble','BtnClose']) assert.ok(prefab.some(n => n._name === name && n.__type__ === 'cc.Node'));
    prefab.forEach((node, i) => { if (node.__type__ === 'cc.Node') for (const component of node._components) assert.equal(prefab[component.__id__].node.__id__, i); });
    const entryPrefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/DailySignInEntry.prefab', 'utf8'));
    assert.ok(['DailySignInEntry', 'BtnDailySignIn'].includes(entryPrefab[entryPrefab[0].data.__id__]._name));
    entryPrefab.forEach((node, i) => { if (node.__type__ === 'cc.Node') for (const component of node._components) assert.equal(entryPrefab[component.__id__].node.__id__, i); });
    // Reuse the authored SevenDay button without generating a second entry or changing its design.
    const home = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/LobbyScreen.prefab', 'utf8'));
    const homeBinding = home.find(node => 'btnDailySignIn' in node);
    assert.ok(homeBinding?.btnDailySignIn);
    const homeNodes = new Map();
    function homeNode(index) {
        const src = home[index];
        const node = { name: src._name, isValid: true, position: src._lpos, children: [], handlers: new Map(),
            getChildByName(name) { return this.children.find(child => child.name === name); },
            off(type) { this.handlers.delete(type); }, on(type, fn) { this.handlers.set(type, fn); } };
        homeNodes.set(index, node);
        node.children = (src._children ?? []).map(child => homeNode(child.__id__));
        return node;
    }
    const Lobby = methods('assets/scripts/ui/LobbyScreen.ts', ['_findDailyEntry', '_attachDailyEntry', '_refreshDailyEntry'],
        { Node: { EventType: { TOUCH_END: 'touch-end' } } });
    const lobby = new Lobby(); lobby.node = homeNode(home[0].data.__id__);
    const entry = homeNodes.get(homeBinding.btnDailySignIn.__id__);
    assert.equal(entry.name, 'SevenDay');
    lobby.btnDailySignIn = entry;
    lobby.findChildDeep = function find(root, name) {
        for (const child of root.children) { if (child.name === name) return child; const found = find(child, name); if (found) return found; }
        return null;
    };
    lobby.buttonTouchHandler = (_, action) => action;
    let opened = 0;
    lobby.flow = { openDailySignIn: () => opened++, promptDailySignIn() {}, dailySignInAvailable: true,
        loadLobbyPrefab() { assert.fail('Designed entry must never request an extra prefab'); } };
    const entryCount = homeNodes.size, position = JSON.stringify(entry.position);
    for (let i = 0; i < 3; i++) lobby._attachDailyEntry();
    assert.equal(homeNodes.size, entryCount); assert.equal(entry.handlers.size, 1);
    entry.handlers.get('touch-end')(); assert.equal(opened, 1, 'Repeated lobby opens bind exactly one click');
    assert.equal(entry.name, 'SevenDay'); assert.equal(JSON.stringify(entry.position), position);
    lobby.btnDailySignIn = null; assert.equal(lobby._findDailyEntry(), entry, 'Unbound entry uses SevenDay lookup');
    lobby.node = { children: [] }; lobby._attachDailyEntry();
    assert.equal(lobby.node.children.length, 0, 'Missing authored button does not generate a fallback');
    // Startup enters gameplay without requesting a lobby or sign-in. Sign-in runs when the lobby opens.
    store.clear(); now = Date.parse('2026-12-02T12:00:00+08:00');
    let close, starts = 0;
    const Boot = methods('assets/scripts/GameFlow.ts', ['_bootstrap', 'openDailySignIn'], { sidebarDay: day,
        AudioClip: class {}, resources: { load: (_, Type, done) => done(null, {}) } });
    const boot = new Boot(); boot.save = new SaveService(); boot.isValid = true;
    boot.platform = { configure() {} }; boot._musicClips = new Map(); boot._comboClips = new Map();
    boot._setLoadingProgress = () => {}; boot.showLobby = () => { boot.lobby = { node: { activeInHierarchy: true } }; };
    boot._ensureDailySignIn = async () => ({ present: () => new Promise(resolve => { close = resolve; }) });
    boot._returnToLobbyOnLoadError = message => { throw Error(message); };
    boot._loadJson = async path => ({ json: path === 'configs/daily-sign-in' ? config : path === 'configs/cities' ? { cities: [], chapters: {} }
        : path === 'configs/food-catalog' ? { foods: [] } : path === 'configs/chapter-rules' ? { version: 2, legacyOrders: [[]] } : {} });
    boot.startContinue = async () => { starts++; boot.save.consumeEnergy(); };
    const starting = boot._bootstrap(); await new Promise(setImmediate);
    await starting; assert.equal(starts, 1); assert.equal(boot.save.energy, 14); assert.equal(close, undefined);
    boot.lobby = { node: { activeInHierarchy: true } };
    const prompt = boot.openDailySignIn(true); await new Promise(setImmediate); assert.ok(close);
    assert.equal(boot.save.dailyStatus(day(), config).canClaim, true, 'Opening does not claim');
    close(); await prompt; assert.equal(starts, 1); assert.equal(boot.save.energy, 14);
    assert.equal(await boot.openDailySignIn(true), false, 'Same-day relaunch prompt is suppressed after close');
    console.log('PASS: seven-day rewards, missed-day reset/cycle, Beijing midnight, one claim, rollback, energy cap, normal/double exclusivity, ad cancel/error/stale-day and editable prefab references.');
})().catch(error => { console.error(error); process.exitCode = 1; });
