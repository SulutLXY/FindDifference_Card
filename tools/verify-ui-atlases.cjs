// Verify real Cocos build output, rather than just the packAutoAtlas option.
// Usage: node tools/verify-ui-atlases.cjs build/render-optimization/douyin
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || 'build/render-optimization/douyin');
// An optional separate remote directory supports packages staged outside the code root.
const remoteRoot = process.argv[3] && path.resolve(process.argv[3]);
function filesIn(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? filesIn(file) : [file];
    });
}
function objects(value, predicate, result = []) {
    if (value && typeof value === 'object') {
        if (!Array.isArray(value) && predicate(value)) result.push(value);
        for (const child of Object.values(value)) objects(child, predicate, result);
    }
    return result;
}
const files = [...filesIn(root), ...(remoteRoot ? filesIn(remoteRoot) : [])];
const imports = files.filter(file => /[\\/]import[\\/].*\.json$/.test(file)).map(file => ({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const sources = [
    ['UIIcons', 'assets/resources/textures/UI_Sprite/V3/icons'],
    ['UIPanels', 'assets/resources/textures/UI_Sprite/V3/panels'],
    ['UIButtons', 'assets/resources/textures/UI_Sprite/V3/buttons'],
    ['GameIcons', 'assets/PleyGame/Texture/icons'],
    ['SecondaryIcons', 'assets/SecondaryUI/textures'],
];
for (const [name, sourceDir] of sources) {
    const asset = imports.find(({ data }) => objects(data, obj => obj.name === name && Array.isArray(obj.spriteFrames)).length);
    assert.ok(asset, `${name}: built cc.SpriteAtlas missing`);
    assert.ok(asset.data[3].includes('cc.SpriteAtlas'), `${name}: wrong asset type`);
    const atlas = objects(asset.data, obj => obj.name === name && Array.isArray(obj.spriteFrames))[0];
    const frameNames = atlas.spriteFrames.filter((_, i) => i % 2 === 0);
    const expected = fs.readdirSync(sourceDir).filter(file => /\.(png|jpe?g)$/i.test(file)).map(file => path.parse(file).name);
    assert.deepEqual([...frameNames].sort(), expected.sort(), `${name}: source images missing from atlas`);
    const textureIds = asset.data[1].filter(id => typeof id === 'string' && id.endsWith('@6c48a'));
    assert.equal(textureIds.length, 1, `${name}: expected one shared atlas texture`);
    const id = textureIds[0].split('@')[0];
    const image = files.find(file => /[\\/]native[\\/]/.test(file) && path.basename(file).startsWith(id + '.') && file.endsWith('.png'));
    assert.ok(image, `${name}: generated texture missing from package`);
    const bytes = fs.readFileSync(image);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const meta = JSON.parse(fs.readFileSync(`${sourceDir}/${name}.pac.meta`, 'utf8'));
    assert.ok(width <= meta.userData.maxWidth && height <= meta.userData.maxHeight);
    console.log(`PASS ${name}: ${frameNames.length} sprites -> ${width}x${height} shared texture (${path.relative(root, image)})`);
}
