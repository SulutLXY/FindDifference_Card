// Runs after assetManager initialization and before even the internal remote bundle.
const STORAGE_KEY = 'find_difference_resource_version';

function resourcePart(version) {
    return typeof version === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(version)
        ? version.split('.').slice(0, 3).join('.') : null;
}

function prepare(cc, sdk, currentVersion) {
    const currentResource = resourcePart(currentVersion);
    if (!currentResource) throw new Error('无效的应用版本号');
    const previous = sdk.getStorageSync(STORAGE_KEY);
    const changed = resourcePart(previous) !== currentResource;
    if (changed) {
        const cache = cc.assetManager.cacheManager;
        if (!cache || !cache.cachedFiles || typeof cache.clearCache !== 'function') {
            throw new Error('资源缓存管理器尚未初始化，停止加载以避免读取旧资源');
        }
        cache.clearCache();
        console.info(`[ResourceVersion] ${previous || '未记录'} -> ${currentVersion}，已清理资源缓存`);
    }
    // Commit only after successful startup; failure retries the migration next launch.
    return function commit() {
        sdk.setStorageSync(STORAGE_KEY, currentVersion);
    };
}

module.exports = { prepare, resourcePart, STORAGE_KEY };
