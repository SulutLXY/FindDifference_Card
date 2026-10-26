const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { packageRemoteUpdate } = require('./package-remote-update.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-update-test-'));
const previous = path.join(root, 'previous'), current = path.join(root, 'current'), build = path.join(root, 'build');
const write = (base, name, data) => {
    const file = path.join(base, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};
const settings = { assets: { server: 'https://example.test/game/1',
    remoteBundles: ['city-Old', 'chapter-covers', 'city-New'],
    bundleVers: { 'city-Old': 'aaa', 'chapter-covers': 'bbb', 'city-New': 'ccc' } } };
const options = { previous, current, build };
try {
    for (const base of [previous, current]) {
        write(base, 'city-Old/config.aaa.json', { name: 'city-Old' });
        write(base, 'city-Old/native/scene.123.jpg', 'original chapter image');
        write(base, 'chapter-covers/native/old.111.jpg', 'original chapter cover');
        write(base, 'chapter-covers/import/old.111.json', { image: 'old.111.jpg' });
    }
    write(previous, 'chapter-covers/config.aaa.json', { name: 'chapter-covers', images: ['old'] });
    write(current, 'chapter-covers/config.bbb.json', { name: 'chapter-covers', images: ['old', 'new'] });
    write(current, 'chapter-covers/native/new.222.jpg', 'new chapter cover');
    write(current, 'city-New/config.ccc.json', { name: 'city-New' });
    write(current, 'city-New/native/scene.333.jpg', 'new chapter image');
    write(build, 'src/settings.123.json', settings);
    // 比较内容，不依赖时间戳或大小；纯新增章不得包含旧章或旧封面。
    fs.utimesSync(path.join(current, 'chapter-covers/native/old.111.jpg'), new Date(), new Date());
    const result = packageRemoteUpdate({ ...options, out: path.join(root, 'delta') });
    assert.equal(result.target, 'https://example.test/game/1/remote/');
    assert.equal(result.uploadCount, 4);
    assert.equal(result.reuseCount, 4);
    assert.equal(result.bundles.find(b => b.name === 'city-Old').uploadCount, 0);
    assert.equal(result.bundles.find(b => b.name === 'chapter-covers').uploadCount, 2);
    assert.deepEqual(result.previousOnlyFiles, ['chapter-covers/config.aaa.json']);
    for (const file of result.uploadFiles) {
        assert.deepEqual(fs.readFileSync(path.join(result.out, 'upload/remote', file.path)), fs.readFileSync(path.join(current, file.path)));
    }
    assert.equal(fs.existsSync(path.join(result.out, 'upload/remote/city-Old')), false);
    assert.ok(fs.existsSync(path.join(previous, 'chapter-covers/config.aaa.json')), 'Do not delete previous hashes');
    assert.throws(() => packageRemoteUpdate({ ...options, out: result.out }), /输出目录已存在/);
    assert.throws(() => packageRemoteUpdate({ ...options, out: path.join(current, 'delta') }), /重叠/);
    assert.throws(() => packageRemoteUpdate({ ...options, previous: current, out: path.join(root, 'bad-baseline') }), /独立目录/);
    write(current, 'city-Old/native/scene.123.jpg', 'modified chapter image');
    const changed = packageRemoteUpdate({ ...options, out: path.join(root, 'changed') });
    assert.equal(changed.uploadCount, 5);
    assert.equal(changed.uploadFiles.find(f => f.path === 'city-Old/native/scene.123.jpg').reason, 'changed');
    const full = packageRemoteUpdate({ current, build, full: true, out: path.join(root, 'full') });
    assert.equal(full.uploadCount, 8); assert.equal(full.reuseCount, 0);
    // 选错 remote、代码包中有多份 settings：在创建上传目录前拒绝。
    settings.assets.bundleVers['city-New'] = 'ddd';
    write(build, 'src/settings.123.json', settings);
    const badOut = path.join(root, 'mismatch');
    assert.throws(() => packageRemoteUpdate({ ...options, out: badOut }), /不配套/);
    assert.equal(fs.existsSync(badOut), false);
    write(build, 'src/settings.456.json', settings);
    assert.throws(() => packageRemoteUpdate({ ...options, out: badOut }), /只有一份/);
    console.log('PASS: unchanged chapter and cover bytes reused; new/changed files packaged; old hashes retained; full publish and mismatched-build guards.');
} finally {
    // 只清理本测试创建的临时目录。
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('remote-update-test-')) throw Error('Unsafe test cleanup path');
    fs.rmSync(root, { recursive: true, force: true });
}
