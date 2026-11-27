import { assetManager, AssetManager, sys } from 'cc';

export interface AssetWarmupPool {
    retain(name: string): () => void;
    load(name: string): Promise<AssetManager.Bundle>;
}

export interface AssetWarmupStage {
    name: string;
    include?: string[];
    exclude?: string[];
}

/** 分帧推进的低优先级文件预取队列；不反序列化预设，不创建游戏纹理。 */
export class OrderedAssetPreloader {
    private readonly queue: Array<{ stage: AssetWarmupStage; attempt: number; urgent?: boolean }>;
    private cursor = 0;
    private busy = false;
    private inFlight = 0;
    private readonly concurrency = 2;
    private disposed = false;
    private completed = new Set<string>();
    private completedStages = new Set<string>();
    private failed = new Set<string>();
    private backoff = 0;
    private priorityStages: AssetWarmupStage[] | null = null;
    private active: {
        stage: AssetWarmupStage; attempt: number; bundle: AssetManager.Bundle; release: () => void;
        assets: Array<{ uuid: string; path: string }>; index: number; failed: boolean;
    } | null = null;

    public constructor(
        private readonly pool: AssetWarmupPool,
        stages: readonly AssetWarmupStage[],
        private readonly canRun: () => boolean,
        private readonly report: (progress: ReturnType<OrderedAssetPreloader['snapshot']>) => void = () => {},
    ) {
        this.queue = stages.map(stage => ({ stage, attempt: 0 }));
    }

    /** 最多两个文件预取任务；仅由帧更新续发，前台加载时可在请求边界让出。 */
    public tick(dt: number): void {
        if (this.disposed || this.busy || !this.canRun()) return;
        // 显式选择到来后不再给旧阶段补任务，等已发出的两个任务全部收尾再换包。
        if (this.priorityStages) {
            if (this.inFlight) return;
            this.applyPriority();
        }
        this.backoff = Math.max(0, this.backoff - Math.min(1, Math.max(0, Number.isFinite(dt) ? dt : 0)));
        if (this.backoff > 0) return;
        if (!this.active) {
            while (this.queue[this.cursor] && this.completedStages.has(this.stageKey(this.queue[this.cursor].stage))) this.cursor++;
            const entry = this.queue[this.cursor];
            if (!entry) return;
            this.busy = true;
            void this.open(entry.stage, entry.attempt).finally(() => {
                this.busy = false;
                this.applyPriority();
            });
            return;
        }
        const active = this.active;
        while (this.inFlight < this.concurrency) {
            while (active.index < active.assets.length && this.completed.has(`${active.stage.name}:${active.assets[active.index].uuid}`)) {
                active.index++;
            }
            const info = active.assets[active.index];
            if (!info) {
                if (!this.inFlight) this.close();
                return;
            }
            active.index++;
            this.fetch(active, info);
        }
    }

    private fetch(active: NonNullable<OrderedAssetPreloader['active']>, info: { uuid: string }): void {
        this.inFlight++;
        void new Promise<void>((resolve, reject) => {
            assetManager.preloadAny({ uuid: info.uuid, bundle: active.bundle.name }, {
                priority: -10, maxConcurrency: 2, maxRequestsPerFrame: 2, maxRetryCount: 0, cacheEnabled: true,
            }, (error, items) => {
                // Web 的图片下载器会创建 HTMLImageElement。预取完移除原始文件内存缓存，
                // 保留浏览器 HTTP 缓存；小游戏保留磁盘路径，不会积累全项目解码后的图片。
                if (sys.isBrowser && items) this.trimBrowserImages(items);
                if (error) reject(error); else resolve();
            });
        }).then(() => {
            this.completed.add(`${active.stage.name}:${info.uuid}`);
        }).catch(() => { active.failed = true; }).finally(() => {
            this.inFlight--;
            if (!this.inFlight) {
                if (this.disposed) this.releaseActive();
                else this.applyPriority();
            }
            this.report(this.snapshot());
        });
    }

    /** 最近的显式选择优先；在途请求收尾后换包，不中断引擎共享请求。 */
    public prioritize(names: readonly string[], include?: readonly string[]): void {
        if (this.disposed || !names.length) return;
        this.priorityStages = Array.from(new Set(names)).map(name => ({ name, ...(include ? { include: Array.from(include) } : {}) }));
        this.backoff = 0;
        if (!this.busy && !this.inFlight) this.applyPriority();
    }

