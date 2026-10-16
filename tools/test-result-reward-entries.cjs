const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Node {
    constructor(name, children = []) { this.name = name; this.children = children; this.handlers = []; this.isValid = true; this.activeInHierarchy = true; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    on(type, callback) { this.handlers.push(callback); }
    getComponent() { return this.gift; }
}
class UIScreen {
    buttonTouchHandler(node, callback) { return callback; }
    findChildDeep(root, name) { return root.getChildByName(name) || root.children.map(child => this.findChildDeep(child, name)).find(Boolean); }
}
const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/ui/LobbyEntries.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018, experimentalDecorators: true },
}).outputText, { exports: output, require: name => name === 'cc' ? {
    _decorator: { ccclass: () => Type => Type }, Input: { EventType: { TOUCH_END: 'touch' } },
} : name === './UIScreen' ? { UIScreen } : {} });
const entries = new output.LobbyEntries();
let gifts = 0, subscriptions = 0, desktops = 0;
const gift = { openGift() { gifts++; } };
const lobbyEntry = new Node('Gameflow'); lobbyEntry.gift = gift;
entries.flow = { lobby: { node: new Node('Lobby', [lobbyEntry]) } };
entries._openSubscription = () => { subscriptions++; };
entries._openDesktop = () => { desktops++; };
for (const outcome of ['win', 'lose']) {
    const buttons = ['Gameflow', 'Subscription', 'AddDesktop'].map(name => new Node(name));
    const modal = new Node(outcome, [new Node('moneyTool', buttons)]);
    entries.bindRewardEntries(modal);
    entries.bindRewardEntries(modal);
    for (const button of buttons) { assert.equal(button.handlers.length, 1, 'Repeated presentation must not duplicate callbacks'); button.handlers[0](); }
}
assert.equal(gifts, 2); assert.equal(subscriptions, 2); assert.equal(desktops, 2);
console.log('PASS: dynamically created win/lose reward entries bind once and all three buttons dispatch.');
