/** Beijing calendar day shared by eligibility and persisted daily claims. */
export function sidebarDay(timestamp = Date.now()): string {
    return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class SidebarService {
    public static readonly HINT_REWARD = 2;
    public supported = false;
    public navigating = false;
    private _started = false;
    private _disposed = false;
    private _options: any = {};
    private _receivedAt = 0;
    private _unsubscribe: (() => void) | null = null;
    private readonly _listeners = new Set<() => void>();

    constructor(private readonly host: any = globalThis, private readonly now = () => Date.now(),
        private readonly timeoutMs = 8000) {}

    public get fromSidebarToday(): boolean {
        return this._options.launch_from === 'homepage' && this._options.location === 'sidebar_card'
            && sidebarDay(this._receivedAt) === sidebarDay(this.now());
    }

    public subscribe(listener: () => void): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    private _notify(): void {
        if (this._disposed) return;
        for (const listener of this._listeners) listener();
    }

    public async start(): Promise<void> {
        if (this._started || this._disposed) return;
        this._started = true;
        const sdk = this.host.tt;
        if (typeof sdk?.onShow !== 'function') return;
        const onShow = (options: any, receivedAt = this.now()) => {
            this._options = options ?? {};
            this._receivedAt = receivedAt;
            this._notify();
        };
        // game.js captures cold starts before the Cocos scene loads.
        const bridge = this.host.__findDifferenceSidebar;
        if (bridge?.listeners && Array.isArray(bridge.listeners)) {
            bridge.listeners.push(onShow);
            this._unsubscribe = () => {
                const index = bridge.listeners.indexOf(onShow);
                if (index >= 0) bridge.listeners.splice(index, 1);
            };
            if (bridge.latest) onShow(bridge.latest, bridge.receivedAt);
        } else {
            sdk.onShow(onShow);
            this._unsubscribe = () => sdk.offShow?.(onShow);
            try { onShow(sdk.getLaunchOptionsSync?.() ?? {}); } catch { /* No launch data. */ }
        }
        if (typeof sdk.checkScene !== 'function' || typeof sdk.navigateToScene !== 'function') return;
        this.supported = await new Promise<boolean>(resolve => {
            const timer = setTimeout(() => resolve(false), this.timeoutMs);
            const finish = (value: boolean) => { clearTimeout(timer); resolve(value); };
            try {
                sdk.checkScene({ scene: 'sidebar', success: (res: any) => finish(res?.isExist === true),
                    fail: () => finish(false) });
            } catch { finish(false); }
        });
        this._notify();
    }

    public async navigate(): Promise<{ success: boolean; reason?: string }> {
        if (!this.supported || this._disposed) return { success: false, reason: '当前环境暂不支持侧边栏' };
        if (this.navigating) return { success: false, reason: '正在打开侧边栏' };
        this.navigating = true;
        this._notify();
        const result = await new Promise<{ success: boolean; reason?: string }>(resolve => {
            const timer = setTimeout(() => resolve({ success: false, reason: '跳转超时，请重试' }), this.timeoutMs);
            const finish = (value: { success: boolean; reason?: string }) => { clearTimeout(timer); resolve(value); };
            try {
                this.host.tt.navigateToScene({ scene: 'sidebar',
                    success: () => finish({ success: true }),
                    fail: () => finish({ success: false, reason: '暂时无法打开侧边栏，请重试' }) });
            } catch { finish({ success: false, reason: '侧边栏调用失败，请重试' }); }
        });
        // A successful jump is NOT proof of a sidebar return. Only onShow can establish eligibility.
        this.navigating = false;
        this._notify();
        return result;
    }

    public dispose(): void {
        this._disposed = true;
        this._unsubscribe?.();
        this._listeners.clear();
    }
}
