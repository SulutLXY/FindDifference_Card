const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function methods(file, names, globals = {}) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const cls = tree.statements.find(ts.isClassDeclaration);
    const body = cls.members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Test { ${body} }; Test;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, { console, ...globals });
}
class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
class Label {}
class UITransform {}
const handlers = new Map();
const input = { on: (event, callback, target) => handlers.set(event, () => callback.call(target)), off: event => handlers.delete(event) };
const events = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end' };
const Tips = methods('assets/scripts/ui/GameTips.ts', ['present', 'presentHint', '_clearHint', '_finishHint',
    '_setBlockingInput', 'dismiss', 'onDisable', '_block', '_tap'], { input, Input: { EventType: events }, Node: { EventType: events }, Label, Vec3, UITransform });
const tips = new Tips(), blocking = new Map();
const rootHandlers = new Map();
const canvas = { getComponent: type => type === UITransform ? {} : null,
    on: (event, cb, target) => rootHandlers.set(event, e => cb.call(target, e)), off: event => rootHandlers.delete(event) };
const screens = { children: [], parent: canvas, getComponent: () => null,
    on() { throw Error('Screens has no UITransform: touch listeners would crash cameraPriority sorting'); } };
tips.node = { active: false, parent: screens, setSiblingIndex() {}, getChildByPath: () => null,
    on: (event, callback) => blocking.set(event, callback), off: event => blocking.delete(event) };
tips._local = { set() {} }; tips._skip = { active: true, getComponent: () => ({ string: '' }) };
tips._layoutText = tips.lateUpdate = () => {};
let timer, elapsed, dismissed = 0;
tips.scheduleOnce = (callback, seconds) => { assert.equal(seconds, 2); timer = () => callback.call(tips); elapsed = 0; };
tips.unschedule = () => { timer = null; };
tips.presentHint({}, {}, 30, () => dismissed++);
assert.equal(tips._hintInputRoot, canvas, 'Use the UI ancestor, skip transformless Screens');
assert.equal(blocking.size, 0, 'Passive overlay has no node touch handlers to intercept image taps');
assert.equal(tips._skip.active, false); assert.equal(tips._done, null);
elapsed = 2; timer(); assert.equal(tips.node.active, false); assert.equal(dismissed, 1); assert.equal(handlers.size, 0);
tips.presentHint({}, {}, 30, () => dismissed++);
handlers.get('start')(); assert.equal(tips.node.active, false); assert.equal(dismissed, 2); assert.equal(timer, null);
tips.presentHint({}, {}, 30); tips.onDisable(); assert.equal(handlers.size, 0); assert.equal(timer, null);
tips.present({}, {}, 30, () => {}); assert.equal(blocking.size, 3, 'Tutorials still block input');
tips.presentHint({}, {}, 30); assert.equal(blocking.size, 0, 'Switching from tutorial removes blockers');

const Flow = methods('assets/scripts/GameFlow.ts', ['useHint', 'update'], { GameTips: class {} });
const flow = new Flow();
const difference = { id: 'a', x: 0.25, y: 0.25, radius: 0.1 };
flow._currentLevel = { differences: [difference] }; flow._foundIds = new Set(); flow.foundIds = flow._foundIds; flow._isPaused = false; flow._isGameOver = false;
flow.isValid = true; flow.node = { parent: { getChildByPath: () => ({ getComponent: () => tips }) } };
flow.game = { node: { active: true, activeInHierarchy: true }, tutorialResetZoom() {},
    tutorialTarget: () => ({ node: {}, local: {}, radius: 30 }), refreshHud() {} };
flow.platform = { interstitialBusy: false }; flow._remainingTime = 100; flow._elapsedTime = 0; flow._maybeShowAssistTutorial = () => {};
flow.useHint(); assert.equal(flow._isPaused, false); assert.equal(flow._foundIds.size, 0);
flow.update(1); assert.equal(flow._remainingTime, 99, 'Countdown continues during hint');

// Feed an image tap through the real hit-test path after dismissing the passive overlay.
const Controller = methods('assets/scripts/gameplay/DifferenceController.ts', ['radiusToLocal', 'localToNormalized', 'hitTest', 'EDGE_TOLERANCE_RATIO'], { Vec2: Vec3 });
const Screen = methods('assets/scripts/ui/GameScreen.ts', ['_onImageTouch'], { Vec3, UITransform, DifferenceController: Controller });
const screen = new Screen(); screen._level = flow._currentLevel; screen.flow = flow;
screen._imageSize = () => ({ width: 100, height: 100 });
const image = { getComponent: () => ({ convertToNodeSpaceAR: p => p }) };
let found = 0, wrong = 0;
flow.onDifferenceFound = (hit, node) => { assert.equal(node, image); found++; flow._foundIds.add(hit.id); };
flow.onWrongTap = () => wrong++;
for (const point of [{ x: -25, y: 25 }, { x: 40, y: -40 }]) {
    tips.presentHint({}, {}, 30);
    const event = { getUILocation: () => point };
    rootHandlers.get('start')(event);
    screen._onImageTouch(event, image);
    assert.equal(event.propagationStopped, undefined);
}
assert.equal(found, 1); assert.equal(wrong, 1);
const scene = JSON.parse(fs.readFileSync('assets/scene/game.scene', 'utf8'));
const sceneScreens = scene.find(n => n._name === 'Screens');
assert.equal(sceneScreens._components.some(ref => scene[ref.__id__].__type__ === 'cc.UITransform'), false);
const sceneCanvas = scene[sceneScreens._parent.__id__];
assert.ok(sceneCanvas._components.some(ref => scene[ref.__id__].__type__ === 'cc.UITransform'));
console.log('PASS: real Screens/Canvas structure avoids cameraPriority crash; 2-second hint, pass-through input, ticking timer, correct/wrong judgement and cleanup.');
