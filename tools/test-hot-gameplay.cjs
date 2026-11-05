const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const index = read('assets/resources/configs/cities.json');
const map = read('config/hot-gameplay-import-2026-11-05.json');
const chapter = index.chapters[map.chapter], root = `assets/Bundle/levels/${map.chapter}`;
assert.equal(chapter.levels.length, 40);
assert.deepEqual(chapter.levels.slice(0, 2), map.preservedLevels.slice(0, 2));
assert.deepEqual(chapter.levels.slice(12), map.preservedLevels.slice(2));
assert.deepEqual(chapter.levels.slice(2, 12).map(entry => entry.id), map.levels.map(entry => entry.id));
assert.deepEqual(map.levels.map(entry => entry.name), ['模仿小猴姿勢', '抽纸挑战', '异世界来了个年轻人', '沙县爱情故事', '功夫小咪',
    '选到一样就买', '上课偷吃挑战', '挑战切超长蛋挞', '秋日收藏', '词不一样就跑步']);
assert.equal(map.imageExport.quality, 8); assert.equal(map.imageExport.qualityScale, 12);
assert.ok(map.imageExport.encoder.startsWith('Photoshop '));
assert.equal(new Set(Object.values(index.chapters).flatMap(chapter => chapter.levels.map(entry => entry.id))).size, 325);
let differences = 0;
for (const row of map.levels) {
    const source = path.join(map.source, row.sourceFolder, row.sourceConfig);
    assert.equal(hash(source), row.configSha256);
    const config = read(`${root}/configs/${row.folder}/differences.json`);
    assert.deepEqual(config.differences, read(source).differences);
    assert.equal(config.name, row.name); assert.equal(config.type, 'normal');
    assert.equal(config.icon, `thumbnails/${map.chapter}/${row.folder}/icon/spriteFrame`);
    assert.match(row.folder, /^[a-z]+(?:-[a-z]+)*$/); assert.ok(!row.id.includes('level-'));
    differences += config.differences.length;
    for (const image of row.images) {
        assert.equal(hash(path.join(map.source, row.sourceFolder, image.sourceFile)), image.sourceSha256);
        assert.equal(hash(image.assetPath), image.importedSha256);
        assert.ok(['scene-a.jpg', 'scene-b.jpg'].includes(path.basename(image.assetPath)));
        const meta = read(image.assetPath + '.meta'); assert.equal(meta.uuid, image.uuid);
        const frame = meta.subMetas.f9941.userData;
        assert.equal(frame.rawWidth, 1024); assert.equal(frame.rawHeight, 672);
    }
    assert.ok(fs.existsSync(`${root}/thumbnails/${row.folder}/icon.jpg`));
}
assert.equal(differences, 133);
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const tree = ts.createSourceFile('GameFlow.ts', fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['_loadCityMeta', '_nextLevelTarget', 'findContinueTarget', 'isCityUnlocked', 'isLevelUnlocked'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(member => names.includes(member.name?.getText(tree))).map(member => member.getText(tree)).join('\n');
const Flow = vm.runInNewContext(compile(`class Flow { ${body} } Flow;`));
const storage = new Map(), saveModule = {};
vm.runInNewContext(compile(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8')), {
    exports: saveModule, console, require: () => ({ sys: { localStorage: {
        getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
    } } }),
});
(async () => {
    const flow = new Flow(); flow._cityIndex = index;
    const city = await flow._loadCityMeta(null, map.chapter); flow._cities = [city];
    flow._ensureLevel = async (chapter, position) => ({ key: chapter.levelIds[chapter.levels[position]] });
    storage.set('find-difference.save.v3', JSON.stringify({ version: 3, energy: 9, energyUpdatedAt: Date.now(),
        completed: { 'city-00-HotTips/level-01': { stars: 3, bestTime: 12 }, 'city-00-HotTips/level-02': { stars: 2, bestTime: 14 } },
        contentLayout: { [map.chapter]: map.preservedLevels.map(entry => entry.id) }, lastPlayedCityKey: map.chapter,
        lastPlayedLevelKey: 'city-00-HotTips/level-03', unlockedLevels: ['city-00-HotTips/level-20'], freeHints: 7 }));
    flow.save = new saveModule.SaveService();
    const before = JSON.stringify(flow.save.data.completed);
    assert.ok(flow.save.migrateContentLayout([city], {}));
    assert.equal(flow.save.energy, 9); assert.equal(flow.save.freeHints, 7);
    assert.equal(JSON.stringify(flow.save.data.completed), before, 'old stars and best times are retained');
    assert.equal((await flow.findContinueTarget()).level.key, 'city-00-HotTips/level-03', 'continue by stable ID rather than new position');
    assert.equal(flow.isLevelUnlocked(0, 12), true, 'previously open third level remains accessible after insertion');
    assert.equal(flow.isLevelUnlocked(0, 2), true, 'winning 闪身步 opens the first new level');
    assert.equal(flow.isLevelUnlocked(0, 3), false, 'subsequent new levels keep ordinary progression');
    assert.equal(flow._nextLevelTarget(city, 1).levelIndex, 2);
    assert.equal(flow._nextLevelTarget(city, 11).levelIndex, 12);
    assert.ok(flow.save.migrateContentLayout([city], {}));
    assert.equal((await flow.findContinueTarget()).level.key, 'city-00-HotTips/level-03');
    console.log('PASS hot gameplay: ten levels in positions 3–12, 133 unchanged differences, original 30 identities/order, Photoshop JPEG assets, old progress/video access and continuation');
})().catch(error => { console.error(error); process.exitCode = 1; });