    private applyPriority(): void {
        if (this.disposed || !this.priorityStages || this.busy || this.inFlight) return;
        const requested = this.priorityStages.filter(stage => !this.completedStages.has(this.stageKey(stage))
            && this.queue.some(entry => entry.stage.name === stage.name));
        this.priorityStages = null;
        if (this.active && this.active.index >= this.active.assets.length) this.close();
        if (!requested.length) return;
        if (requested.length === 1 && this.active && this.stageKey(requested[0]) === this.stageKey(this.active.stage)) return;
        // 插入一次性紧急阶段，普通章节队列的相对顺序保持不变。
        const remaining = this.queue.slice(this.cursor).filter(entry => !entry.urgent);
        this.releaseActive();
        this.queue.splice(this.cursor, this.queue.length - this.cursor,
            ...requested.map(stage => ({ stage, attempt: 0, urgent: true })), ...remaining);
        this.backoff = 0;
        this.report(this.snapshot());
    }

    public snapshot(): { state: string; bundle: string | null; completedAssets: number; failedStages: number;
        finishedStages: number; queuedStages: number; currentAsset: number; currentTotal: number; inFlight: number; maxConcurrency: number } {
        return {
            state: this.disposed ? 'disposed' : this.cursor >= this.queue.length && !this.active
                ? (this.failed.size ? 'partial' : 'complete') : 'running',
            bundle: this.active?.stage.name ?? this.queue[this.cursor]?.stage.name ?? null,
            completedAssets: this.completed.size, failedStages: this.failed.size,
            finishedStages: this.cursor, queuedStages: this.queue.length,
            currentAsset: Math.max(0, (this.active?.index ?? 0) - this.inFlight), currentTotal: this.active?.assets.length ?? 0,
            inFlight: this.inFlight, maxConcurrency: this.concurrency,
        };
    }

    public dispose(): void {
        this.disposed = true;
        if (!this.busy && !this.inFlight) this.releaseActive();
    }

    private async open(stage: AssetWarmupStage, attempt: number): Promise<void> {
        const release = this.pool.retain(stage.name);
        try {
            const bundle = await this.pool.load(stage.name);
            if (this.disposed) { release(); return; }
            const infos = bundle.getDirWithPath('');
            const paths = new Set(infos.map(info => info.path));
            const seen = new Set<string>();
            const assets = infos.filter(info => {
                if (stage.include && !stage.include.some(prefix => info.path.startsWith(prefix))) return false;
                if (stage.exclude?.some(prefix => info.path.startsWith(prefix))) return false;
                // 一张图只从 SpriteFrame 入口预取，纹理及图片依赖由引擎递归获取。
                if (paths.has(`${info.path}/spriteFrame`)) return false;
                if (info.path.endsWith('/texture') && paths.has(info.path.slice(0, -8) + '/spriteFrame')) return false;
                if (seen.has(info.uuid)) return false;
                seen.add(info.uuid);
                return true;
            }).sort((a, b) => {
                const order = (assetPath: string) => stage.include?.findIndex(prefix => assetPath.startsWith(prefix)) ?? 0;
                return order(a.path) - order(b.path) || a.path.localeCompare(b.path);
            });
            this.active = { stage, attempt, bundle, release, assets, index: 0, failed: false };
            this.report(this.snapshot());
        } catch (error) {
            release();
            if (!this.disposed) {
                this.retry(stage, attempt);
                this.cursor++;
                this.report(this.snapshot());
                console.warn(`[AssetWarmup] ${stage.name} 清单预取失败，后续重试`, error);
            }
        }
    }

    private close(): void {
        const active = this.active!;
        if (active.failed) this.retry(active.stage, active.attempt);
        else {
            this.failed.delete(this.stageKey(active.stage));
            this.completedStages.add(this.stageKey(active.stage));
        }
        this.releaseActive();
        this.cursor++;
        this.report(this.snapshot());
    }

    private retry(stage: AssetWarmupStage, attempt: number): void {
        this.failed.add(this.stageKey(stage));
        // 跳过失败项继续其余章节，队尾最多再试两轮；成功项用 UUID 去重。
        if (attempt < 2) this.queue.push({ stage, attempt: attempt + 1 });
        this.backoff = 2;
    }

    private stageKey(stage: AssetWarmupStage): string {
        return `${stage.name}:${(stage.include ?? []).join('|')}:${(stage.exclude ?? []).join('|')}`;
    }

    private releaseActive(): void {
        const active = this.active;
        this.active = null;
        active?.release();
    }

    private trimBrowserImages(items: Array<{ isNative: boolean; id: string; file: any }>): void {
        // Creator 3.8.8 的 _files 是下载原始文件缓存；只移除本次请求返回的同一图片对象。
        // 不 destroy 图片/Asset，不影响已加载 SpriteFrame/Texture 和其他页面引用。
        const files = (assetManager as any)._files;
        if (!files?.get || !files?.remove) return;
        for (const item of items) {
            if (!item.isNative || !item.file || typeof item.file !== 'object') continue;
            if (!('naturalWidth' in item.file) && !('close' in item.file && 'width' in item.file)) continue;
            if (files.get(item.id) === item.file) files.remove(item.id);
        }
    }
}
