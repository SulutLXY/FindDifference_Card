const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/Cocos/cocoseditors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript');

function load(file, names, globals) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const members = tree.statements.find(ts.isClassDeclaration).members;
    const body = members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Screen { ${body} }; Screen;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, globals);
}
class Graphics {
    constructor() { this.clears = 0; this.circles = []; }
    clear() { this.clears++; this.circles = []; }
    circle(x, y, radius) { this.circles.push({ x, y, radius, width: this.lineWidth }); }
    stroke() {}
}
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static ONE = new Vec3(1, 1, 1);
}
class Node {
    constructor(name) {
        this.name = name; this.children = []; this.isValid = true;
        this.position = new Vec3(); this.scale = new Vec3(1, 1, 1);
    }
    set parent(value) { this._parent = value; value.children.push(this); }
    get parent() { return this._parent; }
    setPosition(x, y) { this.position = new Vec3(x, y); }
    addComponent(Type) { const c = new Type(); c.node = this; return c; }
    getChildByName(name) { return this.children.find(n => n.name === name && n.isValid); }
    destroy() { this.isValid = false; }
}
const tweens = [];
const stopped = [];
function tween(target) {
    const t = { target, steps: [], delay(v) { this.delayValue = v; return this; },
        to(time, values, options) { this.steps.push({ time, values, options }); return this; },
        call(fn) { this.complete = fn; return this; }, start() { tweens.push(this); return this; } };
    return t;
}
const Game = load('assets/scripts/ui/GameScreen.ts', [
    '_markers', '_markerRadii', '_markerGraphics', '_markersDirty', 'lateUpdate',
    'drawFoundMarker', '_redrawFoundMarkers', 'playVictoryWave', '_clearMarkers',
], { Node, Graphics, Vec3, tween, Tween: { stopAllByTarget(n) { stopped.push(n); } },
    UIColors: { red: 'red' }, DifferenceController: {
        normalizedToLocal: (d, w, h) => ({ x: (d.x - 0.5) * w, y: (0.5 - d.y) * h }),
        radiusToLocal: (d, w, h) => d.radius * Math.min(w, h),
    } });
const game = new Game();
const images = { TopImage: new Node('TopImage'), BottomImage: new Node('BottomImage') };
game._image = name => images[name];
game._imageSize = () => ({ width: 600, height: 400 });
const differences = Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: (i + 1) / 12, y: 0.25, radius: 0.05 }));
game._level = { differences };
for (const d of differences) game.drawFoundMarker(d);
assert.equal(game._markers.length, 20);
assert.equal(game._markerGraphics.size, 2, '20 markers share two renderers');
for (const graphics of game._markerGraphics.values()) {
    assert.equal(graphics.circles.length, 10);
    assert.equal(graphics.circles[0].radius, 20);
    assert.equal(graphics.circles[0].width, 7);
    const clears = graphics.clears;
    game.lateUpdate();
    assert.equal(graphics.clears, clears, 'idle frames do not rebuild geometry');
}
let completed = 0;
game.playVictoryWave(() => completed++);
assert.equal(tweens.length, 20);
assert.equal(tweens.at(-1).delayValue + 0.5, 2);
const animated = tweens[0];
animated.target.scale = animated.steps[0].values.scale;
animated.steps[0].options.onUpdate();
const top = game._markerGraphics.get(images.TopImage);
const before = top.clears;
game.lateUpdate();
assert.equal(top.clears, before + 1);
assert.equal(top.circles[0].radius, 25);
assert.equal(top.circles[0].width, 8.75, 'pulse scales stroke and radius together');
animated.target.scale = Vec3.ONE;
animated.steps[1].options.onUpdate();
game.lateUpdate();
assert.equal(top.circles[0].radius, 20);
for (const t of tweens) t.complete();
assert.equal(completed, 1);
const graphicsNodes = [...game._markerGraphics.values()].map(g => g.node);
game._clearMarkers();
assert.equal(stopped.length, 20);
assert.equal(game._markers.length, 0);
assert.equal(game._markerGraphics.size, 0);
assert.equal(game._markerRadii.size, 0);
assert.ok(graphicsNodes.every(n => !n.isValid));
game.lateUpdate();
game.drawFoundMarker(differences[0]);
assert.equal(game._markerGraphics.size, 2, 'reopening creates fresh batches');

class UITransform {}
const Select = load('assets/scripts/ui/LevelSelectScreen.ts', ['_cardRendering', 'lateUpdate'], { UITransform });
const select = new Select();
let onScreen = false;
const bounds = { intersects: box => box.visible };
select.resolveNode = () => ({ getComponent: () => ({ getBoundingBoxToWorld: () => bounds }) });
let changes = 0;
const renderer = { get enabled() { return this.value; }, set enabled(v) { this.value = v; changes++; }, value: true };
const card = { getComponent: () => ({ getBoundingBoxToWorld: () => ({ visible: onScreen }) }) };
select._cardRendering = [{ card, components: [renderer], visible: true }];
select.lateUpdate();
assert.equal(renderer.enabled, false);
select.lateUpdate();
assert.equal(changes, 1, 'unchanged visibility does not toggle components');
onScreen = true;
select.lateUpdate();
assert.equal(renderer.enabled, true, 'scrolling back restores rendering');
console.log('PASS render batching: two marker renderers, pulse geometry, idle frames, cleanup/reopen and scroll culling');
