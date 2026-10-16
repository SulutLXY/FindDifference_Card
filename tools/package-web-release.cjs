const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
function walk(root, relative = '') {
    return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
        const next = path.join(relative, entry.name);
        if (entry.isSymbolicLink()) throw Error(`发布目录不能含链接：${next}`);
        return entry.isDirectory() ? walk(root, next) : [next];
    }).sort();
}
function packageRelease(input, output) {
    input = path.resolve(input); output = path.resolve(output);
    if (output === input || output.startsWith(input + path.sep) || input.startsWith(output + path.sep)) {
        throw Error('发布输出目录不能与构建目录重叠');
    }
    execFileSync(process.execPath, [path.join(__dirname, 'check-web-entry.cjs'), input], { stdio: 'pipe' });
    const files = walk(input);
    const settingsFiles = files.filter(name => /^src[\\/]settings\.[a-f0-9]+\.json$/.test(name));
    if (settingsFiles.length !== 1) throw Error('需要一次干净的 MD5 Web 手机端构建，且只保留一个 settings.<hash>.json');
    const settings = JSON.parse(fs.readFileSync(path.join(input, settingsFiles[0]), 'utf8'));
    if (settings.engine?.platform !== 'web-mobile') throw Error('此工具仅用于 Web 手机端构建');
    if (settings.assets?.remoteBundles?.length) throw Error('H5 独立发布需将所有 Bundle 构建在本地目录，避免引用其他批次远程包');
    const versions = settings.assets?.bundleVers || {};
    if (!Object.keys(versions).length) throw Error('构建未包含 Bundle 版本清单');
    for (const [name, version] of Object.entries(versions)) {
        if (!version || !fs.existsSync(path.join(input, 'assets', name, `config.${version}.json`))) {
            throw Error(`构建资源不完整：assets/${name}/config.${version}.json`);
        }
    }
    const digest = crypto.createHash('sha256');
    for (const name of files) digest.update(name.split(path.sep).join('/') + '\0').update(fs.readFileSync(path.join(input, name)));
    const id = digest.digest('hex').slice(0, 20);
    const releasePath = path.join(output, 'releases', id);
    for (const name of files) {
        const source = path.join(input, name), target = path.join(releasePath, name);
        const data = fs.readFileSync(source);
        if (fs.existsSync(target)) {
            if (!fs.readFileSync(target).equals(data)) throw Error(`不可覆盖已发布构建：${target}`);
        } else {
            fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
        }
    }
    // 先写完整资源，最后更新清单；保留此前发布目录。
    fs.copyFileSync(path.join(project, 'config/web-release-launcher.html'), path.join(output, 'index.html'));
    fs.copyFileSync(path.join(project, 'config/web-release.htaccess'), path.join(output, '.htaccess'));
    const manifest = { id, version: JSON.parse(fs.readFileSync(path.join(project, 'config/app-version.json'), 'utf8')).version };
    const temporary = path.join(output, 'release.json.tmp');
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n');
    fs.renameSync(temporary, path.join(output, 'release.json'));
    return { ...manifest, files: files.length, output };
}
if (require.main === module) {
    try { console.log(JSON.stringify(packageRelease(process.argv[2] || path.join(project, 'build/web-mobile'), process.argv[3] || path.join(project, 'output/web-mobile-release')), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { packageRelease };
