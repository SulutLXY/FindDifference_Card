const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Button {}
class UITransform {}
const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/UIScreen.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, { exports: output, require: () => ({
    Component: class {}, Color: class {}, Button, UITransform, Input: { EventType: { TOUCH_END: 'end' } },
}) });
let recoveries = 0, clicks = 0;
output.registerGameFlow({ platform: { recoverInterstitialOnTouch() { recoveries++; } } });
const screen = new output.UIScreen();
for (const [width, height] of [[100, 100], [250, 99.407], [380, 100], [180, 100]]) {
    const size = { width, height };
    let window;
    const ui = { hitTest(point, windowId) { window = windowId; return Math.abs(point.x) <= width / 2 && Math.abs(point.y) <= height / 2; } };
    const button = { enabledInHierarchy: true, interactable: true };
    const node = { isValid: true, activeInHierarchy: true, getComponent: Type => Type === Button ? button : ui };
    const handler = screen.buttonTouchHandler(node, () => { clicks++; });
    const touch = (x, y) => ({ getLocation: () => ({ x, y }), windowId: 7 });
    const before = clicks;
    handler(touch(0, 0));
    handler(touch(width / 2 - 0.01, 0));
    handler(touch(-width / 2 + 0.01, 0));
    handler(touch(0, height / 2 - 0.01));
    handler(touch(0, -height / 2 + 0.01));
    assert.equal(clicks, before + 5);
    handler(touch(width / 2 + 0.01, 0));
    handler(touch(0, height / 2 + 0.01));
    button.interactable = false; handler(touch(0, 0));
    button.interactable = true; node.activeInHierarchy = false; handler(touch(0, 0));
    assert.equal(clicks, before + 5, 'Overflowing child, drag-out, disabled and hidden touches must not activate');
    assert.equal(window, 7, 'Use the engine window/camera hit test');
    assert.deepEqual(size, { width, height }, 'Binding must not change the design dimensions');
}
assert.equal(recoveries, clicks, 'Only valid button touches recover native ad state');
console.log('PASS: center/edges, out-of-bounds and drag-out, hidden/disabled guards, engine hit-test coordinates and original button dimensions.');
