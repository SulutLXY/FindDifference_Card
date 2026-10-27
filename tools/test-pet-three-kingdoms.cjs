const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText;
const index = read('assets/resources/configs/cities.json');
const sourceMap = read('config/pet-three-kingdoms-source-map.json');
const key = 'city-PetThreeKingdoms', root = `assets/Bundle/levels/${key}`;
assert.equal(sourceMap.chapter, key); assert.equal(sourceMap.levels.length, 30);
assert.deepEqual(sourceMap.missingConfigurations, []);
assert.equal(index.cities.indexOf(key), index.cities.indexOf('city-PetStory') + 1);
assert.equal(index.cities[index.cities.indexOf(key) + 1], 'city-2025Hotmeme');
const chapterSource = read(`${root}/configs/city.json`);
delete chapterSource.unlockMode; delete chapterSource.prerequisiteCity;
assert.deepEqual(index.chapters[key], { key, ...chapterSource });
assert.equal(index.chapters[key].name, '萌宠三国');
assert.deepEqual(index.chapters[key].levels, Array.from({ length: 30 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}`));
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const cls = tree.statements.find(ts.isClassDeclaration);
const names = ['_loadCityMeta', '_loadLevel', '_timeFor', '_levelImageTarget', '_chapterSpriteTarget',
    '_nextLevelTarget', 'isCityUnlocked', 'isLevelUnlocked'];
const body = cls.members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow { ${body} }; Flow;`));
const flow = new Flow(); flow._cityIndex = index;
flow._grades = read('assets/resources/configs/levels.json');
flow._contentBundles = { use: async (name, action) => action({ name }) };
flow._loadBundleJson = async (bundle, request) => ({ json: read(`assets/Bundle/levels/${bundle.name}/${request}.json`), decRef() {} });
function imageMeta(file, width, height) {
    const meta = read(file + '.meta');
    const frame = Object.values(meta.subMetas).find(m => m.importer === 'sprite-frame');
    assert.ok(frame); assert.equal(frame.userData.rawWidth, width); assert.equal(frame.userData.rawHeight, height);
    return meta;
}
(async () => {
    const city = await flow._loadCityMeta(null, key); flow._cities = [city];
    const completed = new Set(), unlocked = new Set();
    flow.save = { isCompleted: k => completed.has(k), isLevelUnlocked: k => unlocked.has(k) };
    assert.equal(flow.isCityUnlocked(0), true); assert.equal(flow.isLevelUnlocked(0, 0), true);
    let total = 0;
    for (const [i, dir] of city.levels.entries()) {
        const row = sourceMap.levels[i]; assert.equal(row.number, i + 1); assert.equal(row.level, dir);
        assert.equal(Number(row.sourceFolder.match(/^\d+/)[0]), i + 1);
        const level = await flow._loadLevel(null, key, dir);
        assert.equal(level.name, row.name); assert.equal(level.type, 'normal');
        assert.equal(level.differences.length, row.differenceCount); total += level.differences.length;
        assert.equal(level.icon, `thumbnails/${key}/${dir}/icon/spriteFrame`);
        const configPath = `${root}/configs/${dir}/differences.json`;
        assert.equal(read(configPath + '.meta').importer, 'json');
        const original = path.join(sourceMap.source, row.sourceFolder, 'differences.json');
        if (fs.existsSync(original)) {
            assert.equal(hash(original), row.configSha256);
            const imported = read(configPath); delete imported.icon;
            assert.deepEqual(imported, read(original), `${dir}: source configuration must remain unchanged`);
        }
        for (const [field, name] of [['topImage', 'scene-a.jpg'], ['bottomImage', 'scene-b.jpg']]) {
            assert.equal(level[field], `levels/${key}/${dir}/${name.replace('.jpg', '')}/spriteFrame`);
            const target = flow._chapterSpriteTarget(level[field]);
            assert.equal(target.cityKey, key); assert.equal(target.request, `${dir}/${name.replace('.jpg', '')}/spriteFrame`);
            assert.equal(hash(`${root}/${dir}/${name}`), row.images[name], `${dir}: keep original JPG bytes`);
            imageMeta(`${root}/${dir}/${name}`, 1024, 672);
        }
        imageMeta(`${root}/thumbnails/${dir}/icon.jpg`, 306, 200);
        assert.equal(flow.isLevelUnlocked(0, i), i === 0, 'Only the first level starts free');
    }
    assert.equal(total, 325);
    unlocked.add(`${key}/level-17`);
    assert.equal(flow.isLevelUnlocked(0, 16), true); assert.equal(flow.isLevelUnlocked(0, 15), false);
    assert.equal(flow.isLevelUnlocked(0, 17), false);
    completed.add(`${key}/level-17`);
    assert.equal(flow.isLevelUnlocked(0, 17), true, 'Winning an ad-unlocked level opens the next for free');
    assert.equal(flow._nextLevelTarget(city, 29), null, 'Topic end cannot jump into another chapter');
    imageMeta('assets/Bundle/chapter-covers/city-PetThreeKingdoms-icon.jpg', 360, 188);
    const bundleMeta = read(root + '.meta').userData;
    assert.equal(bundleMeta.isBundle, true); assert.equal(bundleMeta.bundleName, key);
    assert.equal(read('settings/v2/packages/builder.json').bundleConfig.custom[bundleMeta.bundleConfigID].configs.miniGame.fallbackOptions.isRemote, true);

    // Exercise the actual startup migration block so the inserted topic cannot shift v2 numeric saves.
    const boot = cls.members.find(m => m.name?.getText(tree) === '_bootstrap').getText(tree);
    const migration = boot.slice(boot.indexOf('const rules ='), boot.indexOf('if (!this.save.migrateChapterRules('));
    assert.ok(migration.includes('migrateLegacy(allKeys)'));
    const runMigration = vm.runInNewContext(compile(`(async function () { ${migration} });`));
    let migrated = false;
    const rules = read('assets/resources/configs/chapter-rules.json');
    await runMigration.call({ _cities: index.cities.map(k => index.chapters[k]),
        _loadJson: async () => ({ json: rules }), save: { migrateLegacy(keys) {
            const expected = rules.legacyOrders[0].flatMap(k => index.chapters[k].levels.map(dir => `${k}/${dir}`));
            assert.deepEqual(Array.from(keys), expected); assert.equal(keys.length, 120);
            assert.equal(keys[0], 'city-02-beijing/level-01'); assert.equal(keys[15], 'city-03-shanghai/level-01');
            assert.ok(keys.every(k => !k.startsWith(key + '/'))); migrated = true;
        } } });
    assert.equal(migrated, true);
    console.log('PASS: 萌宠三国 30 ordered levels, 325 original differences, 60 original images, 30 thumbnails, remote bundle, free progression/video skips and v2 migration.');
})().catch(error => { console.error(error); process.exitCode = 1; });
