'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const core = {}; vm.runInNewContext(compile(fs.readFileSync('assets/scripts/core/PlayStats.ts', 'utf8')), { exports: core });
const source = fs.readFileSync('assets/scripts/ui/CitySelectScreen.ts', 'utf8'), tree = ts.createSourceFile('Screen.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_setHeatBadge', '_refreshHeat'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
class Label { static Overflow = { SHRINK: 1 }; } class Sprite { static SizeMode = { CUSTOM: 0 }; }
class Node {
    constructor(name, children = []) { this.name = name; this.children = children; this.parts = new Map(); this.active = this.isValid = true; }
    getComponent(type) { return this.parts.get(type); }
}
function card() {
    const label = new Node('HotNumber_laber'); label.parts.set(Label, { string: '9999K' });
    const icon = new Node('icon_fire'); icon.parts.set(Sprite, { spriteFrame: 'fire' });
    const badge = new Node('HotNumber', [label, icon]); badge.parts.set(Sprite, { spriteFrame: 'red' });
    return { node: new Node('card', [badge]), badge, label: label.parts.get(Label), icon: icon.parts.get(Sprite), background: badge.parts.get(Sprite) };
}
const Screen = vm.runInNewContext(compile('class Screen {' + body + '}; Screen;'), { Label, Sprite, formatPlayCount: core.formatPlayCount, console });
const s = new Screen(); s.isValid = true; s.node = { activeInHierarchy: true }; s._heatVersion = 0;
s.newChapterIcon = 'leaf'; s.newChapterBackground = 'green';
s.findChildDeep = function find(node, name) { return node.children.find(n => n.name === name) || node.children.map(n => find(n, name)).find(Boolean); };
const pending = [];
s.flow = { chapterSelections: [{ key: 'wang-luo-re-dian' }, { key: 'qing-hua-ci' }], playStats: {
    initialCount: key => key === 'wang-luo-re-dian' ? 219500 : null,
    isNewChapter: key => key === 'qing-hua-ci', getCounts: keys => new Promise(resolve => pending.push({ keys, resolve })),
} };
(async () => {
    const hot = card(), leaf = card(), unknown = card();
    s._setHeatBadge(hot.node, 'wang-luo-re-dian', 219500); assert.equal(hot.label.string, '219.5K'); assert.equal(hot.badge.active, true);
    s._setHeatBadge(leaf.node, 'qing-hua-ci', 999); assert.equal(leaf.label.string, '最新章节');
    assert.equal(leaf.icon.spriteFrame, 'leaf'); assert.equal(leaf.background.spriteFrame, 'green');
    assert.equal(leaf.label.enableWrapText, false); assert.equal(leaf.label.overflow, Label.Overflow.SHRINK);
    s._setHeatBadge(unknown.node, 'unknown', null); assert.equal(unknown.badge.active, false); assert.equal(unknown.label.string, '');
    s._setHeatBadge(new Node('missing'), 'unknown', null);
    s._cards = [hot.node, leaf.node]; const stale = s._refreshHeat();
    assert.deepEqual(Array.from(pending[0].keys), ['wang-luo-re-dian'], 'New chapter uses its presentation instead of a count request');
    s._heatVersion++; pending[0].resolve({ 'wang-luo-re-dian': 999 }); await stale;
    assert.equal(hot.label.string, '219.5K', 'Stale page result must not replace the current badge');
    const update = s._refreshHeat(); pending[1].resolve({ 'wang-luo-re-dian': 219510 }); await update;
    assert.equal(hot.label.string, '219.51K'); assert.equal(leaf.label.string, '最新章节');
    const missing = s._refreshHeat(); pending[2].resolve({}); await missing;
    assert.equal(hot.label.string, '219.5K'); assert.equal(hot.badge.active, true,
        'A missing asynchronous count must not erase a configured release baseline');
    const index = JSON.parse(fs.readFileSync('assets/resources/configs/cities.json'));
    assert.deepEqual(index.navigation, ['wang-luo-re-dian','qing-hua-ci','nian-du-re-geng','chong-wu-gu-shi','meng-chong-san-guo','lian-ai-mei-shi']);
    assert.equal(index.cities[1], 'qing-hua-ci');
    const prefab = JSON.parse(fs.readFileSync('assets/LobbySources/prefabs/CitySelectScreen.prefab'));
    const component = prefab.find(item => 'cardTemplate' in item);
    assert.equal(component.newChapterIcon.__uuid__, '6ea44f0e-cd19-4051-a3ea-1661be24129b@f9941');
    assert.equal(component.newChapterBackground.__uuid__, 'a7afceef-e0c5-43b0-b6d8-1612e6d19dcf@f9941');
    assert.ok(!prefab.some(item => item._string === '9999K'));
    console.log('PASS HotNumber: release baselines/formatting, new leaf/green badge, optional nodes, stale responses and new chapter ordering');
})().catch(error => { console.error(error); process.exitCode = 1; });
