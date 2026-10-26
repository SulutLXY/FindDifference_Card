const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};

function scan(root, relative = '') {
    const result = [];
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw Error(`资源目录不能包含链接：${name}`);
        if (entry.isDirectory()) result.push(...scan(root, name));
        else if (entry.isFile()) {
            const data = fs.readFileSync(path.join(root, name));
            result.push({ path: name, bytes: data.length, sha256: sha256(data) });
        } else throw Error(`不支持的资源文件：${name}`);
    }
    return result;
}

function packageRemoteUpdate({ previous, current, build, out, full = false }) {
    if (!current || !build || !out || (!previous && !full) || (previous && full)) {
        throw Error('需要 --current、--build、--out，以及 --previous（已完整发布的 remote 备份）或 --full（二选一）');
    }
    current = fs.realpathSync(current);
    build = fs.realpathSync(build);
    previous = previous ? fs.realpathSync(previous) : null;
    out = path.resolve(out);
    // 输出必须是新目录，避免上次增量遗留文件混入本次上传，也绝不删除原始构建。
    if (fs.existsSync(out)) throw Error(`输出目录已存在，请使用新目录：${out}`);
    for (const input of [current, build, previous].filter(Boolean)) {
        if (inside(input, out) || inside(out, input)) throw Error('输出目录不能与输入目录重叠');
    }
    if (previous && (inside(current, previous) || inside(previous, current))) {
        throw Error('前后两次 remote 必须是独立目录，不能用当前构建自身作为已发布基线');
    }

    const settingsNames = fs.readdirSync(path.join(build, 'src')).filter(name => /^settings(?:\.[a-f0-9]+)?\.json$/i.test(name));
    if (settingsNames.length !== 1) throw Error('代码包 src 中必须只有一份 settings JSON，请使用干净的构建产物');
    const settingsFile = path.join(build, 'src', settingsNames[0]);
    const settingsBytes = fs.readFileSync(settingsFile);
    const assets = readJson(settingsFile).assets;
    if (!Array.isArray(assets?.remoteBundles) || !assets.remoteBundles.length) throw Error('此代码包未配置远程 Bundle');
    const server = new URL(assets.server);
    if (!['https:', 'http:'].includes(server.protocol) || server.search || server.hash) throw Error('资源服务器必须是 HTTP(S) 目录地址');
    if (!server.pathname.endsWith('/')) server.pathname += '/';
    const target = new URL('remote/', server).href;
    const bundleNames = [...new Set(assets.remoteBundles)].sort();
    for (const name of bundleNames) {
        if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) throw Error(`非法 Bundle 名称：${name}`);
        const version = assets.bundleVers?.[name];
        if (typeof version !== 'string' || !/^[a-f0-9]+$/i.test(version)) throw Error(`缺少 MD5 Bundle 版本：${name}`);
        const config = path.join(current, name, `config.${version}.json`);
        if (!fs.existsSync(config)) throw Error(`remote 与代码包不配套，缺少：${name}/config.${version}.json`);
        if (readJson(config).name !== name) throw Error(`Bundle 配置名称不匹配：${config}`);
    }

    const before = new Map((previous ? scan(previous) : []).map(file => [file.path, file]));
    // 只发布该代码包使用的远程包，忽略构建目录中已停用包的残留。
    const after = scan(current).filter(file => bundleNames.includes(file.path.split('/')[0]));
    const currentPaths = new Set(after.map(file => file.path));
    const uploadFiles = [], reusedFiles = [];
    for (const file of after) {
        const old = before.get(file.path);
        if (old?.sha256 === file.sha256) reusedFiles.push(file);
        else uploadFiles.push({ ...file, reason: old ? 'changed' : 'added' });
    }
    const previousOnlyFiles = [...before.keys()].filter(name => !currentPaths.has(name)).sort();
    const bundles = bundleNames.map(name => {
        const files = uploadFiles.filter(file => file.path.startsWith(name + '/'));
        return { name, version: assets.bundleVers[name], uploadCount: files.length,
            uploadBytes: files.reduce((n, file) => n + file.bytes, 0),
            reuseCount: reusedFiles.filter(file => file.path.startsWith(name + '/')).length };
    });
    const manifest = {
        format: 1, mode: previous ? 'incremental' : 'full',
        current, previous, build, settingsFile, settingsSha256: sha256(settingsBytes), target,
        uploadCount: uploadFiles.length, uploadBytes: uploadFiles.reduce((n, file) => n + file.bytes, 0),
        reuseCount: reusedFiles.length, bundles, uploadFiles, reusedFiles, previousOnlyFiles,
    };
    const uploadRoot = path.join(out, 'upload', 'remote');
    fs.mkdirSync(uploadRoot, { recursive: true });
    for (const file of uploadFiles) {
        const data = fs.readFileSync(path.join(current, file.path));
        if (sha256(data) !== file.sha256) throw Error(`构建文件在分析后发生变化，请重新生成增量：${file.path}`);
        const destination = path.join(uploadRoot, file.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, data, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'README.txt'), [
        `将 upload/remote/ 内的内容上传至：${target}`,
        `需上传 ${manifest.uploadCount} 个文件（${manifest.uploadBytes} 字节），复用 ${manifest.reuseCount} 个文件。`,
        ...bundles.map(bundle => `${bundle.name}: 上传 ${bundle.uploadCount}，复用 ${bundle.reuseCount}`),
        '',
        '先上传资源，再发布配套代码包。此工具不联网、不上传文件。',
        '增量模式仅适用于相同目标目录，且 previous 必须已完整上传；工具不验证 OSS 实际状态。',
        '更换服务器/目录、缺少可靠的已发布基线时使用 --full。',
        '保留服务器旧文件，禁止用镜像同步的删除功能；previousOnlyFiles 不是删除清单。',
        '发布后备份本次完整 current 目录供下次比较，不要把本次 upload 增量目录作为基线。',
        '',
    ].join('\n'));
    return { ...manifest, out };
}

if (require.main === module) {
    try {
        const args = process.argv.slice(2);
        if (args.includes('--help')) {
            console.log('node tools/package-remote-update.cjs --previous build/remote0 --current build/remote --build build/douyin --out build/remote-update\n首次发布或更换目标目录：用 --full 替代 --previous <目录>。');
        } else {
            const options = {};
            for (let i = 0; i < args.length; i++) {
                const name = args[i];
                if (name === '--full') { options.full = true; continue; }
                if (!['--previous', '--current', '--build', '--out'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) {
                    throw Error(`未知或缺少值的参数：${name}；使用 --help 查看用法`);
                }
                options[name.slice(2)] = args[++i];
            }
            const result = packageRemoteUpdate(options);
            console.log(`已生成 ${result.out}\n目标：${result.target}\n上传 ${result.uploadCount} 个文件 / ${result.uploadBytes} 字节；复用 ${result.reuseCount} 个文件。`);
            for (const bundle of result.bundles) console.log(`${bundle.name}: 上传 ${bundle.uploadCount}，复用 ${bundle.reuseCount}`);
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { packageRemoteUpdate };
