const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
function load(path, names, globals = {}) {
    const text = fs.readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const body = ast.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(ast)))
        .map(m => m.getText(ast)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Test {${body}}; Test;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2018 },
    }).outputText, globals);
}
class Label {}
const prefab = JSON.parse(fs.readFileSync('assets/PleyGame/prefabs/ResultModal.prefab', 'utf8'));
const byIndex = new Map();
function node(index) {
    if (byIndex.has(index)) return byIndex.get(index);
    const data = prefab[index], labels = data._components.map(c => prefab[c.__id__]).filter(c => c.__type__ === 'cc.Label');
    const label = labels.length ? { string: labels[0]._string, color: JSON.stringify(labels[0]._color) } : null;
    const value = { name: data._name, isValid: true, active: data._active, children: [],
        getComponent(Type) { return Type === Label ? label : null; },
        getComponentInChildren(Type) { return this.getComponent(Type) ?? this.children.map(c => c.getComponentInChildren(Type)).find(Boolean); } };
    byIndex.set(index, value);
    value.children = data._children.map(c => node(c.__id__));
    return value;
}
function find(root, name) {
    return root.children.find(n => n.name === name) ?? root.children.map(n => find(n, name)).find(Boolean) ?? null;
}
const Modal = load('assets/scripts/ui/ResultModal.ts', ['present', '_refreshResultDetails', '_refreshShareVisibility', '_shareVersion'], { Label });
const modal = new Modal(); modal.node = node(prefab[0].data.__id__); modal.isValid = true;
modal.flow = { node: { parent: null }, reviveBonusSeconds: 30, platform: { supportsSharing: true } };
modal.findChildDeep = find;
modal.resolveNode = (bound, path) => bound ?? path.split('/').reduce((root, name) => root && find(root, name), modal.node);
modal.open = () => { modal.node.active = true; };
modal._stopRevivePulse = modal._startRevivePulse = () => {};
const text = (root, name) => find(root, name).getComponentInChildren(Label).string;
const title = find(modal.node, 'Title'), summary = find(modal.node, 'Summary');
const lost = find(title, 'Lose'), won = find(title, 'WIN');
const details = find(modal.node, 'level_card_selected');
const found = find(details, 'icon_fangda'), time = find(details, 'icon_Time');
const titleColor = title.getComponent(Label).color;
const level = { differences: Array.from({ length: 12 }, () => ({})), type: 'normal', key: 'test', timeLimit: 150 };
const fail = { win: false, stars: 0, elapsedSeconds: 78, foundCount: 10, failReason: 'lives', level, canRevive: true, hasNext: false };
modal.present(fail);
assert.equal(won.active, false); assert.equal(lost.active, true); assert.equal(summary.active, true);
for (let i = 1; i <= 3; i++) {
    const greyStar = find(summary, `icon_starL-00${i}`);
    assert.equal(greyStar.active, true, 'Failure keeps the grey stars visible');
    assert.equal(find(greyStar, 'icon_starW').active, false, 'Failure has no earned gold stars');
}
const summaryAsset = prefab.find(n => n.__type__ === 'cc.Node' && n._name === 'Summary');
const starAnimation = summaryAsset._components.map(c => prefab[c.__id__]).find(c => c.__type__ === 'cc.Animation');
assert.ok(starAnimation?._clips.some(clip => clip.__uuid__ === '7b08a7e6-5871-4498-9eb0-dc5de0439e6a'), 'Keep the authored star entrance animation');
assert.equal(title.getComponent(Label).string, ''); assert.equal(summary.getComponent(Label).string, '');
assert.equal(text(lost, 'Number'), '2'); assert.equal(text(lost, 'Label-002'), '生命耗尽，复活可保留游玩进度');
assert.equal(text(found, 'Number'), '10/12'); assert.equal(text(found, 'tips_found'), '已找到');
assert.equal(text(time, 'tips_Time'), '复活增加'); assert.equal(text(time, 'Time'), '30秒');
assert.equal(find(modal.node, 'BtnRevive').active, true); assert.equal(find(modal.node, 'BtnShare').active, false);
modal.present({ ...fail, win: true, foundCount: 12, stars: 2, hasNext: true });
assert.equal(won.active, true); assert.equal(lost.active, false); assert.equal(summary.active, true);
assert.equal(text(found, 'Number'), '12/12'); assert.equal(text(found, 'tips_found'), '找到');
assert.equal(text(time, 'tips_Time'), '用时'); assert.equal(text(time, 'Time'), '01:18');
assert.equal(find(modal.node, 'BtnRevive').active, false); assert.equal(find(modal.node, 'BtnShare').active, true);
assert.equal(text(modal.node, 'BtnPrimary'), '下一关');
for (let i = 1; i <= 3; i++) assert.equal(find(find(summary, `icon_starL-00${i}`), 'icon_starW').active, i <= 2);
modal.present({ ...fail, failReason: 'time', foundCount: 7 });
assert.equal(text(lost, 'Number'), '5'); assert.equal(text(lost, 'Label-002'), '时间到，复活可保留游玩进度');
assert.equal(text(time, 'Time'), '30秒'); assert.equal(text(found, 'Number'), '7/12');
modal.present({ ...fail, canRevive: false });
assert.equal(summary.active, true, 'Exhausted revival also keeps the star animation area');
assert.equal(find(modal.node, 'BtnRevive').active, false); assert.equal(find(modal.node, 'BtnShare').active, false);
assert.equal(text(lost, 'Label-002'), '生命耗尽，本局复活机会已用完');
assert.equal(text(time, 'tips_Time'), '复活已用完'); assert.equal(text(time, 'Time'), '—');
assert.equal(title.getComponent(Label).color, titleColor, 'Keep authored styles');
assert.equal(text(modal.node, 'BtnRevive'), '复活'); assert.equal(text(modal.node, 'BtnHome'), '返回主页');

// Verify actual game-over payloads carry failure reason and the current round's found count.
const Flow = load('assets/scripts/GameFlow.ts', ['finishLevel']);
const flow = new Flow(); let payload;
Object.assign(flow, { isValid: true, _currentLevel: level, _foundIds: new Set(Array.from({ length: 10 }, (_, i) => i)),
    _elapsedTime: 78, _remainingTime: 0, _reviveUsed: false, _foods: [],
    save: { isCompleted: () => false, completeLevel() {} }, rankProvider: { submitScore() {} },
    platform: { onRoundFinished() {} }, resultModal: { present(value) { payload = value; } },
    _playResultTone() {}, findNextLevel: () => null });
for (const reason of ['time', 'lives']) {
    flow._isGameOver = false; flow.finishLevel(false, reason);
    assert.equal(payload.failReason, reason); assert.equal(payload.foundCount, 10); assert.equal(payload.canRevive, true);
}
flow._isGameOver = false; flow._reviveUsed = true; flow.finishLevel(false, 'lives');
assert.equal(payload.canRevive, false);
console.log('PASS result details: actual prefab success/failure titles, remaining/found counts, MM:SS time, +30s preview, failure causes, exhausted revival, stars, buttons, reuse and actual finish payloads.');
