'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText;
function methods(file, names, globals = {}) {
    const source = fs.readFileSync(file, 'utf8'), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree)))
        .map(m => m.getText(tree)).join('\n');
    return vm.runInNewContext(compile(`class Test {${body}}; Test;`), globals);
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
class Label { static Overflow = { SHRINK: 1 }; }
class Sprite { static SizeMode = { CUSTOM: 0 }; }
class Node {
    constructor(name, children = []) {
        this.name = name; this.children = children; this.parts = new Map(); this.active = this.isValid = true;
        this.position = {x: 12, y: 34}; this.size = {width: 31, height: 39};
    }
    getComponent(Type) { return this.parts.get(Type); }
}
function card() {
    const label = new Node('HotNumber_laber'); label.parts.set(Label, {string: '9999K'});
    const icon = new Node('icon_fire'); icon.parts.set(Sprite, {spriteFrame: 'fire'});
    const badge = new Node('HotNumber', [label, icon]); badge.parts.set(Sprite, {spriteFrame: 'red'});
    return {node: new Node('card', [badge]), badge, iconNode: icon, label: label.parts.get(Label),
        icon: icon.parts.get(Sprite), background: badge.parts.get(Sprite)};
}
const Screen = methods('assets/scripts/ui/CitySelectScreen.ts', ['_setChapterBadge'], {Label, Sprite});
const Flow = methods('assets/scripts/GameFlow.ts', ['chapterBadgeKind']);
const flow = new Flow();
flow._cityIndex = read('assets/resources/configs/cities.json');
flow._cityIndex.badges.testHard = 'hard';
flow._cityIndex.badges.testNone = null;
flow._cityIndex.badges.testInvalid = 'unknown-kind';
Object.defineProperty(flow, 'playStats', {get() { throw Error('Chapter tags must never access statistics'); }});
const screen = new Screen();
screen.flow = flow;
screen.findChildDeep = function find(node, name) {
    return node.children.find(child => child.name === name) || node.children.map(child => find(child, name)).find(Boolean);
};
Object.assign(screen, {newChapterIcon: 'leaf', newChapterBackground: 'green', hotChapterIcon: 'fire',
    hardChapterIcon: 'skull', hotChapterBackground: 'red', collectionChapterIcon: 'chest', collectionChapterBackground: 'blue'});
const shared = card();
for (const [key, text, icon, background] of [
    ['qing-hua-ci', '新章节', 'leaf', 'green'], ['wang-luo-re-dian', '热门', 'fire', 'red'],
    ['meng-chong-san-guo', '困难', 'skull', 'red'], ['testHard', '困难', 'skull', 'red'],
    ['lian-ai-mei-shi', '收藏', 'chest', 'blue'],
]) {
    screen._setChapterBadge(shared.node, key);
    assert.equal(shared.badge.active, true);
    assert.equal(shared.label.string, text);
    assert.equal(shared.icon.spriteFrame, icon);
    assert.equal(shared.background.spriteFrame, background);
    assert.equal(shared.label.enableWrapText, false);
    assert.deepEqual(shared.iconNode.position, {x: 12, y: 34});
    assert.deepEqual(shared.iconNode.size, {width: 31, height: 39}, 'Preserve editor-authored geometry');
}
for (const key of ['missing', 'testNone', 'testInvalid', 'chong-wu-gu-shi', 'nian-du-re-geng',
    'bei-jing', 'shang-hai', 'nan-jing', 'xia-men', 'chang-sha', 'guang-zhou', 'cheng-du', 'xi-an']) {
    screen._setChapterBadge(shared.node, key);
    assert.equal(shared.badge.active, false);
    assert.equal(shared.label.string, '');
}
assert.doesNotThrow(() => screen._setChapterBadge(new Node('no badge'), 'qing-hua-ci'));
screen.hardChapterIcon = null;
screen._setChapterBadge(shared.node, 'testHard');
assert.equal(shared.badge.active, false, 'Missing required art cannot leave a stale mismatched icon');
const prefab = read('assets/LobbySources/prefabs/CitySelectScreen.prefab');
const component = prefab.find(item => 'newChapterIcon' in item);
for (const [field, name] of Object.entries({newChapterIcon: 'leaf', newChapterBackground: 'Mark_green',
    hotChapterIcon: 'fire', hardChapterIcon: 'skull', hotChapterBackground: 'Mark_red',
    collectionChapterIcon: 'chest', collectionChapterBackground: 'Mark_blue'})) {
    const meta = read(`assets/LobbySources/textures/UI_Sprite/icons/icon_${name}.png.meta`);
    assert.equal(component[field].__uuid__, meta.subMetas.f9941.uuid, field);
}
const source = fs.readFileSync('assets/scripts/ui/CitySelectScreen.ts', 'utf8');
assert.doesNotMatch(source, /playStats|formatPlayCount|_refreshHeat|initialCount|getCounts/);
const flowSource = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
assert.doesNotMatch(flowSource, /PlayStatsService|playStats\??\./, 'Retain algorithms but disconnect gameplay uploads/configuration');
assert.ok(fs.existsSync('assets/scripts/core/PlayStats.ts'));
assert.ok(fs.existsSync('assets/scripts/services/PlayStatsService.ts'));
assert.equal(read('assets/resources/configs/platform-config.json').playStats.enabled, false);
console.log('PASS chapter tags: all four icon/background pairs, manual configuration, type transitions, optional nodes, geometry, serialized art, no heat requests or gameplay uploads; algorithms retained.');
