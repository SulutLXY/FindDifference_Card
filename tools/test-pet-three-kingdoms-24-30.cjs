const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const chapter = 'city-PetThreeKingdoms', root = `assets/Bundle/levels/${chapter}`;
const index = read('assets/resources/configs/cities.json');
const map = read('config/pet-three-kingdoms-source-map.json');
const source = fs.readFileSync('assets/scripts/GameFlow.ts', 'utf8');
const tree = ts.createSourceFile('flow.ts', source, ts.ScriptTarget.Latest, true);
const names = ['_loadLevel', '_timeFor', '_levelImageTarget', '_chapterSpriteTarget'];
const members = tree.statements.find(ts.isClassDeclaration).members
    .filter(m => names.includes(m.name?.getText(tree))).map(m => m.getText(tree)).join('\n');
const Flow = vm.runInNewContext(ts.transpileModule(`class Flow { ${members} }; Flow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2018 },
}).outputText);
const flow = new Flow(); flow._grades = read('assets/resources/configs/levels.json');
flow._contentBundles = { use: async (key, action) => { assert.equal(key, chapter); return action({}); } };
flow._loadBundleJson = async (_, request) => ({ json: read(`${root}/${request}.json`), decRef() {} });
function dimensions(file, width, height) {
    const meta = read(file + '.meta');
    const frame = Object.values(meta.subMetas).find(sub => sub.importer === 'sprite-frame');
    assert.ok(frame); assert.equal(frame.userData.rawWidth, width); assert.equal(frame.userData.rawHeight, height);
}
(async () => {
    assert.equal(index.chapters[chapter].name, '萌宠三国');
    assert.equal(index.chapters[chapter].levels.length, 30);
    const counts = [12, 14, 16, 12, 16, 12, 15]; let total = 0;
    for (let number = 24; number <= 30; number++) {
        const dir = `level-${number}`, row = map.levels.find(r => r.number === number);
        assert.equal(row.level, dir); assert.equal(row.differenceCount, counts[number - 24]);
        const level = await flow._loadLevel(null, chapter, dir);
        const configPath = `${root}/configs/${dir}/differences.json`, imported = read(configPath);
        assert.equal(level.name, row.name); assert.equal(level.type, 'normal');
        assert.equal(level.differences.length, counts[number - 24]); total += level.differences.length;
        assert.equal(level.icon, `thumbnails/${chapter}/${dir}/icon/spriteFrame`);
        assert.equal(read(configPath + '.meta').importer, 'json');
        for (const point of level.differences) {
            assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
            assert.ok(point.radius > 0 && point.radius <= 0.2);
        }
        const originalConfig = path.join(map.source, row.sourceFolder, 'differences.json');
        if (fs.existsSync(originalConfig)) {
            assert.equal(hash(originalConfig), row.configSha256);
            delete imported.icon; assert.deepEqual(imported, read(originalConfig));
        }
        for (const [field, file] of [['topImage', 'scene-a.jpg'], ['bottomImage', 'scene-b.jpg']]) {
            const target = flow._chapterSpriteTarget(level[field]);
            assert.equal(target.cityKey, chapter);
            assert.equal(target.request, `${dir}/${file.replace('.jpg', '')}/spriteFrame`);
            assert.equal(hash(`${root}/${dir}/${file}`), row.images[file]);
            dimensions(`${root}/${dir}/${file}`, 1024, 672);
        }
        dimensions(`${root}/thumbnails/${dir}/icon.jpg`, 306, 200);
    }
    assert.equal(total, 97);
    console.log('PASS: 萌宠三国 24-30 target configs, 97 differences, source hashes, runtime routes, image metadata and thumbnail paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
