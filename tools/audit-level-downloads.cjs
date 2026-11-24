'use strict';
// Read the exact Cocos 3.x built dependency graph; never count a whole chapter as one download.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const slash = file => file.replace(/\\/g, '/');
const bytes = files => [...files].reduce((n, file) => n + fs.statSync(file).size, 0);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mb = n => +(n / 1048576).toFixed(3);
function decode(uuid) {
    const [base, suffix] = uuid.split('@');
    if (base.length !== 22) return uuid;
    const h = base.slice(0, 2) + Buffer.from(base.slice(2), 'base64').toString('hex');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-')
        + (suffix ? '@' + suffix : '');
}
function audit(buildDirectory = 'build/douying') {
    const build = path.resolve(buildDirectory), bundles = new Map();
    const settingsFile = fs.readdirSync(path.join(build, 'src')).filter(f => /^settings(?:\.[^.]+)?\.json$/.test(f));
    assert.equal(settingsFile.length, 1, 'Expected one build settings file');
    const settingsPath = path.join(build, 'src', settingsFile[0]);
    const settings = read(settingsPath), index = read('assets/resources/configs/cities.json');
    function bundle(name) {
        if (bundles.has(name)) return bundles.get(name);
        const remote = settings.assets.remoteBundles.includes(name);
        const root = (remote ? [path.join(build, 'remote', name), path.join(path.dirname(build), 'remote', name)]
            : [path.join(build, 'assets', name)]).find(d => fs.existsSync(path.join(d, `config.${settings.assets.bundleVers[name]}.json`)));
        assert.ok(root, `Missing matching built bundle ${name}`);
        const configFile = path.join(root, `config.${settings.assets.bundleVers[name]}.json`), c = read(configFile);
        assert.ok(!c.isZip, `${name} uses ZIP: a per-asset estimate would undercount the initial whole-bundle download`);
        assert.ok(!settings.assets.subpackages.some(item => (typeof item === 'string' ? item : item.name) === name),
            `${name} is a platform subpackage: audit its whole-package download separately`);
        const uuid = key => typeof key === 'number' ? c.uuids[key] : key;
        const versions = {};
        for (const kind of ['import', 'native']) {
            versions[kind] = new Map();
            for (let i = 0; i < (c.versions[kind] || []).length; i += 2)
                versions[kind].set(uuid(c.versions[kind][i]), c.versions[kind][i + 1]);
        }
        const packs = new Map();
        for (const [id, entries] of Object.entries(c.packs || {})) for (const key of entries) {
            const u = uuid(key), existing = packs.get(u);
            if (!existing || entries.length === 1) packs.set(u, { id, index: entries.indexOf(key) });
        }
        const redirects = new Map();
        for (let i = 0; i < (c.redirect || []).length; i += 2)
            redirects.set(uuid(c.redirect[i]), c.deps[c.redirect[i + 1]]);
        const binary = new Set((c.extensionMap?.['.cconb'] || []).map(uuid));
        const files = walk(root), b = { name, remote, root, c, configFile, versions, packs, redirects, binary, files };
        bundles.set(name, b);
        return b;
    }
    const parsed = new Map();
    function imported(b, id) {
        const decoded = decode(id), version = b.versions.import.get(id);
        const file = path.join(b.root, b.c.importBase, decoded.slice(0, 2), decoded + (version ? '.' + version : '') + (b.binary.has(id) ? '.bin' : '.json'));
        assert.ok(fs.existsSync(file), `Missing import ${file}`);
        if (!parsed.has(file)) {
            if (file.endsWith('.bin')) {
                const raw = fs.readFileSync(file), length = raw.readUInt32LE(12), part = raw.subarray(16, 16 + length);
                assert.equal(raw.readUInt32LE(0), 0x4e4f4343, 'Invalid CCON');
                const engine = process.env.COCOS_ENGINE_PATH || 'D:/CocosCreator/v3.8.8/resources/resources/3d/engine';
                const { notepackDecode } = require(path.join(engine, 'external/deserialize/notepack_decode.ts'));
                parsed.set(file, raw.readUInt32LE(4) === 1 ? JSON.parse(part.toString('utf8'))
                    : notepackDecode(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)));
            } else parsed.set(file, read(file));
        }
        return { file, data: parsed.get(file) };
    }
    function collect(b, u, files = new Set(), seen = new Set()) {
        const id = `${b.name}:${u}`;
        if (seen.has(id)) return files;
        seen.add(id);
        if (b.redirects.has(u)) return collect(bundle(b.redirects.get(u)), u, files, seen);
        const packed = b.packs.get(u), imp = imported(b, packed?.id || u);
        files.add(imp.file);
        let data = imp.data;
        if (packed) {
            if (Array.isArray(data)) data = [...data.slice(0, 5), ...data[5][packed.index]];
            else if (data.type === 'cc.Texture2D') {
                for (const dep of data.data[packed.index][1].flat(Infinity))
                    if (typeof dep === 'string') collect(b, dep, files, seen);
                data = null;
            } else assert.fail(`Unsupported packed format ${imp.file}`);
        }
        if (data) {
            if (Array.isArray(data) && typeof data[0] === 'number') {
                assert.equal(data.length, 11, `Unsupported compiled format ${imp.file}`);
                for (const key of data[10] || []) {
                    const dep = typeof key === 'string' ? key : data[1][key];
                    assert.equal(typeof dep, 'string', `Invalid UUID dependency in ${imp.file}`);
                    collect(b, dep, files, seen);
                }
            } else {
                const visit = value => {
                    if (!value || typeof value !== 'object') return;
                    if (value.__uuid__) collect(b, value.__uuid__, files, seen);
                    for (const child of Object.values(value)) visit(child);
                };
                visit(data);
            }
        }
        const nativeVersion = b.versions.native.get(u);
        if (nativeVersion) {
            const decoded = decode(u);
            const prefix = path.join(b.root, b.c.nativeBase, decoded.slice(0, 2), decoded + '.' + nativeVersion);
            const natives = b.files.filter(f => f.startsWith(prefix + '.') || f.startsWith(prefix + path.sep));
            assert.ok(natives.length, `Missing native file ${prefix}`);
            for (const file of natives) files.add(file);
        }
        return files;
    }
    function asset(b, request, type) {
        const entry = Object.entries(b.c.paths).find(([, value]) => value[0] === request && (!type || b.c.types[value[1]] === type));
        assert.ok(entry, `Missing ${b.name}/${request} (${type || 'any'})`);
        return b.c.uuids[entry[0]];
    }
    const remoteUrl = file => {
        const b = [...bundles.values()].find(b => file.startsWith(b.root + path.sep));
        assert.ok(b, file);
        return b.remote ? settings.assets.server.replace(/\/?$/, '/') + `remote/${b.name}/` + slash(path.relative(b.root, file)) : null;
    };
    const shared = bundle('MainGameSources'), sharedLayouts = {};
    for (const layout of ['GameScreen', 'GameScreen_9x16']) {
        const files = new Set([shared.configFile]);
        for (const name of ['GameplaySupport', layout, 'ResultModal']) collect(shared, asset(shared, 'prefabs/' + name, 'cc.Prefab'), files);
        sharedLayouts[layout] = { bytes: bytes([...files].filter(f => remoteUrl(f))), files: [...files] };
    }
    const rows = [];
    for (const chapterKey of index.cities) {
        const chapter = index.chapters[chapterKey], b = bundle(chapterKey);
        const cityFile = read(`assets/Bundle/levels/${chapterKey}/configs/city.json`);
        assert.deepEqual(cityFile.levels, chapter.levels, `Chapter order out of sync: ${chapterKey}`);
        for (const [position, level] of chapter.levels.entries()) {
            const configPath = `assets/Bundle/levels/${chapterKey}/configs/${level.folder}/differences.json`;
            const source = read(configPath), files = new Set(), imageFiles = new Set();
            collect(b, asset(b, `configs/${level.folder}/differences`, 'cc.JsonAsset'), files);
            const images = [];
            for (const side of ['a', 'b']) {
                const request = source[side === 'a' ? 'topImage' : 'bottomImage'] || `levels/${chapterKey}/${level.folder}/scene-${side}/spriteFrame`;
                assert.ok(request.startsWith('levels/'), `Unexpected image path ${request}`);
                const parts = request.slice(7).split('/'), target = bundle(parts.shift()), targetPath = parts.join('/');
                const pictureFiles = collect(target, asset(target, targetPath, 'cc.SpriteFrame'));
                const native = [...pictureFiles].filter(f => /\.(png|jpg|jpeg|webp)$/.test(f));
                assert.equal(native.length, 1, `Expected one native level image: ${request}`);
                for (const f of pictureFiles) { files.add(f); imageFiles.add(f); }
                const stem = `assets/Bundle/levels/${target.name}/${targetPath.replace(/\/spriteFrame$/, '')}`;
                const sourceImage = ['.jpg', '.png', '.jpeg', '.webp'].map(ext => stem + ext).find(fs.existsSync);
                assert.ok(sourceImage, `Missing source image: ${stem}`);
                const meta = read(sourceImage + '.meta').subMetas.f9941.userData;
                images.push({ source: sourceImage, file: native[0], bytes: bytes(native), width: meta.rawWidth, height: meta.rawHeight,
                    matchesSource: sha(sourceImage) === sha(native[0]), url: remoteUrl(native[0]) });
            }
            const requests = [...files], contentBytes = bytes(files), chapterColdBytes = bytes(new Set([...files, b.configFile]));
            // Assumptions, not measured device times. Mbps is payload throughput; include serial request and CPU allowance separately.
            const estimate = rate => ({ downloadSeconds: +(contentBytes * 8 / (rate * 1000000)).toFixed(2),
                readySeconds: [+(contentBytes * 8 / (rate * 1000000) + 0.4).toFixed(2), +(contentBytes * 8 / (rate * 1000000) + 1.2).toFixed(2)] });
            rows.push({ chapter: chapter.name, chapterKey, position: position + 1, id: level.id, name: level.name,
                contentBytes, imageBytes: images.reduce((s, i) => s + i.bytes, 0), chapterColdBytes,
                chapterIndexBytes: fs.statSync(b.configFile).size, requestCount: requests.length,
                rawTextureMiB: mb(images.reduce((s, i) => s + i.width * i.height * 4, 0)), images,
                estimates: { Mbps2: estimate(2), Mbps10: estimate(10), Mbps30: estimate(30) },
                files: requests.map(file => ({ path: slash(path.relative(process.cwd(), file)), bytes: fs.statSync(file).size, url: remoteUrl(file) })) });
        }
    }
    const samplePath = 'config/loading-audit/cdn-sample.json';
    const sample = fs.existsSync(samplePath) ? read(samplePath) : null;
    const sampleMatchesBuild = sample?.results.every(row => row.url.startsWith(settings.assets.server)
        && fs.existsSync(row.file) && sha(row.file) === row.sha256);
    const report = { generatedAt: new Date().toISOString(), build: slash(path.relative(process.cwd(), build)),
        builtAt: fs.statSync(settingsPath).mtime.toISOString(), settings: slash(path.relative(process.cwd(), settingsPath)),
        server: settings.assets.server, totalLevels: rows.length,
        downloadMode: { remoteBundles: 'individual resources after manifest; ZIP and platform subpackages rejected by this audit',
            subpackages: settings.assets.subpackages, zipBundles: [] },
        cdnSample: sampleMatchesBuild ? { testedAt: sample.testedAt, count: sample.results.length,
            allMatch: sample.results.every(r => r.status === 200 && r.matchesLocal),
            minMs: Math.min(...sample.results.map(r => r.totalMs)), maxMs: Math.max(...sample.results.map(r => r.totalMs)) } : null,
        sourceImageMismatches: rows.flatMap(r => r.images.filter(i => !i.matchesSource).map(i => i.source)),
        sharedLayouts: Object.fromEntries(Object.entries(sharedLayouts).map(([name, info]) => [name, { bytes: info.bytes,
            files: info.files.map(f => ({ path: slash(path.relative(process.cwd(), f)), bytes: fs.statSync(f).size, url: remoteUrl(f) })) }])),
        assumptions: { bandwidthMbps: [2, 10, 30], readyAllowanceSeconds: [0.4, 1.2], cachedAllowanceSeconds: [0.2, 1],
            note: 'No phone timing measurement. Allowances are illustrative, not a latency bound. Excludes retries, startup, shared UI and chapter index from per-level times. Includes required import packs. Music, surprise skins and next-level prefetch can compete for bandwidth after play begins.' },
        chapters: index.cities.map(key => {
            const levels = rows.filter(r => r.chapterKey === key), sizes = levels.map(r => r.contentBytes).sort((a, b) => a - b);
            return { key, name: index.chapters[key].name, count: levels.length, wholeDirectoryBytes: bytes(bundle(key).files),
                minBytes: sizes[0], maxBytes: sizes.at(-1),
                medianBytes: sizes[Math.floor(sizes.length / 2)], meanBytes: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) };
        }), levels: rows };
    const output = 'config/loading-audit';
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(`${output}/level-downloads.json`, JSON.stringify(report, null, 2) + '\n');
    const range = values => values.map(n => n.toFixed(1)).join('–');
    const localTime = value => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) + '（北京时间）';
    const lines = ['# 关卡下载与加载估算', '', `构建：${report.build}；构建时间：${localTime(report.builtAt)}；统计 ${rows.length} 关。`, '',
        '## 口径', '', '按当前源码关卡顺序，追踪最新本地抖音构建的真实图片、配置、纹理依赖及合并 JSON 包，不按整章下载计算。',
        '已复核实际 engine-adapter：远程 Bundle 先请求 config 清单，只有 isZip=true 才下载并解压 res.zip；本次构建全部 20 个远程 Bundle 均未启用 ZIP，settings.assets.subpackages 为空。项目进入关卡使用 bundle.load 指定资源，没有批量加载整章。',
        '对实际构建适配器的 bundle 处理函数进行了隔离执行并记录模拟 IO：当前配置只请求清单后返回；开启 ZIP 的对照才请求 res.zip。记录见 bundle-behavior.json；这不是手机抓包。',
        '参考：[Cocos 3.8 Asset Bundle 文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/bundle.html#加载-asset-bundle)。loadBundle 与后续 bundle.load 分开执行；选择 ZIP 或平台分包时下载行为会变化。复算工具遇到这两种配置会直接报错，避免套用单资源估算。',
        '下表为共享界面和章节索引已缓存、当前关卡未缓存时的估算。Mbps 是有效下载速率：2 Mbps≈0.25 MB/s，10 Mbps≈1.25 MB/s，30 Mbps≈3.75 MB/s。MiB=1024² 字节。',
        '纯下载秒数=字节数×8÷(Mbps×10⁶)；可操作时间另加假设的 0.4–1.2 秒请求串行、解码、纹理上传和布局开销。这不是手机实测或时间上限，弱网高延迟、重试、低端机可能更慢。',
        '同章下一关会串行低优先级预下载；预下载完成/已有磁盘缓存时不重复下载两张图，可先按约 0.2–1 秒加载预算，具体需真机验证；命中内存会更快。跨章节不会提前预下载。',
        '首次局内还需共享 GameplaySupport、玩法和结算预设依赖；首次章节需加章节 config（主包脚本已本地化）。本次审计的 11 月 20 日构建中两张图仍顺序加载。11 月 23 日源码已改为并行加载、选关只用主包卡片索引，需重新打包生效；原耗时表仍仅作为带宽预算，不能代替新包实测。音乐、惊喜皮肤、音效按需异步加载，不作为进入关卡的全部阻塞下载，但会争抢带宽。',
        `源图与构建原始图片字节不一致：${report.sourceImageMismatches.length} 张。预设、脚本或关卡配置的最新改动仍需重新打包。`, '',
        '## CDN 抽测', '', ...(report.cdnSample ? [
            `测量时间：${localTime(report.cdnSample.testedAt)}。在开发电脑依次 GET ${report.cdnSample.count} 个文件（章节清单、最小/中位/最大关卡及本次调序关卡的双图、共用图集和字体），全部 HTTP 200 且逐字节匹配本地构建：${report.cdnSample.allMatch ? '是' : '否'}。`,
            `单文件请求总耗时 ${report.cdnSample.minMs}–${report.cdnSample.maxMs} 毫秒，仅代表开发电脑当时网络；未测 Cocos 纹理解码、手机加载、抖音启动。明细见 cdn-sample.json。`, ''
        ] : ['未进行匹配当前构建的 CDN 抽测。', '']), '## 首次共用界面', '',
        '|布局|远程依赖 MiB|10 Mbps纯传输秒数|', '|---|---:|---:|',
        ...Object.entries(sharedLayouts).map(([name, info]) => `|${name}|${mb(info.bytes)}|${(info.bytes * 8 / 1e7).toFixed(2)}|`), '',
        '共用界面按当前构建静态依赖精确追踪，剔除主包中已有资源；不包含游戏启动引擎和后续大厅、图鉴、音乐等动态资源。', '', '## 章节汇总', '',
        '|章节|关卡数|整个目录 MiB（并非单次下载量）|单关最小 MiB|单关中位 MiB|单关最大 MiB|', '|---|---:|---:|---:|---:|---:|',
        ...report.chapters.map(c => `|${c.name}|${c.count}|${mb(c.wholeDirectoryBytes)}|${mb(c.minBytes)}|${mb(c.medianBytes)}|${mb(c.maxBytes)}|`), '', '## 全部关卡', '',
        '|章节|序号|关卡|必需资源 MiB|10 Mbps纯下载秒数|30 Mbps可操作秒数（估算）|10 Mbps可操作秒数（估算）|2 Mbps可操作秒数（估算）|两图RGBA MiB|',
        '|---|---:|---|---:|---:|---:|---:|---:|---:|',
        ...rows.map(r => `|${r.chapter}|${r.position}|${r.name.replace(/\|/g, '／')}|${mb(r.contentBytes)}|${r.estimates.Mbps10.downloadSeconds}|${range(r.estimates.Mbps30.readySeconds)}|${range(r.estimates.Mbps10.readySeconds)}|${range(r.estimates.Mbps2.readySeconds)}|${r.rawTextureMiB}|`), '',
        '两图 RGBA 为 width×height×4 的纹理内存参考，不是下载体积；不计解码临时内存、界面、音效、额外 GPU 开销。', '',
        '完整文件依赖、资源 URL、字节数见同目录 level-downloads.json。复算：`node tools/audit-level-downloads.cjs build/douying`。', ''];
    fs.writeFileSync(`${output}/README.md`, lines.join('\n'));
    return report;
}
if (require.main === module) {
    const r = audit(process.argv[2]);
    console.log(JSON.stringify({ totalLevels: r.totalLevels, builtAt: r.builtAt, sourceImageMismatches: r.sourceImageMismatches,
        sharedMiB: Object.fromEntries(Object.entries(r.sharedLayouts).map(([k, v]) => [k, mb(v.bytes)])),
        chapters: r.chapters.map(c => ({ name: c.name, count: c.count, medianMiB: mb(c.medianBytes), maxMiB: mb(c.maxBytes) })),
        slowest: [...r.levels].sort((a, b) => b.contentBytes - a.contentBytes).slice(0, 8).map(r => ({ chapter: r.chapter, name: r.name, MiB: mb(r.contentBytes), Mbps10: r.estimates.Mbps10 })) }, null, 2));
}
module.exports = { audit };
