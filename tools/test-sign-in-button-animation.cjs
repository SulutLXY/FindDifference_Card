const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const text = fs.readFileSync('assets/scripts/ui/DailySignInModal.ts', 'utf8');
const ast = ts.createSourceFile('DailySignInModal.ts', text, ts.ScriptTarget.Latest, true);
const methods = ['_prepareButtonAnimations', '_setDoublePulse', '_playNormalClick', '_stopButtonAnimations', '_refresh',
    '_normalAnimation', '_normalScale', '_doubleAnimation', '_doubleScale', '_doubleOpacity', '_doubleBaseOpacity', '_doubleBlink', '_doublePulsing'];
const body = ast.statements.find(ts.isClassDeclaration).members.filter(m => methods.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n');
class Animation {} class Button {} class Sprite {} class UIOpacity {}
const tweens = [];
function tween(target) { return { target, steps: [], stopped: false,
    to(time, props) { this.steps.push({ time, props }); return this; },
    repeatForever(child) { this.steps = child.steps; return this; },
    start() { tweens.push(this); return this; }, stop() { this.stopped = true; },
}; }
const Modal = vm.runInNewContext(ts.transpileModule(`class Modal {${body}}; Modal;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, { Animation, Button, Sprite, UIOpacity, tween, sidebarDay: () => '2026-11-12' });
function button(name, clip) {
    const scale = { x: 1, y: 1, z: 1, clone() { return { x: this.x, y: this.y, z: this.z }; } };
    const opacity = { isValid: true, opacity: 220 }, state = { isPlaying: false };
    const animation = { isValid: true, playOnLoad: true, defaultClip: { name: clip, duration: 1.5 }, plays: [],
        play(name) { this.plays.push(name); state.isPlaying = true; }, stop() { this.stopped = true; state.isPlaying = false; },
        getState: () => state,
    };
    const button = { interactable: true }, sprite = {};
    const node = { name, scale, opacity, animation, button, sprite,
        getComponent(Type) { return Type === Animation ? animation : Type === UIOpacity ? opacity : Type === Button ? button : Type === Sprite ? sprite : null; },
        setScale(value) { Object.assign(scale, value); },
    }; animation.node = node; return node;
}
const modal = new Modal(), normal = button('BtnNormal', 'An_BtnClik_01'), double = button('BtnDouble', 'An_Gameflow_01');
modal.btnNormal = normal; modal.btnDouble = double;
modal.resolveNode = node => node;
modal.node = { activeInHierarchy: true };
modal._config = JSON.parse(fs.readFileSync('assets/resources/configs/daily-sign-in.json', 'utf8'));
modal.setLabel = modal._syncDesktopChoice = () => {}; modal.findChildDeep = () => null;
const status = { canClaim: true, dayIndex: 1, claimed: false };
modal.flow = { save: { dailyStatus: () => status } };
modal._prepareButtonAnimations();
assert.equal(double.animation.playOnLoad, false);
modal._refresh();
assert.deepEqual(double.animation.plays, ['An_Gameflow_01']);
assert.equal(tweens.length, 1); assert.equal(tweens[0].target, double.opacity, 'Flash the whole button, including its label');
assert.deepEqual(tweens[0].steps.map(step => step.time), [.75, .75]);
assert.equal(tweens[0].steps[0].props.opacity, 165); assert.equal(tweens[0].steps[1].props.opacity, 220);
for (let i = 0; i < 5; i++) modal._refresh();
assert.equal(double.animation.plays.length, 1); assert.equal(tweens.length, 1, 'Periodic HUD refresh does not restart or duplicate the loop');
modal._playNormalClick(); modal._playNormalClick();
assert.deepEqual(normal.animation.plays, ['An_BtnClik_01'], 'Local fallback does not duplicate a running global click animation');
double.scale.x = 1.15; double.opacity.opacity = 165;
modal._pending = true; modal._refresh();
assert.equal(tweens[0].stopped, true); assert.equal(double.scale.x, 1); assert.equal(double.opacity.opacity, 220);
assert.equal(double.button.interactable, false);
modal._pending = false; modal._refresh(); assert.equal(tweens.length, 2, 'Cancelled/failed claim can resume the pulse');
status.claimed = true; status.canClaim = false; modal._refresh();
assert.equal(tweens[1].stopped, true); assert.equal(double.button.interactable, false); assert.equal(double.opacity.opacity, 220);
status.claimed = false; status.canClaim = true; modal._refresh();
normal.scale.x = .9; modal._stopButtonAnimations();
assert.equal(normal.scale.x, 1); assert.equal(double.scale.x, 1); assert.equal(tweens.at(-1).stopped, true);
const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/DailySignInModal.prefab', 'utf8'));
for (const [name, uuid] of [['BtnNormal', '4ae20895-4cab-4014-80e0-5bef8b3de0ac'], ['BtnDouble', '7a8d631d-543a-416a-8009-1785d02a6b12']]) {
    const node = prefab.find(n => n.__type__ === 'cc.Node' && n._name === name);
    const animation = node._components.map(c => prefab[c.__id__]).find(c => c.__type__ === 'cc.Animation');
    assert.ok(animation._clips.some(c => c.__uuid__ === uuid), `${name} uses the real authored clip on its root`);
}
const clip = JSON.parse(fs.readFileSync('assets/PleyGame/Common/Animation/An_Gameflow_01.anim', 'utf8'));
assert.equal(clip[0].wrapMode, 2); assert.equal(clip[0]._duration, 1.5);
console.log('PASS sign-in animation: authored root clips, continuous 1.5s scale/opacity pulse, normal click fallback, no restart/duplication, pending/claimed stop, cancellation resume and restore on close.');
