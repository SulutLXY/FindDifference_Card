const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cities = read('assets/resources/configs/cities.json').cities;
assert.equal(cities.indexOf('chong-wu-gu-shi'), cities.indexOf('qing-hua-ci') + 1);
assert.equal(cities[cities.indexOf('chong-wu-gu-shi') + 1], 'xun-song-ji');
const audit = read('config/pet-story-additions-2026-11-25.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(audit.levels.length, 51);
for (const [file, before] of Object.entries(audit.chapterFilesBefore)) {
    if (!file.endsWith('/configs/city.json')) assert.equal(hash(file), before, 'Preserve original pet assets, metadata and music');
}
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('GameFlow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_levelImageTarget', '_loadLevel', '_loadCityMeta', '_timeFor', '_nextLevelTarget'];
const body = tree.statements.find(ts.isClassDeclaration).members.filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${body} }; Flow;`, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText);
const flow = new Flow();
flow._grades = read('assets/resources/configs/levels.json');
flow._loadJson = async key => ({ json: read(`assets/resources/${key}.json`) });
flow._cityIndex = read('assets/resources/configs/cities.json');
flow._contentBundles = {use: async (key, action) => action({name:key})};
flow._loadBundleJson = async (bundle, request) => ({json:read(`assets/Bundle/levels/${bundle.name}/${request}.json`),decRef(){}});
const imageFile = request => {
    request = request.replace(/^thumbnails\/([^/]+)\//, 'levels/$1/thumbnails/');
    return ['.jpg', '.png', '.jpeg'].map(ext => 'assets/Bundle/' + request.replace(/\/spriteFrame$/, ext)).find(fs.existsSync);
};
(async () => {
    const city = await flow._loadCityMeta({}, 'chong-wu-gu-shi');
    assert.equal(city.name, '萌宠故事');
    assert.equal(city.banner, 'chapter-covers/city-PetStory-icon/spriteFrame');
    assert.equal(city.levels.length,71); assert.ok(city.levels.every(dir=>!/^level-/.test(dir)));
    assert.deepEqual(Object.values(city.levelIds).slice(0,20),Array.from({length:20},(_,i)=>`city-PetStory/level-${String(i+1).padStart(2,'0')}`));
    assert.deepEqual(read('assets/Bundle/levels/chong-wu-gu-shi/configs/city.json').levels.slice(0,20), audit.previousLevels);
    assert.deepEqual(Object.values(city.levelIds).slice(20), audit.levels.map(row=>row.id));
    assert.ok(imageFile(city.banner));
    const bundleMeta = read('assets/Bundle/levels/chong-wu-gu-shi.meta').userData;
    assert.equal(bundleMeta.isBundle, true); assert.equal(bundleMeta.bundleName, 'chong-wu-gu-shi');
    const settings = read('settings/v2/packages/builder.json').bundleConfig.custom[bundleMeta.bundleConfigID].configs.miniGame;
    assert.equal(settings.fallbackOptions.isRemote, true);
    let total = 0;
    for (const dir of city.levels) {
        const level = await flow._loadLevel({}, city.key, dir);
        assert.equal(level.key, city.levelIds[dir]);
        assert.equal(level.icon, `thumbnails/${city.key}/${dir}/icon/spriteFrame`);
        assert.equal(level.type, 'normal'); assert.ok(level.differences.length);
        total += level.differences.length;
        for (const field of ['topImage', 'bottomImage', 'icon']) {
            const file = imageFile(level[field]); assert.ok(file, `${level.key}: missing ${field}`);
            const meta = read(file + '.meta');
            assert.ok(Object.values(meta.subMetas).some(item => item.importer === 'sprite-frame'));
            if (field !== 'icon') {
                const target = flow._levelImageTarget(level[field]);
                assert.equal(target.cityKey, city.key);
                assert.equal(target.request, `${dir}/${field === 'topImage' ? 'scene-a' : 'scene-b'}/spriteFrame`);
            }
        }
    }
    assert.equal(total, 899);
    for (const row of audit.levels) {
        const config = read(`assets/Bundle/levels/chong-wu-gu-shi/configs/${row.folder}/differences.json`);
        assert.equal(config.name, row.name);assert.equal(config.differences.length, row.differenceCount);
        const source = path.join(audit.source, row.sourceFolder, row.sourceConfig);
        if (fs.existsSync(source)) {
            assert.equal(hash(source), row.configSha256);
            assert.deepEqual(config.differences, read(source).differences);
        }
        for (const image of row.images) assert.equal(hash(image.path), image.sha256);
    }
    const next = flow._nextLevelTarget(city, 19);assert.equal(next.city, city);assert.equal(next.levelIndex, 20);
    assert.equal(city.levelNames[city.levels[20]], '猫好人坏');
    console.log('PASS: PetStory before Song, 20 preserved levels + 51 appended levels, 899 points, 142 images, 71 thumbnails and stable Bundle routing.');
})().catch(error => { console.error(error); process.exitCode = 1; });
