const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const text = fs.readFileSync('assets/scripts/ui/GameScreen.ts', 'utf8');
const tree = ts.createSourceFile('GameScreen.ts', text, ts.ScriptTarget.Latest, true);
const names = new Set(['_timeFeedback', 'playAddTimeFeedback', '_resetTimeFeedback', 'refreshHud',
    '_hudSeconds', '_hudLives', '_hudFound', '_hudTotal', '_hudUnlimited', '_hudHints', '_hudAddTimes',
    '_timerColor', '_refreshTimerHud']);
const members = tree.statements.find(ts.isClassDeclaration).members
    .filter(m => names.has(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
class Vec3 {
    constructor(x = 0, y = 0, z = 1) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec3(this.x, this.y, this.z); }
}
const running = [];
function tween(target) {
    const value = { target, steps: [], stopped: false,
        to(seconds, props, options) { this.steps.push({ seconds, props, options });return this; },
        call(callback) { this.complete = callback;return this; }, start() { running.push(this);return this; } };
    return value;
}
const Screen = vm.runInNewContext(ts.transpileModule(`class Screen { ${members} }; Screen;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, { Vec3, Color: class {}, UIColors: { red: 'red' }, tween,
    Tween: { stopAllByTarget(target) { for (const t of running) if (t.target === target) t.stopped = true; } } });
const screen = new Screen(), timer = { node: { isValid: true, scale: new Vec3(2, 3, 1),
    setScale(value) { this.scale = value.clone(); } } };
screen.node = { activeInHierarchy: true };screen._level = { differences: [] };
screen.resolveLabel = () => timer;
screen._refreshAssistHud = screen._refreshLivesHud = screen._refreshProgressHud = () => {};
const flow = screen.flow = { remainingTime: 29, lives: 3, foundIds: new Set(),
    unlimitedAssists: false, save: { freeHints: 0, freeAddTimes: 0 } };
screen.refreshHud();assert.equal(timer.string, '0:29');
flow.remainingTime += 60;screen.playAddTimeFeedback(60);screen.refreshHud();
assert.equal(flow.remainingTime, 89, 'The reward changes real time immediately');
assert.equal(timer.string, '0:29', 'Only the displayed value starts from the pre-reward time');
const pulse = running[0], roll = running[1];
assert.equal(pulse.steps.reduce((sum, s) => sum + s.seconds, 0), 0.5);
assert.ok(Math.abs(pulse.steps[0].props.scale.x - 2.4) < 1e-9);
assert.ok(Math.abs(pulse.steps[0].props.scale.y - 3.6) < 1e-9);
assert.equal(roll.steps[0].seconds, 0.5);
flow.remainingTime -= 0.25;roll.target.offset = 15;roll.steps[0].options.onUpdate();
assert.equal(timer.string, '1:14', 'Number rolling follows the latest real countdown');
timer.node.scale = pulse.steps[0].props.scale;
flow.remainingTime += 60;screen.playAddTimeFeedback(60);screen.refreshHud();
assert.equal(timer.string, '1:14', 'A repeated award continues from the current displayed value');
assert.ok(roll.stopped && pulse.stopped);
const nextPulse = running[2], nextRoll = running[3];
assert.equal(nextPulse.steps[0].props.scale.x, 2.4, 'Repeated awards must not compound scale');
flow.remainingTime -= 0.5;nextRoll.target.offset = 0;nextRoll.steps[0].options.onUpdate();
timer.node.setScale(nextPulse.steps[1].props.scale);nextRoll.complete();
assert.equal(timer.string, '2:29');assert.equal(screen._timeFeedback, null);assert.equal(timer.node.scale.x, 2);

screen.playAddTimeFeedback(60);timer.node.scale = new Vec3(2.4, 3.6, 1);screen._resetTimeFeedback();
assert.equal(screen._timeFeedback, null);assert.equal(timer.node.scale.x, 2);assert.equal(timer.node.scale.y, 3);
const count = running.length;
for (const value of [0, -1, NaN, Infinity]) screen.playAddTimeFeedback(value);
screen.node.activeInHierarchy = false;screen.playAddTimeFeedback(60);
assert.equal(running.length, count);
console.log('PASS add-time feedback: immediate real reward, rolling display, live countdown, repeated awards, original scale and cancellation');
