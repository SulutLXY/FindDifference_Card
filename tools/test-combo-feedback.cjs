const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const source = fs.readFileSync('assets/scripts/ui/GameScreen.ts', 'utf8');
const body = source.slice(source.indexOf('    private _comboBox:'), source.indexOf('    /** 80×80错误图标'));
class Sprite {}
class Animation {}
class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }); } }
class UIOpacity {}
class Label { static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 }; static Overflow = { SHRINK: 1, NONE: 0 }; updateRenderData() {} }
class Color { static WHITE = 'white'; fromHEX(hex) { this.hex = hex; return this; } }
class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } static ONE = new Vec3(1, 1, 1); }
class Node {
    constructor(name) { this.name = name; this.isValid = true; this.active = true; this.components = new Map(); }
    setPosition(position) { this.position = position; } setScale() {}
    setRotationFromEuler(x, y, z) { this.angle = z; }
    addComponent(Type) { const component = new Type(); this.components.set(Type, component); return component; }
    getComponent(Type) { return this.components.get(Type); }
    destroy() { this.isValid = false; }
}
const tween = () => { const t = { to: () => t, by: () => t, delay: () => t, call: () => t, start: () => t }; return t; };
const GameScreen = vm.runInNewContext(ts.transpileModule(`class GameScreen { ${body} }; GameScreen;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, { Node, Sprite, Animation, AnimationClip: { WrapMode: { Normal: 1 } }, Label, Color,
    Vec3, UITransform, UIOpacity, tween, Tween: { stopAllByTarget() {} }, console,
    DifferenceController: {
        normalizedToLocal: (d, w, h) => ({ x: (d.x - 0.5) * w, y: (0.5 - d.y) * h }),
        radiusToLocal: (d, w, h) => d.radius * Math.min(w, h),
    } });

(async () => {
    const screen = new GameScreen();
    screen.isValid = true;
    screen.node = { activeInHierarchy: true, layer: 7 };
    let played = 0, scheduled = 0, close;
    const state = {};
    const animation = { isValid: true, clips: [{ name: 'one' }, { name: 'two' }], stop() {},
        play() { played++; }, getState: () => state };
    const sprite = { isValid: true };
    const box = { isValid: true, active: false, setRotationFromEuler(x, y, z) { assert.ok(z >= -10 && z <= 10); } };
    const tips = { getComponent: Type => Type === Sprite ? sprite : animation };
    screen.findChildDeep = (_, name) => name === 'ComboTipsBox' ? box : tips;
    screen.unschedule = () => {};
    screen.scheduleOnce = (callback, seconds) => { assert.equal(seconds, 1); scheduled++; close = () => callback.call(screen); };
    screen._loadComboFrames = () => Promise.resolve(['01', '02', '03']);
    screen.showSuccessFx(4);
    const text = screen._successText;
    const label = text.getComponent(Label);
    assert.ok(['夯爆了', '这波很顶', '牛来！', '狠狠拿捏', '直接拉满！', '绝绝子~'].some(text => label.string === `${text}  x4`));
    assert.ok([28, 32, 36].includes(label.fontSize));
    assert.ok(['ff9800', 'ff348a', 'ff0404', '2ebf01', '6c5df8', 'f358f9'].includes(label.color.hex));
    assert.equal(label.enableOutline, true); assert.equal(label.outlineWidth, 2); assert.equal(label.outlineColor, 'white');
    assert.ok(text.angle >= -15 && text.angle <= 15);
    // 图坐标通过世界坐标换算到 Game；点击下图时使用下图的位置，放大后也正确。
    screen.node.getComponent = () => ({ convertToNodeSpaceAR: p => p });
    screen._imageSize = () => ({ width: 600, height: 400 });
    const image = offset => ({ getComponent: () => ({
        convertToWorldSpaceAR: p => new Vec3(p.x * 1.5 + 20, p.y * 1.5 + offset, 0),
    }) });
    const difference = { x: 0.6, y: 0.5, radius: 0.05 };
    const above = screen._successTextPosition(difference, image(300), 100, 40, 15);
    const below = screen._successTextPosition(difference, image(-300), 100, 40, -15);
    assert.ok(Math.abs(above.x - 110) < 1e-6); assert.ok(Math.abs(below.x - 110) < 1e-6);
    assert.ok(above.y > 300); assert.ok(Math.abs(above.y - below.y - 600) < 1e-6);
    const edge = screen._successTextPosition({ x: 0, y: 0, radius: 0.05 }, image(0), 100, 40, 15);
    assert.ok(edge.x > -430 && edge.y < 300, 'Edge feedback stays inside image bounds');
    screen.showSuccessFx(5); await Promise.resolve();
    assert.equal(box.active, true); assert.equal(text.active, false); assert.equal(screen._successText, null);
    assert.equal(state.repeatCount, 1); assert.equal(played, 1);
    screen.showSuccessFx(6); screen.showSuccessFx(7); await Promise.resolve();
    assert.equal(scheduled, 1, 'New hits must not extend the one-second display');
    assert.equal(played, 1); assert.equal(screen._successText, null);
    close(); assert.equal(box.active, false);
    screen.showSuccessFx(1); assert.ok(['Good', '不错！', '答对了！'].includes(screen._successText.getComponent(Label).string));
    screen.showSuccessFx(2); assert.ok(['有一手~', 'Great', '漂亮！', '好眼力~'].some(text => screen._successText.getComponent(Label).string === `${text}  x2`));
    screen.showSuccessFx(3); assert.ok(['夯爆了', '这波很顶', '牛来！', '狠狠拿捏', '直接拉满！', '绝绝子~'].some(text => screen._successText.getComponent(Label).string === `${text}  x3`));
    screen.showSuccessFx(5); screen._hideComboTips(); await Promise.resolve();
    assert.equal(box.active, false, 'Closing the game cancels pending feedback');

    const flowSource = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
    const tree = ts.createSourceFile('GameFlow.ts', flowSource, ts.ScriptTarget.Latest, true);
    const cls = tree.statements.find(ts.isClassDeclaration);
    const methods = cls.members.filter(m => ['COMBO_WINDOW_MS', 'TOP_COMBO_WINDOW_MS', 'onDifferenceFound'].includes(m.name?.getText(tree)))
        .map(m => m.getText(tree)).join('\n');
    let now = 0;
    const Flow = vm.runInNewContext(ts.transpileModule(`class GameFlow { ${methods} }; GameFlow;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, { Date: { now: () => now } });
    const flow = new Flow();
    flow._foundIds = new Set(); flow._currentLevel = { differences: new Array(20) }; flow._combo = 0;
    flow._lastFoundAt = -10000; flow._elapsedTime = 0; flow.playSuccessTone = flow.playRightSound = () => {};
    flow.onDifferenceFound({ id: 'a' }); assert.equal(flow._combo, 1);
    now = 5000; flow.onDifferenceFound({ id: 'b' }); assert.equal(flow._combo, 2);
    now = 10001; flow.onDifferenceFound({ id: 'c' }); assert.equal(flow._combo, 1);
    flow.onDifferenceFound({ id: 'c' }); assert.equal(flow._combo, 1, 'Duplicate finds must not add combos');
    flow._combo = 4; flow._lastFoundAt = now;
    now += 3500; flow.onDifferenceFound({ id: 'd' }); assert.equal(flow._combo, 5);
    now += 3501; flow.onDifferenceFound({ id: 'e' }); assert.equal(flow._combo, 1);
    flow._combo = 4; flow._lastFoundAt = now;
    now += 4000; flow.onDifferenceFound({ id: 'f' }); assert.equal(flow._combo, 1, 'Entering top tier also requires 3.5 seconds');
    console.log('PASS: regular/top combo boundaries, hit-circle positioning across images/zoom, random text rotation, exclusive display, strict one-second timeout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
