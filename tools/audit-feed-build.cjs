const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function walk(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory()
        ? walk(path.join(root, item.name)) : [path.join(root, item.name)]);
}
function auditFeedBuild(projectPath) {
    projectPath = path.resolve(projectPath);
    const config = JSON.parse(fs.readFileSync('assets/resources/configs/platform-config.json', 'utf8'));
    const version = JSON.parse(fs.readFileSync('config/app-version.json', 'utf8')).version;
    const resourceVersion = version.split('.').slice(0, 3).join('.');
    const settingsFiles = walk(path.join(projectPath, 'src')).filter(file => /[/\\]settings(?:\.[^/\\]+)?\.json$/.test(file));
    if (settingsFiles.length !== 1) throw Error(`Expected one settings JSON; found ${settingsFiles.length}`);
    const settings = JSON.parse(fs.readFileSync(settingsFiles[0], 'utf8'));
    const read = file => fs.readFileSync(file, 'utf8');
    const mainPath = path.join(projectPath, 'assets/main', `index.${settings.assets.bundleVers.main}.js`);
    const scripts = [mainPath, ...(settings.scripting?.scriptPackages || []).map(file =>
        path.join(projectPath, file.replace(/^project:\/\//, '')))].filter(file => fs.existsSync(file));
    if (!scripts.length) throw Error('No project script found in main bundle or scripting.scriptPackages');
    const main = scripts.map(read).join('\n'), startup = read(path.join(projectPath, 'game.js'));
    const gameConfig = JSON.parse(read(path.join(projectPath, 'game.json')));
    const platform = JSON.parse(read(path.join(projectPath, 'project.config.json')));
    const resources = walk(path.join(projectPath, 'assets/resources/import')).filter(file => file.endsWith('.json')).map(read).join('\n');
    const ids = [...config.feed.contents, ...config.feed.acquisitionContents].map(item => item.contentID);
    const expectedAppID = JSON.parse(read('profiles/v2/packages/bytedance-mini-game.json')).builder.options['bytedance-mini-game'].appid;
    const versionFile = fs.readdirSync(projectPath).find(file => /^app-version(?:\.[^.]+)?\.js$/.test(file));
    const markers = ['storeFeedData', 'reportScene', 'onRewardClaimed', 'energyUsesRecoveryTime',
        'signInReadyAt', 'acquisitionContents', 'feedSubscriptionRewardClaimed'];
    const checks = {
        appID: platform.appid === expectedAppID,
        resourceServer: settings.assets.server.replace(/\/$/, '').endsWith('/tt/' + resourceVersion),
        appVersion: !!versionFile && read(path.join(projectPath, versionFile)).includes(version),
        allFeedIDs: ids.every(id => resources.includes(id)),
        currentCode: markers.every(marker => main.includes(marker)),
        earlyFeedBridge: startup.includes('__findDifferenceFeed') && startup.includes('onFeedStatusChange'),
        earlySidebarBridge: startup.includes('__findDifferenceSidebar'),
        resourceMigration: startup.includes('resourceVersion.prepare'),
        iosHighPerformance: gameConfig.enableIOSHighPerformanceMode === true,
        noExtraCanvasScaling: !/canvas\.width\s*\*=/.test(startup),
        localStartupBundles: ['internal', 'main', 'resources'].every(name => !(settings.assets.remoteBundles || []).includes(name)),
    };
    const remoteRoots = [path.join(projectPath, 'remote'), path.join(path.dirname(projectPath), 'remote')];
    const missingBundles = (settings.assets.remoteBundles || []).filter(name =>
        !remoteRoots.some(root => fs.existsSync(path.join(root, name, `config.${settings.assets.bundleVers[name]}.json`))));
    checks.remoteBundleConfigs = missingBundles.length === 0;
    return { ok: Object.values(checks).every(Boolean), projectPath, version, resourceVersion,
        resourceServer: settings.assets.server, checks, missingFeedIDs: ids.filter(id => !resources.includes(id)),
        missingCodeMarkers: markers.filter(marker => !main.includes(marker)), missingBundles,
        mainSHA256: crypto.createHash('sha256').update(main).digest('hex'),
        limitation: 'Static build audit only; does not verify platform enablement, upload, CDN availability, device authorization or actual Feed delivery.' };
}
module.exports = { auditFeedBuild };
if (require.main === module) {
    try {
        const result = auditFeedBuild(process.argv[2] || 'build/douying');
        if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
