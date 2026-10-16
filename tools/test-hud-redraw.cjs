const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function load(file, names, globals = {}) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const members = tree.statements.find(ts.isClassDeclaration).members;
    const body = members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Test { ${body} }; Test;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, globals);
}
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { Object.assign(this, typeof x === 'object' ? x : { x, y, z }); return this; }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
}
class Color {}
class UITransform {}
const Screen = load('assets/scripts/ui/GameScreen.ts', [
    'refreshHud', '_refreshTimerHud', 'clearLevel', '_hudSeconds', '_hudLives', '_hudFound', '_hudTotal',
    '_hudUnlimited', '_hudHints', '_hudAddTimes', '_hudHintAd', '_hudTimeAd', '_timerColor',
], { Color, UIColors: { red: 'red' } });
const screen = new Screen();
const flow = screen.flow = { unlimitedAssists: false, save: { freeHints: 1, freeAddTimes: 2 },
    canWatchHintAd: true, canWatchAddTimeAd: true, remainingTime: 120, lives: 5, foundIds: new Set() };
screen._level = { differences: [1, 2, 3] };
const calls = { timer: 0, assists: 0, lives: 0, progress: 0 };
const label = {};
screen.resolveLabel = () => { calls.timer++; return label; };
screen._refreshAssistHud = () => calls.assists++;
screen._refreshLivesHud = () => calls.lives++;
screen._refreshProgressHud = () => calls.progress++;
screen.refreshHud();
for (let frame = 1; frame < 60; frame++) { flow.remainingTime = 120 - frame / 60; screen.refreshHud(); }
assert.deepEqual(calls, { timer: 1, assists: 1, lives: 1, progress: 1 });
assert.equal(label.string, '2:00');
flow.remainingTime = 119; screen.refreshHud();
assert.equal(label.string, '1:59'); assert.equal(calls.timer, 2);
flow.lives--; screen.refreshHud(); assert.equal(calls.lives, 2);
flow.foundIds.add('first'); screen.refreshHud(); assert.equal(calls.progress, 2);
flow.save.freeHints--; screen.refreshHud(); assert.equal(calls.assists, 2);
flow.canWatchHintAd = false; screen.refreshHud(); assert.equal(calls.assists, 3);
flow.unlimitedAssists = true; screen.refreshHud(); assert.equal(calls.assists, 4);
flow.remainingTime = 10; screen.refreshHud(); assert.equal(label.color, 'red');
flow.remainingTime += 30; screen.refreshHud(); assert.equal(label.color, screen._timerColor);
// Re-entering with identical values must refresh every group again.
for (const method of ['_hideComboTips', '_clearSuccessText', '_resetGesture', '_clearMarkers', '_clearWrongMarkers']) screen[method] = () => {};
screen._image = () => null; screen._levelFrames = []; screen.clearLevel();
screen._level = { differences: [1, 2, 3] };
const previous = { ...calls }; screen.refreshHud();
for (const key of Object.keys(calls)) assert.equal(calls[key], previous[key] + 1);
console.log('PASS HUD: idle frames, second boundaries, life/progress/assist changes, added time and re-entry');

const Tips = load('assets/scripts/ui/GameTips.ts', ['lateUpdate', '_geometryDirty', '_drawWidth', '_drawHeight',
    '_nextCenter', '_edge', '_world', '_localEdge', '_center'], { Vec3, UITransform, Color });
const tips = new Tips();
let redraws = 0, offset = 0, scale = 1;
const canvas = { width: 750, height: 1334 };
const ui = { width: 750, height: 2000, setContentSize(w, h) { this.width = w; this.height = h; },
    convertToNodeSpaceAR(p, out) { return out.set(p); } };
const targetUi = { convertToWorldSpaceAR(p, out) { return out.set(p.x * scale + offset, p.y * scale, p.z); } };
tips.node = { getComponent: () => ui, parent: { parent: { getComponent: () => canvas } }, getChildByName: () => null };
tips._target = { isValid: true, getComponent: () => targetUi };
tips._local = new Vec3(); tips._radius = 30;
tips._hole = { setPosition() {}, getComponent: () => ({ setContentSize() {} }) };
tips._shade = { clear() { redraws++; }, rect() {}, fill() {} };
tips._outline = { clear() {}, circle() {}, stroke() {} };
tips._layoutText = () => {};
tips._boxHeight = 120; tips._boxLeft = -150; tips._boxRight = 150;
tips.lateUpdate();
for (let i = 0; i < 120; i++) tips.lateUpdate();
assert.equal(redraws, 1);
offset = 80; tips.lateUpdate(); assert.equal(redraws, 2); assert.equal(tips._center.x, 80);
scale = 2; tips.lateUpdate(); assert.equal(redraws, 3); assert.equal(tips._screenRadius, 60);
canvas.height = 1500; tips.lateUpdate(); assert.equal(redraws, 4);
canvas.width = 800; tips.lateUpdate(); assert.equal(redraws, 5);
tips._geometryDirty = true; tips.lateUpdate(); assert.equal(redraws, 6);
tips.lateUpdate(); assert.equal(redraws, 6);
console.log('PASS guide: static redraw suppression, target/ancestor movement and scale, viewport changes and invalidation');
