const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const audit = read('config/sanguo-updates/2026-11-24.json'), root = 'assets/Bundle/levels/meng-chong-san-guo';
const index = read('assets/resources/configs/cities.json'), sourceMap = read(audit.sourceMap);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.posix.join(dir, e.name)) : [path.posix.join(dir, e.name)]);
// Other chapters may legitimately grow after this historical import; the Sanguo index must still match its unchanged bundle list.
assert.deepEqual(index.chapters[audit.chapter].levels, read(`${root}/configs/city.json`).levels);
assert.equal(hash(`${root}/configs/city.json`), audit.chapterConfigSha256);
assert.equal(hash(audit.sourceMap), audit.sourceMapSha256);
const before = audit.chapterFilesBefore, current = walk(root);
assert.deepEqual(current.sort(), Object.keys(before).sort(), 'No asset/meta created or removed');
const changed = current.filter(file => hash(file) !== before[file]).sort();
assert.deepEqual(changed, audit.changedAssets);
assert.equal(changed.length, 31);
for (const file of current.filter(file => file.endsWith('.meta') || file.includes('/thumbnails/') || file.endsWith('/scene-a.jpg')))
    assert.equal(hash(file), before[file], `Preserve UUIDs, thumbnails and all upper images: ${file}`);
assert.deepEqual(audit.updatedLevels.filter(r => r.images.length).map(r => r.number), [3, 10, 11, 25]);
assert.deepEqual(audit.updatedLevels.filter(r => r.config).map(r => r.number), Array.from({ length: 27 }, (_, i) => i + 4));
let points = 0;
for (const entry of index.chapters[audit.chapter].levels) points += read(`${root}/configs/${entry.folder}/differences.json`).differences.length;
assert.equal(points, 397);assert.equal(audit.differenceCountBefore, 394);
for (const row of audit.updatedLevels) {
    const entry = index.chapters[audit.chapter].levels.find(e => e.id === row.id);
    assert.equal(entry.folder, row.folder);assert.equal(entry.name, row.name);
    const mapRow = sourceMap.levels.find(r => r.number === row.number);
    for (const image of row.images) {
        assert.equal(hash(image.target), image.afterSha256);
        assert.equal(hash(image.target + '.meta'), image.metaSha256);
        assert.equal(read(image.target + '.meta').uuid, image.uuid);
        if (fs.existsSync(image.source)) assert.equal(hash(image.source), image.afterSha256);
        assert.equal(mapRow.images[path.basename(image.target)], image.afterSha256);
    }
    if (!row.config) continue;
    const revision = row.config, actual = read(revision.target), previous = structuredClone(revision.before);
    assert.equal(hash(revision.target), revision.afterSha256);
    if (fs.existsSync(revision.source)) {
        assert.equal(hash(revision.source), revision.sourceSha256);
        assert.deepEqual(actual.differences, read(revision.source).differences);
    }
    const integrationFields = structuredClone(actual);delete integrationFields.differences;delete previous.differences;
    assert.deepEqual(integrationFields, previous, 'Preserve canonical name, type, thumbnail and collectible fields');
    assert.equal(actual.differences.length, revision.differenceCount);
    assert.equal(mapRow.configSha256, revision.sourceSha256);assert.equal(mapRow.differenceCount, revision.differenceCount);
    const ids = new Set();
    for (const point of actual.differences) {
        assert.ok(point.id && !ids.has(point.id));ids.add(point.id);
        assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= 1);
        assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= 1);
        assert.ok(Number.isFinite(point.radius) && point.radius > 0 && point.radius <= 1);
    }
}
for (const number of [21, 22, 23]) {
    const folder = index.chapters[audit.chapter].levels[number - 1].folder;
    assert.equal(hash(`${root}/${folder}/scene-b.jpg`), before[`${root}/${folder}/scene-b.jpg`], 'Keep the repaired lower images');
}
const followup = read(audit.followupAudit);
assert.deepEqual(followup.updatedLevels.map(row => row.number), Array.from({ length: 14 }, (_, i) => i + 17));
assert.deepEqual(current.filter(file => hash(file) !== followup.chapterFilesBefore[file]).sort(), followup.changedAssets);
assert.equal(followup.changedAssets.length, 15);
assert.equal(followup.differenceCountBefore, 397);assert.equal(followup.differenceCount, 397);
assert.equal(followup.updatedLevels.find(row => row.number === 22).config.oldDifferenceCount, 16);
assert.equal(followup.updatedLevels.find(row => row.number === 22).config.differenceCount, 15);
assert.equal(followup.updatedLevels.find(row => row.number === 25).config.oldDifferenceCount, 14);
assert.equal(followup.updatedLevels.find(row => row.number === 25).config.differenceCount, 15);
console.log('PASS sanguo updates: cumulative 4 lower images / 27 configs, 394→397 differences; approved follow-up 14 configs / 1 lower image, stable IDs/order/UUIDs');
