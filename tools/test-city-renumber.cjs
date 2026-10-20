const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require(process.env.TYPESCRIPT_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine/node_modules/typescript');
const storage = new Map();
const exportsSave = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('assets/scripts/services/SaveService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, {
    exports: exportsSave, console,
    require: () => ({ sys: { localStorage: {
        getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    } } }),
});
const { SaveService } = exportsSave;
storage.set('find-difference.save.v3', JSON.stringify({
    version: 3, completed: {
        'city-01-beijing/level-08': { stars: 3, bestTime: 20 },
        'city-02-beijing/level-08': { stars: 2, bestTime: 15 },
        'city-08-xian/level-15': { stars: 1, bestTime: 0 },
        'city-01-2026Hotmeme/level-01': { stars: 2, bestTime: 25 },
    },
    unlockedCities: ['city-01-beijing', 'city-02-beijing', 'city-08-xian'],
    foodReviews: { 'city-01-beijing/level-01': '好吃', 'city-08-xian-RouJiaMo': '不错' },
    freeHints: 7,
}));
let save = new SaveService();
assert.equal(save.progressOf('city-02-beijing/level-08').stars, 3);
assert.equal(save.progressOf('city-02-beijing/level-08').bestTime, 15);
assert.equal(save.isCompleted('city-01-beijing/level-08'), false);
assert.equal(save.isCompleted('city-09-xian/level-15'), true);
assert.equal(save.isCompleted('city-01-2026Hotmeme/level-01'), true);
assert.equal(save.totalScore, 3);
assert.equal(save.freeHints, 7);
assert.equal(save.getFoodReview('city-02-beijing/level-01'), '好吃');
assert.equal(save.getFoodReview('city-09-xian-RouJiaMo'), '不错');
assert.equal(save.data.unlockedCities.length, 3);
assert.equal(save.isCityUnlocked('city-09-xian'), true);
const persisted = storage.get('find-difference.save.v3');
save = new SaveService();
assert.equal(storage.get('find-difference.save.v3'), persisted, 'Migration must be idempotent');
// Reproduce startup failure from local JSON containing non-string unlock entries.
const mixed = JSON.parse(persisted);
mixed.unlockedCities = [1, null, false, {}, ['city-01-beijing'], '', 'city-01-beijing', 'city-02-beijing', 'city-09-xian'];
storage.set('find-difference.save.v3', JSON.stringify(mixed));
save = new SaveService();
assert.deepEqual(Array.from(save.data.unlockedCities), ['city-02-beijing', 'city-09-xian', 'city-01-2026Hotmeme']);
assert.equal(save.progressOf('city-02-beijing/level-08').stars, 3);
assert.equal(save.progressOf('city-02-beijing/level-08').bestTime, 15);
assert.equal(save.getFoodReview('city-02-beijing/level-01'), '好吃');
assert.equal(save.freeHints, 7);
assert.equal(save.totalScore, 3);
assert.equal(save.unlockCity(2), false, 'Do not write new non-string unlock keys');
const repaired = storage.get('find-difference.save.v3');
new SaveService();
assert.equal(storage.get('find-difference.save.v3'), repaired, 'Repaired save remains stable across launches');
storage.clear();
storage.set('find-difference.save.v2', JSON.stringify({ unlockedLevel: 16, levels: { '16': { stars: 2, bestTime: 30 } } }));
save = new SaveService();
const cities = JSON.parse(fs.readFileSync('assets/resources/configs/cities.json', 'utf8')).cities;
const keys = cities.slice(2).flatMap(city => JSON.parse(fs.readFileSync(`assets/Bundle/configs/${city}.json`, 'utf8')).levels.map(level => `${city}/${level}`));
save.migrateLegacy(keys);
assert.equal(save.isCompleted('city-02-beijing/level-01'), true);
assert.equal(save.progressOf('city-03-shanghai/level-01').stars, 2);
assert.equal(save.totalScore, 16);
assert.equal(save.isCompleted('city-01-2026Hotmeme/level-01'), false);
console.log('PASS: city renumber preserves progress/reviews/inventory and v2 order; mixed-type unlocks repair without startup failure; repeat migration is safe.');
