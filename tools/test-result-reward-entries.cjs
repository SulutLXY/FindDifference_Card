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
    assert.equal(tool.active, true, 'Home settings must also show the reward entries');
    for (const button of buttons) { assert.equal(button.handlers.length, 1); button.handlers[0](); }
}
assert.equal(gifts, 8); assert.equal(subscriptions, 8); assert.equal(desktops, 8);
buttons.forEach(button => { button.handlers = []; });
settings.present(true);
for (const button of buttons) { assert.equal(button.handlers.length, 1, 'Presentation repairs removed listeners'); button.handlers[0](); }
assert.equal(gifts, 9); assert.equal(subscriptions, 9); assert.equal(desktops, 9);
const prefab = JSON.parse(fs.readFileSync('assets/PleyGame/prefabs/GameplaySupport.prefab', 'utf8'));
const settingsNode = prefab.find(n => n.__type__ === 'cc.Node' && n._name === 'Settings');
function find(root, name) {
    const children = (root._children || []).map(ref => prefab[ref.__id__]);
    return children.find(node => node._name === name) || children.map(node => find(node, name)).find(Boolean);
}
const actualTool = find(settingsNode, 'moneyTool');
const actualButtons = actualTool._children.map(ref => prefab[ref.__id__]).sort((a, b) => a._lpos.x - b._lpos.x);
assert.deepEqual(actualButtons.map(node => node._name), ['Gameflow', 'AddDesktop', 'Subscription']);
assert.ok(actualButtons.every(node => node._active), 'All three authored icons are enabled');
const texts = actualButtons.map(node => {
    const label = find(node, 'Label');
    return label._components.map(ref => prefab[ref.__id__]).find(c => c.__type__ === 'cc.Label')._string;
});
assert.deepEqual(texts, ['入口有奖', '添加桌面', '订阅']);
console.log('PASS: win/lose and home/in-game settings dispatch all three actions, authored left-to-right order and text, hidden lobby, repeated presentations and listener recovery without duplicates.');
