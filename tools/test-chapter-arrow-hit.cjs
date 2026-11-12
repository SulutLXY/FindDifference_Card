const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/CitySelectScreen.prefab', 'utf8'));
const clip = JSON.parse(fs.readFileSync('assets/PleyGame/Common/Animation/An_BtnClik_01.anim', 'utf8'));
const minimumScale = Math.min(...clip.filter(x => x.__type__ === 'cc.RealCurve').flatMap(x => x._values.map(k => k.value)));
assert.ok(minimumScale < .9, 'Use the actual authored card press scale');
class Component {}
class Button {}
class Animation {
    enabledInHierarchy = true; plays = 0;
    getState(name) { return name === 'An_BtnClik_01' ? {} : null; }
    play() { this.plays++; this.node.scale = minimumScale; }
}
class Node {
    static EventType = { TOUCH_END: 'touch-end' };
    constructor(name) { this.name = name; this.children = []; this.parts = new Map(); this.events = new Map(); this.x = 0; this.scale = 1; }
    getComponent(Type) { return this.parts.get(Type); }
    hasEventListener(type) { return this.events.has(type); }
    add(Type) { const part = new Type(); part.node = this; this.parts.set(Type, part); return part; }
    get worldScale() { return (this.parent?.worldScale ?? 1) * this.scale; }
    get worldX() { return (this.parent?.worldX ?? 0) + (this.parent?.worldScale ?? 1) * this.x; }
    contains(point) { return Math.abs(point - this.worldX) <= this.width * this.worldScale / 2; }
}
function authored(index) {
    const source = prefab[index], node = new Node(source._name);
    node.x = source._lpos.x;
    for (const ref of source._components) {
        const part = prefab[ref.__id__];
        if (part.__type__ === 'cc.UITransform') node.width = part._contentSize.width;
        if (part.__type__ === 'cc.Animation' && part._clips.some(c => c.__uuid__ === '4ae20895-4cab-4014-80e0-5bef8b3de0ac')) node.add(Animation);
    }
    node.children = source._children.map(ref => { const child = authored(ref.__id__); child.parent = node; return child; });
    return node;
}
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/UIAnimationBinding.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText, { exports: exports_, require: name => name === 'cc'
    ? { _decorator: { ccclass: () => Type => Type }, Component, Animation, Button, Node }
    : { WINDOW_OPEN_CLIPS: [] } });
const card = authored(prefab.findIndex(x => x.__type__ === 'cc.Node' && x._name === 'CityCard'));
const root = new Node('Screens'); root.children.push(card); card.parent = root;
const arrow = card.children.find(n => n.name === 'Cityaim');
const title = card.children.find(n => n.name === 'CityName');
let entered = 0; arrow.events.set(Node.EventType.TOUCH_END, () => entered++);
card.events.set(Node.EventType.TOUCH_END, () => entered++);
const binding = new exports_.UIAnimationBinding(); binding.node = root;
const originalCenter = arrow.worldX;
assert.ok(arrow.contains(originalCenter));
card.getComponent(Animation).play();
assert.equal(arrow.contains(originalCenter), false, 'The old parent press animation moves the arrow away from the stationary finger');
card.scale = 1; card.getComponent(Animation).plays = 0;
for (const point of [originalCenter, originalCenter - arrow.width / 2 + 1, originalCenter + arrow.width / 2 - 1]) {
    binding._onPress({ target: arrow });
    assert.equal(card.scale, 1, 'Independent arrow must not trigger parent card shrink');
    assert.ok(arrow.contains(point), 'Finger remains within the authored arrow hit box throughout the press');
    arrow.events.get(Node.EventType.TOUCH_END)();
}
assert.equal(entered, 3); assert.equal(card.getComponent(Animation).plays, 0);
const child = new Node('optional-arrow-art'); child.parent = arrow;
binding._onPress({ target: child }); assert.equal(card.getComponent(Animation).plays, 0, 'Nested art respects its interactive arrow boundary');
binding._onPress({ target: title }); assert.equal(card.getComponent(Animation).plays, 1, 'Body presses keep the authored card animation');
card.scale = 1;
arrow.add(Animation); binding._onPress({ target: arrow });
assert.equal(arrow.getComponent(Animation).plays, 1, 'An independently authored arrow animation remains supported');
assert.equal(card.scale, 1);
console.log('PASS chapter arrow: real prefab and 80% press clip reproduce lost hit; independent arrow center/edge/nested hits stay stable, body animation and authored arrow animation retained.');
