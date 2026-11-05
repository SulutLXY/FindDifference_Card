const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const audit = read('config/named-layout-migration-2026-11-02.json');
const index = read('assets/resources/configs/cities.json');
assert.equal(audit.chapters.length, 12);
assert.deepEqual(index.cities.slice(0, audit.chapters.length), audit.chapters.map(c => c.target));
for (const file of audit.preservedFiles) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.destination)).digest('hex'), file.sha256, file.destination);
}
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText;
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_loadCityMeta', '_loadLevel', '_timeFor', 'isCityUnlocked', 'isLevelUnlocked', 'findContinueTarget', '_nextLevelTarget'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Test {${body}};Test;`));
const storage = new Map(), saveModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: saveModule, console, require: () => ({ sys: { localStorage: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
} } }) });
(async () => {
    const f = new Flow(); f._cityIndex = index; f._grades = read('assets/resources/configs/levels.json');
    f._contentBundles = { use: async (name, callback) => callback({ name }) };
    f._loadBundleJson = async (bundle, path) => ({ json: read(`assets/Bundle/levels/${bundle.name}/${path}.json`), decRef() {} });
    let total = 0;
    for (const chapter of audit.chapters) {
        const root = `assets/Bundle/levels/${chapter.target}`;
        assert.equal(fs.existsSync(`assets/Bundle/levels/${chapter.source}`), false);
        const meta = read(root + '.meta');
        assert.equal(meta.uuid, chapter.rootUuid); assert.equal(meta.userData.bundleName, chapter.target);
        const city = await f._loadCityMeta(null, chapter.target);
        const originalIds = new Set(chapter.levels.map(e => e.id));
        assert.deepEqual(Array.from(city.levels).filter(folder => originalIds.has(city.levelIds[folder])), chapter.levels.map(e => e.folder));
        assert.ok(!fs.readdirSync(root).some(name => /^level-\d/.test(name)), root);
        for (const entry of chapter.levels) {
            const level = await f._loadLevel(null, chapter.target, entry.folder); total++;
            assert.equal(level.key, entry.id); assert.equal(level.name, entry.name);
            assert.equal(crypto.createHash('sha256').update(JSON.stringify(level.differences)).digest('hex'), entry.differencesSha256, entry.id + ': annotations changed');
            for (const kind of ['configs', 'thumbnails', '']) {
                assert.equal(fs.existsSync(`${root}/${kind ? kind + '/' : ''}${entry.folder}`), true);
            }
        }
    }
    assert.equal(total, 255);
    f._cities = await Promise.all(index.cities.map(key => f._loadCityMeta(null, key)));
    const frozen = read('assets/resources/configs/chapter-layout-legacy.json');
    const rules = read('assets/resources/configs/chapter-rules.json');
    for (const chapter of audit.chapters) {
        const first = chapter.levels[0].id, next = chapter.levels[1].id;
        storage.clear(); storage.set('find-difference.save.v3', JSON.stringify({
            completed: { [first]: { stars: 2, bestTime: 17 } },
            unlockedCities: [chapter.source], lastPlayedCityKey: chapter.source,
            lastPlayedLevelKey: next, freeHints: 7,
        }));
        f.save = new saveModule.SaveService();
        assert.equal(f.save.migrateChapterRules(rules, f._cities), true);
        assert.equal(f.save.migrateContentLayout(f._cities, frozen), true);
        assert.equal(f.save.data.lastPlayedCityKey, chapter.target);
        f._ensureLevel = async (city, i) => ({ key: city.levelIds[city.levels[i]] });
        const target = await f.findContinueTarget();
        assert.equal(target.city.key, chapter.target); assert.equal(target.level.key, next);
        assert.equal(f.save.progressOf(first).bestTime, 17); assert.equal(f.save.freeHints, 7);
    }
    console.log(`PASS: original 12 chapter renames and 255 levels preserved among current 13 chapters, ${audit.preservedFiles.length} unchanged image/meta files, bundle UUIDs and original differences/stable IDs.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
