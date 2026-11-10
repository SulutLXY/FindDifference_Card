import { sys } from 'cc';
import { PlayStatsConfig } from '../core/PlayStats';

type PlayEvent = { id: string; levelId: string };
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Global play totals come from the server; pending events are durable and idempotent. */
export class PlayStatsService {
    private _base = '';
    private _storageKey = '';
    private _queue: PlayEvent[] = [];
    private _initial: Record<string, number> = {};
    private _newChapters = new Set<string>();
    private _counts = new Map<string, number>();
    private _fetchedAt = 0;
    private _revision = 0;
    private _disposed = false;
    private _serial = 0;
    private _upload: Promise<void> | null = null;
    private _queries = new Map<string, Promise<Record<string, number>>>();
    private _retry: ReturnType<typeof setTimeout> | null = null;
    private _backoff = 5000;
    private readonly _abort = new Set<() => void>();

    constructor(private readonly host: any = globalThis, private readonly storage: Storage = sys.localStorage,
        private readonly now = () => Date.now(), private readonly random = () => Math.random()) {}

    public configure(config?: PlayStatsConfig, apiBaseUrl = ''): void {
        this._initial = Object.fromEntries(Object.entries(config?.initialCounts ?? {}).filter(([, count]) => validCount(count)));
        this._newChapters = new Set(config?.newChapters ?? []);
        const url = apiBaseUrl.trim().replace(/\/+$/, '');
        const base = config?.enabled && /^(https:\/\/[^/?#\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/[^?#\s]*)?$/.test(url) ? url : '';
        if (base === this._base || this._disposed) return;
        this._revision++;
        this._base = base;
        this._storageKey = `find-difference.play-events.v1:${encodeURIComponent(base)}`;
        this._upload = null; this._queries.clear(); this._counts.clear(); this._fetchedAt = 0;
        if (this._retry) clearTimeout(this._retry);
        this._retry = null;
        for (const abort of this._abort) abort();
        this._queue = [];
        if (!base) return;
        try {
            const stored = JSON.parse(this.storage.getItem(this._storageKey) || '[]');
            if (Array.isArray(stored)) this._queue = stored.filter(event => typeof event?.id === 'string'
                && typeof event?.levelId === 'string').slice(-2000);
        } catch { /* Corrupt statistics cannot affect the gameplay save. */ }
        void this.flush();
    }

    public isNewChapter(key: string): boolean { return this._newChapters.has(key); }
    public initialCount(key: string): number | null { return validCount(this._initial[key]) ? this._initial[key] : null; }

    /** Call only once when an actual, prepared round starts. Replays create new events. */
    public recordEntry(levelId: string): void {
        if (!this._base || this._disposed || !levelId) return;
        if (this._queue.length >= 2000) { console.warn('[PlayStats] 待上传记录已达上限'); return; }
        const id = `${this.now().toString(36)}-${++this._serial}-${this.random().toString(36).slice(2).padEnd(10, '0')}-${this.random().toString(36).slice(2).padEnd(10, '0')}`;
        this._queue.push({ id, levelId });
        this._fetchedAt = 0;
        this._persist();
        void this.flush();
    }

    private _persist(): void {
        try { this.storage.setItem(this._storageKey, JSON.stringify(this._queue)); }
        catch (error) { console.warn('[PlayStats] 统计暂存失败，本次运行仍会尝试上传', error); }
    }

    public flush(): Promise<void> {
        if (!this._base || this._disposed || !this._queue.length) return Promise.resolve();
        if (this._upload) return this._upload;
        const revision = this._revision;
        const pending = (async () => {
            while (!this._disposed && revision === this._revision && this._queue.length) {
                const batch = this._queue.slice(0, 20);
                const response = await this._request('POST', '/v1/play-events', { events: batch });
                if (this._disposed || revision !== this._revision) return;
                if (!Array.isArray(response?.acknowledged) || !batch.every(event => response.acknowledged.includes(event.id)))
                    throw new Error('Invalid play-event acknowledgement');
                const ids = new Set(batch.map(event => event.id));
                this._queue = this._queue.filter(event => !ids.has(event.id));
                this._persist(); this._fetchedAt = 0; this._backoff = 5000;
            }
        })().catch(error => {
            if (this._disposed || revision !== this._revision) return;
            console.warn('[PlayStats] 统计上传暂未完成，将使用相同事件ID重试', error);
            if (!this._retry) {
                this._retry = setTimeout(() => { this._retry = null; void this.flush(); }, this._backoff);
                this._backoff = Math.min(300000, this._backoff * 2);
            }
        }).finally(() => { if (revision === this._revision) this._upload = null; });
        this._upload = pending;
        return pending;
    }

    public getCounts(keys: string[]): Promise<Record<string, number>> {
        const unique = [...new Set(keys)].sort(), key = unique.join(',');
        const cached = this._queries.get(key);
        if (cached) return cached;
        const fallback = () => Object.fromEntries(unique.flatMap(id => {
            const count = this._counts.get(id) ?? this.initialCount(id);
            return count == null ? [] : [[id, count]];
        }));
        if (!this._base || this._disposed || !keys.length) return Promise.resolve(fallback());
        const revision = this._revision;
        const query = (async () => {
            await this.flush();
            if (this._disposed || revision !== this._revision) return fallback();
            if (this._fetchedAt > 0 && this.now() - this._fetchedAt < 30000 && unique.every(id => this._counts.has(id))) return fallback();
            try {
                const result = await this._request('GET', `/v1/play-counts?keys=${encodeURIComponent(key)}`);
                if (this._disposed || revision !== this._revision) return fallback();
                if (!result?.counts || !unique.every(id => validCount(result.counts[id]))) throw new Error('Invalid play totals');
                for (const id of unique) this._counts.set(id, result.counts[id]);
                this._fetchedAt = this.now();
            } catch (error) { if (!this._disposed) console.warn('[PlayStats] 热度获取失败，保留已知数据', error); }
            return fallback();
        })().finally(() => { if (revision === this._revision) this._queries.delete(key); });
        this._queries.set(key, query);
        return query;
    }

    private _request(method: 'GET' | 'POST', path: string, data?: unknown): Promise<any> {
        return new Promise((resolve, reject) => {
            let settled = false, task: any;
            const controller = this.host.AbortController ? new this.host.AbortController() : null;
            const finish = (error?: unknown, value?: unknown) => {
                if (settled) return; settled = true; clearTimeout(timer); this._abort.delete(abort);
                if (error) reject(error); else resolve(value);
            };
            const abort = () => { finish(new Error('Request cancelled')); task?.abort?.(); controller?.abort(); };
            const timer = setTimeout(abort, 5000);
            this._abort.add(abort);
            const response = (status: number, value: any) => {
                if (status < 200 || status >= 300) { finish(new Error(`PlayStats HTTP ${status}`)); return; }
                try { finish(undefined, typeof value === 'string' ? JSON.parse(value) : value); } catch (error) { finish(error); }
            };
            try {
                const sdk = this.host.tt ?? this.host.wx;
                if (typeof sdk?.request === 'function') task = sdk.request({ url: this._base + path, method, data,
                    header: { 'content-type': 'application/json' }, timeout: 5000,
                    success: (result: any) => response(result.statusCode, result.data), fail: (error: any) => finish(error) });
                else if (typeof this.host.fetch === 'function') void this.host.fetch(this._base + path, { method,
                    headers: { 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}),
                    ...(controller ? { signal: controller.signal } : {}) }).then(async (result: any) => response(result.status, await result.json())).catch(finish);
                else finish(new Error('HTTP requests unavailable'));
            } catch (error) { finish(error); }
        });
    }

    public dispose(): void {
        this._disposed = true;
        if (this._retry) clearTimeout(this._retry);
        this._retry = null;
        for (const abort of this._abort) abort();
        this._queries.clear();
    }
}
