const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
class UITransform { constructor(width = 120, height = 120) { Object.assign(this, { width, height, anchorX: .5, anchorY: .5 }); } }
class Sprite { static SizeMode = { CUSTOM: 0 }; }
class Label {}
class Animation {}
class Node {
    constructor(name, width = 120, height = 120) {
        Object.assign(this, { name, isValid: true, active: true, activeInHierarchy: true, children: [], layer: 7, scale: { x: 1, y: 1 }, handlers: {} });
        this.components = new Map([[UITransform, new UITransform(width, height)]]);
    }
    set parent(parent) { this._parent = parent; parent.children.push(this); }
    getComponent(type) { return this.components.get(type); }
    getChildByName(name) { return this.children.find(node => node.name === name); }
    setSiblingIndex() {}
    setPosition(x, y, z) { this.position = { x, y, z }; }
    on(event, callback) { this.handlers[event] = callback; }
    destroy() { this.isValid = false; }
}
const cc = { Node, UITransform, Sprite, Label, Animation, Input: { EventType: { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } },
    instantiate() {
        const node = new Node('Item_Tips_surprise');
        for (const name of ['icon_Time', 'Number', 'icon_videoplay']) {
            const child = new Node(name); child.parent = node;
            child.components.set(name === 'Number' ? Label : Sprite, name === 'Number' ? { string: 'x2' } : { spriteFrame: 'time' });
        }
        return node;
    } };
