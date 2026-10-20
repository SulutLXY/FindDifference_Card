// Exercise the actual Creator/Babel output, including its loose Set spread transform.
// Usage: node tools/test-built-save-unlocks.cjs build/douyin
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || 'build/douyin');
const dir = path.join(root, 'assets/main');
const file = fs.readdirSync(dir).find(name => /^index\..*\.js$/.test(name));
assert.ok(file, 'Built main script missing');
let declaration;
vm.runInNewContext(fs.readFileSync(path.join(dir, file), 'utf8'), {
    System: { register(name, deps, declare) {
        if (name === 'chunks:///_virtual/SaveService.ts') declaration = declare;
    } },
});
assert.ok(declaration, 'Built SaveService missing');
const stored = new Map();
const api = {};
const moduleBody = declaration((name, value) => { api[name] = value; });
moduleBody.setters[0]({
    extends: Object.assign,
    createClass(type, props) {
        for (const { key, ...descriptor } of props) Object.defineProperty(type.prototype, key, { configurable: true, ...descriptor });
        return type;
    },
});
moduleBody.setters[1]({ cclegacy: { _RF: { push() {}, pop() {} } }, sys: { localStorage: {
    getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value),
} } });
moduleBody.execute();
const { SaveService } = api;
const key = 'find-difference.save.v3';
let save = new SaveService();
assert.equal(save.unlockCity('city-01-2026Hotmeme'), true);
// A city unlocked through an ad must survive even before playing its first level.
for (let launch = 0; launch < 5; launch++) {
    save = new SaveService();
    assert.equal(save.isCityUnlocked('city-01-2026Hotmeme'), true, `Ad unlock lost on launch ${launch}`);
    assert.deepEqual(JSON.parse(stored.get(key)).unlockedCities, ['city-01-2026Hotmeme']);
    assert.equal(save.totalScore, 0);
}
const completed = {
    'city-01-2026Hotmeme/level-03': { stars: 2, bestTime: 23 },
    'city-01-2026Hotmeme/level-07': { stars: 3, bestTime: 17 },
    'city-03-shanghai/level-04': { stars: 1, bestTime: 45 },
    'city-04-nanjing/level-01': { stars: 0, bestTime: 0 },
};
stored.set(key, JSON.stringify({ version: 3, completed, unlockedCities: [{}], freeHints: 7, freeAddTimes: 4,
    foodReviews: { 'city-03-shanghai/level-04': '保留评价' } }));
for (let launch = 0; launch < 5; launch++) {
    save = new SaveService();
    assert.equal(save.isCityUnlocked('city-01-2026Hotmeme'), true);
    assert.equal(save.isCityUnlocked('city-03-shanghai'), true);
    assert.equal(save.isCityUnlocked('city-04-nanjing'), false, 'Zero-star record must not unlock a city');
    assert.equal(save.totalScore, 3);
    assert.equal(save.freeHints, 7);
    assert.equal(save.freeAddTimes, 4);
    assert.equal(save.getFoodReview('city-03-shanghai/level-04'), '保留评价');
    const persisted = JSON.parse(stored.get(key));
    assert.deepEqual(persisted.completed, completed, 'Level positions, stars and times must remain unchanged');
    assert.ok(persisted.unlockedCities.every(city => typeof city === 'string'));
}
console.log(`PASS ${file}: actual built ad unlock survives 5 restarts; damaged unlocks recover from progress; completed positions/stars/times/inventory preserved`);
