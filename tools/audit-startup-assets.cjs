const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const normalize = file => file.replace(/\\/g, '/');

function audit() {
    const all = walk('assets').map(normalize), inventory = new Map(), bundles = [];
    const configs = read('settings/v2/packages/builder.json').bundleConfig.custom;
    for (const file of all.filter(file => file.endsWith('.meta'))) {
        const meta = read(file), asset = file.slice(0, -5);
        for (const uuid of [meta.uuid, ...Object.values(meta.subMetas || {}).map(sub => sub.uuid)]) {
            assert.ok(!inventory.has(uuid), `Duplicate asset UUID: ${uuid}`);
            inventory.set(uuid, asset);
        }
        if (meta.userData?.isBundle) {
            const options = configs[meta.userData.bundleConfigID || 'default'].configs.miniGame;
            bundles.push({ root: asset, name: meta.userData.bundleName || path.basename(asset),
                remote: options.overwriteSettings?.['bytedance-mini-game']?.isRemote ?? options.fallbackOptions?.isRemote ?? false });
        }
    }
    bundles.sort((a, b) => b.root.length - a.root.length);
    const owner = file => bundles.find(bundle => file.startsWith(bundle.root + '/')) || { name: 'main', remote: false };
    const roots = all.filter(file => file === 'assets/scene/game.scene' ||
        (/\.(prefab|anim)$/.test(file) && (file.startsWith('assets/resources/') || file.startsWith('assets/PleyGame/'))));
    const seen = new Set(), references = [], unresolved = [];
    function visitAsset(file, from) {
        if (seen.has(file)) return;
        seen.add(file);
        const bundle = owner(file);
        if (bundle.remote) references.push({ from, target: file, bundle: bundle.name });
        if (/\.(prefab|anim|scene|json|mtl|spriteatlas)$/.test(file)) visit(read(file), file);
        if (fs.existsSync(file + '.meta')) visit(read(file + '.meta'), file, true);
    }
    function visit(value, from, metadata = false) {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (key === '__uuid__' || (metadata && ['atlasUuid', 'imageUuidOrDatabaseUri', 'redirect'].includes(key))) {
                if (typeof item === 'string' && item) {
                    const target = inventory.get(item);
                    if (target) visitAsset(target, from);
                    else if (key === '__uuid__') unresolved.push({ from, uuid: item });
                }
            } else visit(item, from, metadata);
        }
    }
    for (const file of roots) visitAsset(file, 'entry');
    const result = { date: '2026-11-05', sourceOnly: true, rebuilt: false, deviceVerified: false,
        rootCount: roots.length, dependencyCount: seen.size,
        localBundles: [...new Set([...seen].map(file => owner(file).name))].sort(),
        remoteDependencies: references, unresolvedReferences: unresolved,
        startup: { local: ['main', 'resources', 'MainGameSources'], remote: ['current chapter only'] },
        deferred: { lobbyShell: 'after 8 active gameplay seconds',
            chapterCovers: 'chapter selection page', collectibles: 'collection/detail/acquisition popup',
            heroAnimation: 'home page opened', signIn: 'home page sign-in opened', crossChapterPrefetch: false } };
    assert.deepEqual(references, [], 'Startup/playing prefabs must not require remote menu/catalog bundles');
    assert.deepEqual(unresolved, [], 'Startup asset references must resolve');
    assert.ok(!bundles.some(bundle => bundle.name === 'SupportTexture'), 'Shared guides should belong to local resources');
    return result;
}

if (require.main === module) {
    const result = audit();
    fs.mkdirSync('config/startup-loading', { recursive: true });
    fs.writeFileSync('config/startup-loading/dependency-audit.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
}
module.exports = { audit };
