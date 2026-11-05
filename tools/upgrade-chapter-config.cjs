// 一次性升级源清单，保留既有顺序、资源目录和永久存档 ID；重复运行不改文件。
const fs = require('node:fs');
const path = require('node:path');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const index = read('assets/resources/configs/cities.json');
const legacyFile = 'assets/resources/configs/chapter-layout-legacy.json';
const legacy = {};
for (const key of index.cities) {
    const file = path.join('assets/Bundle/levels', key, 'configs/city.json');
    const chapter = read(file);
    legacy[key] = chapter.levels.map(entry => typeof entry === 'string' ? `${key}/${entry}` : entry.id);
    if (chapter.schemaVersion === 2) continue;
    chapter.schemaVersion = 2;
    chapter.levels = chapter.levels.map(folder => ({
        id: `${key}/${folder}`,
        name: read(path.join('assets/Bundle/levels', key, 'configs', folder, 'differences.json')).name,
        folder,
    }));
    if (key === 'city-00-HotTips') chapter.nextChapter = 'city-01-2026Hotmeme';
    write(file, chapter);
}
if (!fs.existsSync(legacyFile)) write(legacyFile, legacy);
if (!fs.existsSync('config/chapter-order.json')) write('config/chapter-order.json', { chapters: index.cities });
console.log('Chapter configuration upgraded; resource paths and stable IDs preserved.');
