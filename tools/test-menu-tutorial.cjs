const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, {compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
}}).outputText;
const tick = () => new Promise(setImmediate);
const silent = {info() {}, warn() {}};
let raw = null, failWrite = false;
function load(file, require = () => ({})) {
    const exports = {};
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), {exports, require, console: silent});
    return exports;
}
const dailySignIn = load('assets/scripts/core/DailySignIn.ts');
const {SaveService} = load('assets/scripts/services/SaveService.ts', name => name.endsWith('/DailySignIn') ? dailySignIn : ({sys: {localStorage: {
    getItem: () => raw, setItem(_, text) {if (failWrite) throw Error('full'); raw = text;},
}}}));
const {MenuTutorialService} = load('assets/scripts/services/MenuTutorialService.ts');
function extract(file, names, globals = {}) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
        .map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Subject {${body}};Subject;`), {console: silent, ...globals});
}
function fixture(existing = false) {
    if (!existing) raw = null;
    const save = new SaveService(), calls = [], notices = [];
    const state = {page: 'other', busy: false, obtained: false, ready: true, overlay: null};
    const node = {isValid: true, activeInHierarchy: true};
    let service;
    const host = {
        page: () => state.page, blocked: () => state.busy,
        state: kind => save.data.menuTutorials?.[kind], save: (kind, step) => save.setMenuTutorialStep(kind, step),
        hasCollectible: () => state.obtained,
        target: (kind, step) => !state.ready ? null : {node, activate: async () => {
            calls.push(`${kind}:${step}`);
            service.onPageChanged();
            state.page = step === 'entry' ? kind : 'other';
            return true;
        }},
        show: (node, message, done) => {state.overlay = {node, message, done}; return true;},
        dismiss: () => {state.overlay = null;}, notify: text => notices.push(text),
    };
    service = new MenuTutorialService(host);
    return {service, save, state, host, node, calls, notices,
        home() {service.armHomeReturn(); service.onPageChanged(); state.page = 'lobby'; service.onReturnedHome();},
        update() {service.update(.2);},
        async hit() {assert.ok(state.overlay); state.overlay.done(true); await tick();},
    };
}
(async () => {
    let f = fixture();
    f.state.page = 'lobby'; f.update(); assert.equal(f.state.overlay, null, 'Startup/error home does not start the guide');
    f.service.armHomeReturn(); assert.equal(f.service.hasPending, true, 'Arming precedes home onOpen/sign-in');
    f.home(); assert.equal(f.save.data.menuTutorials.chapters, 'entry');
    assert.equal(f.save.data.menuTutorials.collection, undefined, 'No collection guide before acquiring a collectible');
    f.state.busy = true; f.update(); assert.equal(f.state.overlay, null, 'Wait for ads/loading/daily modal');
    f.state.busy = false; f.update(); assert.match(f.state.overlay.message, /选择关卡/);
    await f.hit(); assert.equal(f.save.data.menuTutorials.chapters, 'target');
    f.state.page = 'chapters'; f.update(); assert.match(f.state.overlay.message, /第二个专题/);
    await f.hit(); assert.equal(f.save.data.menuTutorials.chapters, 'done');
    f.home(); f.update(); assert.equal(f.state.overlay, null, 'Completed chapter guide never repeats');
    f.state.obtained = true; f.home(); f.update(); assert.match(f.state.overlay.message, /收藏册/);
    await f.hit(); f.state.page = 'collection';
    f.state.ready = false; f.update(); assert.equal(f.state.overlay, null, 'Wait until the actual target is ready');
    f.state.ready = true; f.update(); assert.match(f.state.overlay.message, /第一件收藏/);
    await f.hit(); assert.equal(f.save.data.menuTutorials.collection, 'done');
    const finished = JSON.stringify(f.save.data.menuTutorials);
    f.service.dispose(); f = fixture(true); f.state.obtained = true; f.home(); f.update();
    assert.equal(JSON.stringify(f.save.data.menuTutorials), finished); assert.equal(f.state.overlay, null);

    f = fixture(); f.state.obtained = true; f.home(); f.update();
    assert.match(f.state.overlay.message, /选择关卡/, 'Both eligible: chapter guide has priority');
    await f.hit(); f.state.page = 'chapters'; f.update(); await f.hit();
    f.update(); assert.equal(f.state.overlay, null, 'Do not navigate back automatically');
    f.home(); f.update(); assert.match(f.state.overlay.message, /收藏册/, 'Collection is kept for next home visit');
    const stale = f.state.overlay.done; f.service.onPageChanged(); f.state.page = 'other'; stale(true); await tick();
    assert.deepEqual(f.calls, ['chapters:entry', 'chapters:target'], 'Stale overlay cannot act');

    f = fixture(); f.home(); f.update(); await f.hit(); f.service.dispose();
    f = fixture(true); f.state.page = 'lobby'; f.update();
    assert.equal(f.save.data.menuTutorials.chapters, 'entry', 'Restart at home resumes an interrupted destination step');
    assert.match(f.state.overlay.message, /选择关卡/);
    f.state.overlay.done(false); f.home(); f.update(); assert.equal(f.state.overlay, null, 'Skip persists once');

    f = fixture(); f.home(); f.update();
    const before = JSON.stringify(f.save.data); failWrite = true; await f.hit(); failWrite = false;
    assert.equal(JSON.stringify(f.save.data), before); assert.equal(f.calls.length, 0, 'Failed checkpoint cannot navigate');
    assert.equal(f.notices.length, 1);
    f.update(); const destroyedCallback = f.state.overlay.done; f.node.isValid = false; f.update();
    destroyedCallback(true); await tick(); assert.equal(f.calls.length, 0, 'Destroyed target cannot activate');
    f.node.isValid = true; f.update(); f.state.overlay.done(true); f.service.dispose(); await tick();
    assert.equal(f.calls.length, 0, 'Dispose between tap and async action cannot navigate');

    f = fixture(); f.home(); f.update(); f.state.overlay.done(true); f.state.busy = true; await tick();
    assert.equal(f.calls.length, 0, 'An ad starting between tap and async action blocks navigation');

    f = fixture(); f.home(); f.update(); await f.hit(); f.state.page = 'chapters';
    f.host.target = () => ({node: f.node, activate: async () => false});
    f.update(); await f.hit(); assert.equal(f.save.data.menuTutorials.chapters, 'target', 'Failed destination does not complete');
    f.host.target = () => ({node: f.node, activate: async () => {throw Error('offline');}});
    f.update(); await f.hit(); assert.equal(f.save.data.menuTutorials.chapters, 'target');
    assert.equal(f.save.setMenuTutorialStep('unknown', 'done'), false);
    assert.equal(f.save.setMenuTutorialStep('collection', 'bogus'), false);

    for (const savedStep of ['entry', 'target']) {
        f = fixture();
        f.save.setMenuTutorialStep('chapters', 'done');
        f.save.setMenuTutorialStep('collection', savedStep);
        f.state.page = savedStep === 'entry' ? 'lobby' : 'collection';
        f.update();assert.equal(f.state.overlay, null, 'Old collection checkpoints cannot bypass collectible eligibility');
        assert.equal(f.service.hasPending, false, 'An ineligible old checkpoint must not suppress automatic sign-in');
        f.home();f.update();assert.equal(f.state.overlay, null);
        f.state.obtained = true;f.update();
        assert.equal(f.state.overlay, null, 'Receiving the first collectible still waits for a subsequent home return');
        assert.equal(f.service.hasPending, false);
        f.home();f.update();assert.match(f.state.overlay.message, /收藏册/);
        const callback = f.state.overlay.done;
        f.state.obtained = false;f.update();
        assert.equal(f.state.overlay, null, 'A highlighted collection guide must retain a real collectible');
        callback(true);await tick();assert.deepEqual(f.calls, []);
    }

    // Exercise production home/overlay/navigation wiring instead of copying event order into the test.
    const Flow = extract('assets/scripts/GameFlow.ts', ['_menuTutorialPage', '_initMenuTutorial', '_menuTutorialTarget',
        'returnToLobby', 'enterLevelSelection', 'showCollect', 'openDailySignIn'], {
        MenuTutorialService, UITransform: 'ui', GameTips: 'tips', Vec3: class {}, sidebarDay: () => '2026-11-18',
    });
    const flow = new Flow(), overlay = {active: false};
    const tips = {present(node, local, radius, done, message) {overlay.active = true; Object.assign(overlay, {node, done, message});},
        dismiss() {overlay.active = false;}};
    const tipNode = {isValid: true, getComponent: () => tips};
    const target = name => ({name, isValid: true, activeInHierarchy: true,
        getComponent: () => ({width: 80, height: 80, anchorX: .5, anchorY: .5})});
    raw = null; const entry = target('BtnLevels'), collect = target('Btncollect'), second = target('second-arrow');
    let adDone, selected, dailyShown = 0;
    Object.assign(flow, {isValid: true, save: new SaveService(), _foods: [], _selectedTopic: null,
        node: {parent: {getChildByPath: () => tipNode}},
        lobby: {isValid: true, node: {activeInHierarchy: false}, tutorialEntry: kind => kind === 'chapters' ? entry : collect},
        citySelect: {node: {activeInHierarchy: false}, tutorialChapter: index => {
            assert.equal(index, 1, 'Production wiring selects the second card'); return {node: second, selection: {key: 'second'}};
        }},
        levelSelect: {node: {activeInHierarchy: false}},
        platform: {showInterstitial: () => new Promise(resolve => {adDone = resolve;})},
        _dailyConfig: JSON.parse(fs.readFileSync('assets/resources/configs/daily-sign-in.json', 'utf8')),
        _ensureDailySignIn: async () => ({present() {dailyShown++;}}),
        toast() {}, showLobby() {
            this._menuTutorial.onPageChanged(); this.lobby.node.activeInHierarchy = true;
            void this.openDailySignIn(true);
        },
        async showCitySelect() {this._menuTutorial.onPageChanged(); this.lobby.node.activeInHierarchy = false; this.citySelect.node.activeInHierarchy = true;},
        async enterChapterSelection(selection) {
            selected = selection.key; this._menuTutorial.onPageChanged(); this.citySelect.node.activeInHierarchy = false;
            this.levelSelect.node.activeInHierarchy = true; this._currentCity = selection;
        },
    });
    flow._initMenuTutorial(); flow.returnToLobby(); await tick();
    flow._menuTutorial.update(.2); assert.equal(overlay.active, false, 'Return-home ad finishes before the guide');
    assert.equal(dailyShown, 0, 'Automatic sign-in cannot open in the lobby onOpen race');
    adDone(); await tick(); flow._menuTutorial.update(.2);
    assert.equal(overlay.node, entry); overlay.done(true); await tick();
    flow._menuTutorial.update(.2); assert.equal(overlay.active, false, 'Chapter-entry ad also precedes target guide');
    adDone(); await tick(); flow._menuTutorial.update(.2); assert.equal(overlay.node, second);
    overlay.done(true); await tick(); assert.equal(selected, 'second');
    assert.equal(flow.save.data.menuTutorials.chapters, 'done');

    // Real save rules: opening a collectible's level is not the same as owning the collectible.
    flow._foods = [{id: 'cup', levelKey: 'test/one'}];
    flow.save.unlockLevel('test/one');flow.returnToLobby();await tick();adDone();await tick();
    flow._menuTutorial.update(.2);assert.equal(overlay.active, false);
    assert.equal(dailyShown, 1, 'An unavailable collectible guide must not suppress automatic sign-in');
    assert.equal(flow.save.data.menuTutorials.collection, undefined);
    flow.save.unlockCollectible('cup', 'test/one', 'test');flow._menuTutorial.update(.2);
    assert.equal(overlay.active, false, 'Production wiring also waits for home return after acquiring a collectible');
    flow.lobby.node.activeInHierarchy = false;flow.returnToLobby();await tick();adDone();await tick();
    flow._menuTutorial.update(.2);assert.equal(overlay.node, collect);
    assert.match(overlay.message, /收藏册/);

    const City = extract('assets/scripts/ui/CitySelectScreen.ts', ['tutorialChapter']);
    const city = new City(); city.flow = {chapterSelections: [{key: 'first'}, {key: 'second'}]};
    city._cards = [target('first'), target('second')]; city.findChildDeep = card => card;
    assert.equal(city.tutorialChapter(1).selection.key, 'second');
    city.flow.chapterSelections.reverse(); assert.equal(city.tutorialChapter(1).selection.key, 'first', 'Follows current display order');
    console.log('PASS menu tutorials: explicit first home, ad/sign-in ordering, second chapter, independent collectible guide, once-only persistence, resume/skip, failed writes/navigation and stale/disposed callbacks');
})().catch(error => {console.error(error); process.exitCode = 1;});
