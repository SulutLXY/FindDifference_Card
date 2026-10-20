const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
class Node {
    constructor(name, children = []) { this.name = name; this.children = children; this.handlers = []; this.isValid = true; this.activeInHierarchy = true; }
    getChildByName(name) { return this.children.find(n => n.name === name); }
    on(type, callback) { this.handlers.push(callback); }
    off(type, callback) { this.handlers = this.handlers.filter(handler => handler !== callback); }
    setSiblingIndex() {}
    getComponent() { return this.gift; }
}
class UIScreen {
    buttonTouchHandler(node, callback) { return callback; }
    findChildDeep(root, name) { return root.getChildByName(name) || root.children.map(child => this.findChildDeep(child, name)).find(Boolean); }
    open() { this.node.active = true; }
    resolveNode(bound, name) { return bound || this.findChildDeep(this.node, name); }
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
// Present settings without calling LobbyEntries.start: it must wire its own entries.
const settingsSource = fs.readFileSync('assets/scripts/ui/SettingsModal.ts', 'utf8');
const tree = ts.createSourceFile('SettingsModal.ts', settingsSource, ts.ScriptTarget.Latest, true);
const present = tree.statements.find(ts.isClassDeclaration).members.find(m => m.name?.getText(tree) === 'present').getText(tree);
const Settings = vm.runInNewContext(ts.transpileModule(`class Settings extends UIScreen { ${present} }; Settings;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText, { UIScreen, LobbyEntries: output.LobbyEntries, Toggle: class {} });
const settings = new Settings();
const buttons = ['Gameflow', 'Subscription', 'AddDesktop'].map(name => new Node(name));
const tool = new Node('moneyTool', buttons);
const host = new Node('Canvas'); host.getComponent = () => entries;
settings.node = new Node('Settings', [new Node('ResultCard', [tool])]);
settings.node.parent = host; host.children.push(settings.node);
settings.flow = { node: { parent: host }, save: { data: {} } };
// The host and gift remain usable while the lobby screen is hidden.
entries.flow.lobby.node.activeInHierarchy = false;
for (let visit = 0; visit < 3; visit++) {
    settings.present(true);
    assert.equal(tool.active, true);
    for (const button of buttons) { assert.equal(button.handlers.length, 1); button.handlers[0](); }
    settings.present(false);
    assert.equal(tool.active, false);
}
assert.equal(gifts, 5); assert.equal(subscriptions, 5); assert.equal(desktops, 5);
buttons.forEach(button => { button.handlers = []; });
settings.present(true);
for (const button of buttons) { assert.equal(button.handlers.length, 1, 'Presentation repairs removed listeners'); button.handlers[0](); }
assert.equal(gifts, 6); assert.equal(subscriptions, 6); assert.equal(desktops, 6);
console.log('PASS: win/lose and settings entries dispatch all three actions; hidden lobby, repeated presentations and removed listeners recover without duplicates.');
