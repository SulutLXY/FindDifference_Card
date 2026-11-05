const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const index = read('assets/resources/configs/cities.json');
const legacy = read('assets/resources/configs/chapter-layout-legacy.json');
const audit = read('config/annual-hotmeme-merge-2026-11-02.json');
const key = audit.target, chapter = index.chapters[key];
assert.equal(chapter.name, '年度热梗'); assert.equal(chapter.levels.length, 55);
assert.deepEqual(chapter.levels.slice(0, 30).map(e => e.id), legacy[audit.legacyTarget]);
assert.deepEqual(chapter.levels.slice(30).map(e => e.id), legacy[audit.source]);
assert.equal(index.cities.length, 13); assert.equal(index.cities.includes(audit.source), false);
assert.equal(fs.existsSync('assets/Bundle/levels/' + audit.source), false);
for (const file of audit.preservedFiles) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file.destination)).digest('hex');
    assert.equal(actual, file.sha256, file.destination + ': image/metadata bytes changed');
    assert.equal(fs.existsSync(file.source), false);
}
const allIds = Object.values(index.chapters).flatMap(c => c.levels.map(e => e.id));
assert.equal(allIds.length, 325); assert.equal(new Set(allIds).size, 325);
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS } }).outputText;
const tree = ts.createSourceFile('flow.ts', fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['_loadCityMeta', 'findContinueTarget', 'isCityUnlocked', 'isLevelUnlocked', 'findNextLevel', '_nextLevelTarget', 'cityProgress'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Test {${body}};Test;`));
const storage = new Map(), exports_ = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: exports_, require: () => ({ sys: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } } }), console,
});
const { SaveService } = exports_;
(async () => {
    const f = new Flow(); f._cityIndex = index;
    f._cities = await Promise.all(index.cities.map(k => f._loadCityMeta(null, k)));
    const city = f._cities.find(c => c.key === key), ci = f._cities.indexOf(city);
    f._ensureLevel = async (c, i) => ({ key: c.levelIds[c.levels[i]] });
    f.save = new SaveService(); assert.equal(f.save.migrateContentLayout(f._cities, legacy), true);
    assert.equal(f.isLevelUnlocked(ci, 30), false, 'Fresh users cannot skip to the former 2025 entry');
    f.save.completeLevel(legacy[audit.legacyTarget][29], 3, 20);
    assert.equal(f.isLevelUnlocked(ci, 30), true, 'Winning last 2026 level opens first 2025 level');
    f._currentCity = city;
    assert.equal(f.findNextLevel({ key: legacy[audit.legacyTarget][29] }).levelIndex, 30);
    assert.equal(f.findNextLevel({ key: legacy[audit.source][24] }), null);
    storage.set('find-difference.save.v3', JSON.stringify({
        completed: { [legacy[audit.source][15]]: { stars: 2, bestTime: 19 } },
        lastPlayedCityKey: audit.source, lastPlayedLevelKey: legacy[audit.source][16],
        unlockedLevels: [legacy[audit.source][20]], freeHints: 8, foodReviews: {}, energy: 9,
    }));
    f.save = new SaveService(); assert.equal(f.save.migrateContentLayout(f._cities, legacy), true);
    assert.equal(f.save.data.lastPlayedCityKey, key); assert.equal(f.isLevelUnlocked(ci, 30), true);
    assert.equal(f.isLevelUnlocked(ci, 46), true); assert.equal(f.isLevelUnlocked(ci, 50), true);
    f._currentCity = null;
    const next = await f.findContinueTarget(); assert.equal(next.city.key, key); assert.equal(next.levelIndex, 46);
    assert.equal(f.save.progressOf(legacy[audit.source][15]).bestTime, 19);
    assert.equal(f.save.freeHints, 8); assert.equal(f.save.energy, 9);
    storage.set('find-difference.save.v3', JSON.stringify({ completed: {}, chapterRulesVersion: 2, lastPlayedCityKey: audit.source }));
    f.save = new SaveService(); assert.equal(f.save.migrateContentLayout(f._cities, legacy), true);
    const chapterOnly = await f.findContinueTarget();
    assert.equal(chapterOnly.city.key, key); assert.equal(chapterOnly.levelIndex, 30, 'Chapter-only old save starts at original 2025 entry');
    console.log('PASS: annual chapter 2026-first/2025-last, 55 ordered levels, 250 unchanged image/meta files, 325 unique IDs, boundary progression and old 2025 resume/unlocks.');
})().catch(error => { console.error(error); process.exitCode = 1; });
