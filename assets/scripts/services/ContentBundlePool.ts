import { assetManager, AssetManager } from 'cc';

/** 按使用者持有内容包；最后一个页面/对局/异步请求结束后卸载。 */
export class ContentBundlePool {
    private readonly bundles = new Map<string, AssetManager.Bundle>();
    private readonly pending = new Map<string, Promise<AssetManager.Bundle>>();
    private readonly users = new Map<string, number>();
    private disposed = false;

    public retain(name: string): () => void {
        if (this.disposed) throw new Error('内容资源管理器已销毁');
        this.users.set(name, (this.users.get(name) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const remaining = (this.users.get(name) ?? 1) - 1;
            if (remaining) this.users.set(name, remaining);
            else this.users.delete(name);
            // 合并同一轮页面重建/切换，避免关闭后立即重开造成反复卸载。
            void Promise.resolve().then(() => this.collect(name));
        };
    }

    public load(name: string): Promise<AssetManager.Bundle> {
        if (this.disposed) return Promise.reject(new Error('内容资源管理器已销毁'));
        const cached = this.bundles.get(name);
        if (cached) return Promise.resolve(cached);
        const pending = this.pending.get(name);
        if (pending) return pending;
        const request = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(name, (error, bundle) => {
                if (error || !bundle) reject(error ?? new Error(`${name} 加载失败`));
                else { this.bundles.set(name, bundle); resolve(bundle); }
            });
        }).finally(() => {
            this.pending.delete(name);
            this.collect(name);
        });
        this.pending.set(name, request);
        return request;
    }

    public async use<T>(name: string, action: (bundle: AssetManager.Bundle) => Promise<T>): Promise<T> {
        const release = this.retain(name);
        try { return await action(await this.load(name)); }
        finally { release(); }
    }

    public dispose(): void {
        this.disposed = true;
        for (const name of this.bundles.keys()) this.collect(name);
    }

    private collect(name: string): void {
        if (this.users.has(name) || this.pending.has(name)) return;
        const bundle = this.bundles.get(name);
        if (!bundle) return;
        // 图片/JSON 的使用者先 decRef，再归还包；这里仅移除包清单。
        // 不用 releaseAll 强制销毁，避免破坏其他页面或引擎仍持有的引用。
        assetManager.removeBundle(bundle);
        this.bundles.delete(name);
    }
}