const output = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/ui/SurpriseAssist.ts', 'utf8')), { exports: output, require: () => cc, console: { warn() {} } });
const { SurpriseAssist } = output;
const level = { timeLimit: 100, maxLives: 3, differences: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })) };
async function setup(sequence = [], overrides = {}) {
    const flow = { remainingTime: 49, lives: 3, foundIds: new Set(), platform: { interstitialBusy: false }, isPaused: false, isGameOver: false,
        async loadGamePrefab(name) { assert.equal(name, 'Item_Tips_surprise'); return {}; },
        async loadGameSpriteFrame(path) { if(path.includes('icon_Idea')) return 'hint'; assert.ok(path.includes('icon_heart_filled')); return 'life'; },
        async claimSurpriseAssist() { return true; }, ...overrides };
    const root = new Node('Game', 750, 1334); let rolls = 0;
    const state = new SurpriseAssist(root, flow, () => { rolls++; return sequence.length ? sequence.shift() : 0; });
    state.start(level); await state._prepare();
    return { state, flow, root, rolls: () => rolls };
}
function method(file, name, extra = {}) {
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const member = tree.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(tree) === name);
    return vm.runInNewContext(compile(`class Test { ${member.getText(tree)} }; Test;`), extra);
}
(async () => {
    let { state, flow, root, rolls } = await setup();
    flow.remainingTime = 50; state.update(100); assert.equal(rolls(), 0, 'Exactly half time does not roll');
    flow.remainingTime = 49; state.update(4.9); assert.equal(state._flight, null);
    state.update(.1); assert.ok(state._flight); assert.equal(state._appearances, 1);
    const first = state._flight, point = first.node.position;
    assert.equal(first.gift.kind, 'hint'); assert.equal(first.gift.amount, 1);
    assert.equal(first.node.getChildByName('icon_Time').getComponent(Sprite).spriteFrame, 'hint');
    assert.equal(first.node.getChildByName('Number').getComponent(Label).string, 'x1');
    assert.equal(first.node.getChildByName('icon_videoplay').active, false);
    assert.equal(point.x, -435); assert.ok(point.y >= 60 && point.y <= 340.2);
    assert.equal(first.duration, 2.5);
    state.update(1.25); assert.equal(first.node.position.x, 0, 'One free gift crosses the midpoint in 1.25 seconds');
    assert.notEqual(first.node.position.y, point.y, 'Flight floats vertically instead of following a straight line');
    const clock = state._clock, elapsed = first.elapsed;
    flow.isPaused = true; state.update(60); assert.equal(first.elapsed, elapsed); assert.equal(state._clock, clock);
    flow.isPaused = false; flow.platform.interstitialBusy = true; state.update(60); assert.equal(first.elapsed, elapsed);
    flow.platform.interstitialBusy = false;
    state.update(1.25); assert.equal(state._flight, null); assert.equal(first.node.isValid, false, 'One unclicked gift expires at 2.5 seconds');
    assert.equal(state._appearances, 1, 'Ignoring a gift still consumes its appearance');
    state.update(7.4); assert.equal(state._flight, null);
    state.update(.1); assert.equal(state._appearances, 2, 'Next gift starts at least ten active seconds after previous spawn');
    state.update(5); state.update(5); assert.equal(state._appearances, 3);
    state.update(5); state.update(100); assert.equal(state._flight, null); assert.equal(state._appearances, 3);
    state.start(level); await state._prepare(); state.update(5); assert.equal(state._appearances, 1, 'New round resets quota');
    flow.isGameOver = true; state.update(1); assert.equal(state._flight, null);
    flow.isGameOver = false; state.update(5); assert.equal(state._appearances, 1, 'Revival does not reset quota or cooldown');
    state.clear(); assert.equal(state._level, null); assert.equal(state._appearances, 0);

    // Compare the same random roll under opposite free/video conditions.
    for (const [amountRandom, pointsLeft, seconds, expected] of [
        [0, 10, 10, false], [0, 1, 10, true], // Free: fewer differences is more likely.
        [.5, 10, 10, true], [.5, 1, 10, false], // Video: more differences is more likely.
        [.5, 10, 49, false], // Video: the same difference count becomes less likely with more time.
        [.99, 10, 10, true], // Three-item video gifts use the same urgency rule.
    ]) {
        ({ state, flow } = await setup([0, amountRandom, .5]));
        flow.remainingTime = seconds;
        flow.foundIds = new Set(Array.from({ length: 10 - pointsLeft }, (_, i) => String(i)));
        state.update(4.9); assert.equal(state._flight, null);
        state.update(.1); assert.equal(!!state._flight, expected, `quantity=${amountRandom}, remaining=${pointsLeft}, seconds=${seconds}`);
        state.dispose();
    }
    ({ state, flow, rolls } = await setup()); flow.foundIds = new Set(level.differences.map(d => d.id));
    state.update(100); assert.equal(rolls(), 0, 'No gifts when no points remain'); state.dispose();

    // Freeze the displayed reward and direction; extending time prevents future rolls.
    ({ state, flow, root } = await setup([.9, .99, 0, .9, .9])); state.update(5);
    let flight = state._flight;
    assert.equal(flight.gift.kind, 'add-time'); assert.equal(flight.gift.amount, 3);
    assert.equal(flight.duration, 5, 'Maximum quantity has the slowest five-second flight');
    assert.equal(flight.node.getChildByName('icon_Time').getComponent(Sprite).spriteFrame, 'time');
    assert.equal(flight.node.getChildByName('icon_videoplay').active, true);
    assert.equal(flight.node.position.x, 435);
    root.getComponent(UITransform).width = 600; state.update(2.5); assert.equal(flight.node.position.x, 0, 'Position uses actual current UI size');
    flow.remainingTime = 80; state.update(2.5); assert.equal(state._flight, null);
    state.update(50); assert.equal(state._appearances, 1, 'No new rolls above half time after extension'); state.dispose();

    // All quantities float within the 50%-80% band for different root sizes/anchors.
    for (const amount of [1, 2, 3]) {
        ({ state, root } = await setup([0, (amount - 1) / 3, 0, 0, .5, .3])); state.update(5);
        flight = state._flight; assert.equal(flight.duration, [2.5,3.5,5][amount-1]);
        const ui = root.getComponent(UITransform); ui.height = 1000; ui.anchorY = .3;
        const heights = new Set();
        while (state._flight) {
            state.update(.05);
            if (!state._flight) break;
            const { y } = flight.node.position; heights.add(y.toFixed(2));
            assert.ok(y - 60 >= 200 - 1e-8 && y + 60 <= 500 + 1e-8, 'Entire bubble stays inside the height band');
        }
        assert.ok(heights.size > 10, 'Visible bobbing throughout flight');
        assert.ok(flight.elapsed >= flight.duration && flight.elapsed < flight.duration + .051);
        state.dispose();
    }

    const verticalSamples=[];
    for(const amount of [1,2,3]) {
        ({state}=await setup([0,(amount-1)/3,0,0,.5,0]));state.update(5);
        flight=state._flight;
        const center=flight.node.position.y;
        state.update(.3);const peak=flight.node.position.y;
        state.update(.6);const trough=flight.node.position.y;
        state.update(.3);const fullCycle=flight.node.position.y;
        assert.ok(Math.abs(peak-center-48)<1e-6,'Upward amplitude doubles from 24 to 48');
        assert.ok(Math.abs(peak-trough-96)<1e-6,'Peak-to-peak floating range is doubled');
        assert.ok(Math.abs(fullCycle-center)<1e-6,'A full vertical cycle still takes 1.2 seconds');
        verticalSamples.push([peak,trough,fullCycle]);state.dispose();
    }
    assert.deepEqual(verticalSamples[0],verticalSamples[1]);assert.deepEqual(verticalSamples[0],verticalSamples[2],'Quantity changes only horizontal speed');

    // Life is a one-point free reward only while injured; it never becomes a different gift mid-flight.
    for(const lives of [0,3]) {
        for(const draw of [0,.34,.67,.99]) {
            ({state}=await setup([draw,0,0],{lives}));state.update(5);
            assert.notEqual(state._flight.gift.kind,'life','Full or depleted health excludes life from the candidate pool');state.dispose();
        }
    }
    ({state,flow}=await setup([.99,0,0,.5,0],{lives:2}));state.update(5);
    flight=state._flight;assert.equal(flight.gift.kind,'life');assert.equal(flight.gift.amount,1);assert.equal(flight.duration,2.5);
    assert.equal(flight.node.getChildByName('icon_Time').getComponent(Sprite).spriteFrame,'life');
    assert.equal(flight.node.getChildByName('Number').getComponent(Label).string,'x1');
    assert.equal(flight.node.getChildByName('icon_videoplay').active,false);
    flow.lives=3;state.update(.1);assert.equal(state._flight,null,'A full-health player no longer sees an unclaimed life gift');
    assert.equal(state._appearances,1);state.dispose();
    ({state,flow}=await setup([.99,0],{lives:4}));state.start({...level,maxLives:5});await state._prepare();state.update(5);
    assert.equal(state._flight.gift.kind,'life','Eligibility uses this level\'s actual maxLives');state.dispose();

    // Claim once, stop touch propagation, freeze flight while ad is pending, and allow retry after cancellation.
    let finish, claims = 0;
    ({ state, flow } = await setup([], { claimSurpriseAssist(kind, amount) { claims++; return new Promise(resolve => { finish = resolve; }); } }));
    state.update(5); flight = state._flight;
    const touch = {}; flight.node.handlers.start(touch); assert.equal(touch.propagationStopped, true);
    let pending = state._claim(flight); await state._claim(flight); assert.equal(claims, 1);
    state.update(30); assert.equal(flight.elapsed, 0);
    finish(false); await pending; assert.equal(state._flight, flight); assert.equal(state._appearances, 1);
    pending = state._claim(flight); finish(true); await pending; assert.equal(state._flight, null);
    assert.equal(state._appearances, 1);
    state.update(5); state.update(5); flight = state._flight;
    pending = state._claim(flight); state.clear(); state.start(level); await state._prepare(); state.update(5);
    const next = state._flight; finish(true); await pending; assert.equal(state._flight, next, 'Stale ad callback cannot remove a new-round gift'); state.dispose();

    let assetLoads = 0;
    ({ state, flow } = await setup([], { async loadGamePrefab() { if (++assetLoads === 1) throw Error('offline'); return {}; } }));
    assert.equal(state._appearances, 0); state.update(5); await state._prepare(); state.update(5);
    assert.equal(state._appearances, 1, 'Asset failures retry without consuming quota'); state.dispose();

    // Exercise the production grant route, including video completion and round staleness.
    const Flow = method('assets/scripts/GameFlow.ts', 'claimSurpriseAssist');
    const f = new Flow();
    Object.assign(f, { _assistRoundVersion: 1, _isGameOver: false, isPaused: false, platform: { interstitialBusy: false }, game: { node: { activeInHierarchy: true }, refreshHud() {} }, toast() {} });
    const inventory = { hint: 4, 'add-time': 5 }; let videos = 0, completed = false, disk = true, hintsUsed = 0, timeAdded = 0;
    f.save = { grantAssist(kind, amount) { if (!disk) return false; inventory[kind] += amount; return true; } };
    f.playHintSound = f.playAddTimeSound = () => {};
    f.useHint = () => hintsUsed++;
    f.addTime = seconds => timeAdded += seconds;
    f.requestReward = async (placement, callback) => { assert.equal(placement, 'surprise'); videos++; if (completed) callback(); };
    assert.equal(await f.claimSurpriseAssist('hint', 1), true); assert.equal(videos, 0); assert.equal(inventory.hint, 4); assert.equal(hintsUsed, 1);
    assert.equal(await f.claimSurpriseAssist('add-time', 1), true); assert.equal(videos, 0); assert.equal(inventory['add-time'], 5); assert.equal(timeAdded, 60);
    assert.equal(await f.claimSurpriseAssist('add-time', 2), false); assert.equal(inventory['add-time'], 5, 'Incomplete video awards nothing'); assert.equal(timeAdded, 60);
    completed = true; assert.equal(await f.claimSurpriseAssist('add-time', 3), true); assert.equal(inventory['add-time'], 7); assert.equal(timeAdded, 120);
    assert.equal(await f.claimSurpriseAssist('hint', 2), true); assert.equal(inventory.hint, 5); assert.equal(hintsUsed, 2);
    disk = false; assert.equal(await f.claimSurpriseAssist('hint', 2), false); assert.equal(inventory.hint, 5); assert.equal(hintsUsed, 2); disk = true;
    const beforeLifeVideos=videos, beforeLifeInventory=JSON.stringify(inventory);
    f._currentLevel={maxLives:3};f._lives=2;
    assert.equal(await f.claimSurpriseAssist('life',1),true);assert.equal(f._lives,3);
    assert.equal(await f.claimSurpriseAssist('life',1),false,'Cannot exceed this level\'s maximum health');
    f._lives=1;assert.equal(await f.claimSurpriseAssist('life',2),false);assert.equal(f._lives,1,'Life quantity is always exactly one');
    f._lives=0;assert.equal(await f.claimSurpriseAssist('life',1),false,'Life gift cannot revive a failed round');
    f._lives=2;f._isGameOver=true;assert.equal(await f.claimSurpriseAssist('life',1),false);assert.equal(f._lives,2);f._isGameOver=false;
    f.isPaused=true;assert.equal(await f.claimSurpriseAssist('life',1),false);f.isPaused=false;
    f.game.node.activeInHierarchy=false;assert.equal(await f.claimSurpriseAssist('life',1),false);f.game.node.activeInHierarchy=true;
    f._currentLevel={maxLives:5};f._lives=4;assert.equal(await f.claimSurpriseAssist('life',1),true);assert.equal(f._lives,5);
    assert.equal(videos,beforeLifeVideos,'One-point life gifts never request rewarded ads');
    assert.equal(JSON.stringify(inventory),beforeLifeInventory,'Life recovery never changes hint/time inventory');
    for (const [kind, amount] of [['unknown', 1], ['hint', 0], ['hint', 4], ['hint', 1.5], ['hint', NaN]]) assert.equal(await f.claimSurpriseAssist(kind, amount), false);
    for (const flag of ['isPaused', '_isGameOver', '_rewardPending']) { f[flag] = true; assert.equal(await f.claimSurpriseAssist('hint', 1), false); f[flag] = false; }
    f.requestReward = async (_, callback) => { f._assistRoundVersion++; callback(); };
    assert.equal(await f.claimSurpriseAssist('hint', 2), false); assert.equal(inventory.hint, 5, 'Old-round video cannot award a new round'); assert.equal(hintsUsed, 2);

    const started = [];
    const Game = method('assets/scripts/ui/GameScreen.ts', 'onLoad', { SurpriseAssist: class { start(value) { started.push(value); } }, EnergyDisplay: { attach() {} } });
    const game = new Game(); game.node = root; game.flow = flow; game._level = level;
    game.findChildDeep = game.resolveNode = () => null;
    game._hideComboTips = game.wireButton = game._bindImageInput = () => {};
    game._loadComboFrames = game._loadWrongFrame = async () => {};
    game.onLoad();
    assert.deepEqual(started, [level], 'First activation starts the round already prepared on an inactive GameScreen');
    const prefab = JSON.parse(fs.readFileSync('assets/PleyGame/prefabs/Item_Tips_surprise.prefab'));
    for (const name of ['icon_Time', 'Number', 'icon_videoplay']) assert.ok(prefab.some(node => node.__type__ === 'cc.Node' && node._name === name));
    console.log('PASS surprise assists: injured-only one-point healing, full-health/failed/paused guards, 2.5/3.5/5s flights, doubled amplitude with quantity-independent frequency, probability/quotas, immediate use, ads and stale callbacks');
})().catch(error => { console.error(error); process.exitCode = 1; });
