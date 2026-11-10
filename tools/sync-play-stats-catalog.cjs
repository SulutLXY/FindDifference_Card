'use strict';
const fs = require('node:fs'), path = require('node:path');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const index = read('assets/resources/configs/cities.json');
const config = read('assets/resources/configs/platform-config.json').playStats;
const file = 'server/play-stats/catalog.json';
const previous = fs.existsSync(file) ? read(file).knownLevels : [];
const chapters = {};
for (const key of index.cities) {
    const chapter = index.chapters[key];
    chapters[key] = { name: chapter.name, initialCount: config.initialCounts?.[key] ?? 0,
        levels: chapter.levels.map(entry => typeof entry === 'string' ? `${key}/${entry}` : entry.id) };
}
for (const topic of index.topics || []) chapters[topic.key] = { name: topic.name,
    initialCount: config.initialCounts?.[topic.key] ?? 0,
    levels: [...new Set(topic.chapters.flatMap(key => chapters[key].levels))] };
const result = { schemaVersion: 1, knownLevels: [...new Set([...previous, ...Object.values(chapters).flatMap(chapter => chapter.levels)])].sort(), chapters };
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
console.log(`Play statistics catalog: ${result.knownLevels.length} stable level IDs, ${Object.keys(chapters).length} chapter/topic totals`);
