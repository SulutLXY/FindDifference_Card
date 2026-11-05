import { FeedConfig, FeedProgress, FEED_DAY_MS, feedCanOffer, feedPlanKey, feedReadyAt } from '../core/Feed';
import { SaveService } from './SaveService';
import { PlatformService } from './PlatformService';
import { sidebarDay } from './SidebarService';

/** Feed launch lifecycle and persisted revisit scheduling. Never guesses platform IDs/scenes. */
export class FeedService {
    public onPreviewChanged: (() => void) | null = null;
    private _preview = false;
    private _disposed = false;
    private _started = false;
    private _reported = false;
    private _reporting = false;
    private _uploading = false;
    private _lastUploadAttempt = 0;
    private _retryTimer: ReturnType<typeof setTimeout> | null = null;
    private _config: FeedConfig | null = null;
    private _launch: any = {};
    private _cleanup: Array<() => void> = [];
    private readonly _legacy: boolean;
    private _entryVersion = 0;
    private _lastStatus: string | null = null;

    constructor(private readonly save: SaveService, private readonly platform: PlatformService,
        private readonly host: any = globalThis, private readonly now = () => Date.now(),
        private readonly wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
        const data = save.data;
        this._legacy = !!data.lastPlayedLevelKey || !!data.firstPlayedDay || Object.keys(data.completed ?? {}).length > 0;
    }

    public get isPreview(): boolean { return this._preview; }

    public configure(config?: FeedConfig): void { this._config = config ?? null; }

    public start(): void {
        if (this._started || this.platform.kind !== 'douyin') return;
        this._started = true;
        const sdk = this.host.tt;
        const launch = this.host.__findDifferenceSidebar;
        const feed = this.host.__findDifferenceFeed;
        let initial: any = launch?.latest;
        if (!initial) { try { initial = sdk?.getLaunchOptionsSync?.(); } catch { /* unavailable */ } }
        this._readLaunch(initial);
        const onShow = (options: any) => { this._readLaunch(options); };
        if (launch?.listeners) {
            launch.listeners.push(onShow);
            this._cleanup.push(() => { const i = launch.listeners.indexOf(onShow); if (i >= 0) launch.listeners.splice(i, 1); });
        } else if (typeof sdk?.onShow === 'function') {
            sdk.onShow(onShow); this._cleanup.push(() => sdk.offShow?.(onShow));
        }
        const status = (event: any) => {
            if (!this._isFeedLaunch()) return;
            if (event?.type !== 'feedEnter' && event?.type !== 'feedExit') return;
            this._lastStatus = event.type;
            if (event?.type === 'feedEnter') this._setPreview(false);
            else if (event?.type === 'feedExit') this._setPreview(true);
        };
        let lifecycleSupported = false;
        if (feed?.supported && feed.listeners) {
            lifecycleSupported = true;
            feed.listeners.push(status);
            this._cleanup.push(() => { const i = feed.listeners.indexOf(status); if (i >= 0) feed.listeners.splice(i, 1); });
            if (this._isFeedLaunch()) status(feed.latest);
        } else if (!feed && this._supports('onFeedStatusChange')) {
            try {
                sdk.onFeedStatusChange(status); lifecycleSupported = true;
                this._cleanup.push(() => sdk.offFeedStatusChange?.(status));
            }
            catch (error) { console.warn('[Feed] lifecycle unavailable', error); }
        }
        // Old SDK fallback: a genuine touch is the first evidence of entering the game.
        if (!lifecycleSupported && typeof sdk?.onTouchEnd === 'function') {
            const touch = () => {
                if (this._isFeedLaunch()) { this._lastStatus = 'feedEnter'; this._setPreview(false); }
            };
            sdk.onTouchEnd(touch); this._cleanup.push(() => sdk.offTouchEnd?.(touch));
        }
    }

    private _isFeedLaunch(): boolean { return String(this._launch.scene ?? '').endsWith('3041'); }
    private _readLaunch(options: any): void {
        if (!options || options.scene === undefined) return;
        this._launch = options ?? {};
        if (!this._isFeedLaunch()) this._lastStatus = null;
        const latest = this.host.__findDifferenceFeed?.latest?.type ?? this._lastStatus;
        const preview = this._isFeedLaunch() && latest !== 'feedEnter';
        this._setPreview(preview);
    }
    private _setPreview(value: boolean): void {
        if (this._disposed || this._preview === value) return;
        this._preview = value;
        this.onPreviewChanged?.();
    }

    /** Only a configured stable level key can route a launch; caller still checks access. */
    public get launchLevelKey(): string | null {
        if (!this._config?.enabled || !this._isFeedLaunch()) return null;
        const query = this._launch.query ?? {};
        const channel = String(query.feed_game_channel ?? '');
        if (channel === '1' && this._config.revisitEnabled) {
            const content = this._config.contents.find(item => item.contentID === query.feed_game_content_id
                && String(item.scene) === String(query.feed_game_scene));
            return content?.levelKey ?? null;
        }
        if (channel === '2' && this._config.acquisitionEnabled
            && this._config.acquisitionContentID === query.feed_game_content_id) {
            return this._config.acquisitionLevelKey ?? null;
        }
        // Acquisition defaults to the regular continue level, without granting locked-level access.
        return null;
    }

    private _state(day = sidebarDay(this.now())): FeedProgress {
        const saved = this.save.data.feed;
        if (saved && typeof saved.firstDay === 'string' && Array.isArray(saved.visited)
            && Array.isArray(saved.offered) && Array.isArray(saved.uploaded)
            && Number.isSafeInteger(saved.attempts) && saved.attempts >= 0
            && Number.isSafeInteger(saved.cycleStart) && saved.cycleStart >= 0) return saved;
        return { firstDay: day, legacyPlayer: this._legacy, visited: [], offerDay: '', offered: [],
            attemptDay: '', attempts: 0, cycleStart: 0, planKey: '', uploaded: [] };
    }

    /** Returns an offer token; UI marks it only after the guide really opens. */
    public async onLevelEntered(levelKey: string): Promise<string | null> {
        if (this._disposed || this._preview || !this._config?.enabled || !this._config.revisitEnabled
            || this.platform.kind !== 'douyin' || this.platform.isPcCompanion) return null;
        const version = ++this._entryVersion;
        const day = sidebarDay(this.now());
        const state = this._state(day);
        const isNew = !state.visited.includes(levelKey);
        const next = { ...state, visited: isNew ? [...state.visited, levelKey] : state.visited };
        if (!this.save.updateFeedState(next)) return null;
        const error = await this.platform.checkFeedStatus();
        if (error || this._disposed || this._preview || version !== this._entryVersion || sidebarDay(this.now()) !== day) return null;
        if (this.platform.feedSubscribed === true) {
            this._recordFeedReturn();
            void this.scheduleRevisit(); return null;
        }
        // Replaying a milestone never creates another first-day opportunity.
        if (!next.legacyPlayer && next.firstDay === day && !isNew) return null;
        return feedCanOffer(this._state(day), day, next.visited.length) ? `${day}/${next.visited.length}` : null;
    }

    public markOffered(token: string): boolean {
        const day = sidebarDay(this.now()), state = this._state(day);
        if (this._preview || !token.startsWith(`${day}/`) || !feedCanOffer(state, day, Number(token.split('/')[1]))) return false;
        const marker = !state.legacyPlayer && state.firstDay === day ? token.split('/')[1] : 'daily';
        return this.save.updateFeedState({ ...state, offerDay: day,
            offered: [...(state.offerDay === day ? state.offered : []), marker] });
    }

    /** Called synchronously immediately before the native subscription SDK invocation. */
    public reserveSubscriptionAttempt(): string | null {
        if (this._preview) return '请进入游戏后再订阅';
        if (!this._config?.enabled) return null; // Preserve existing manual entry until rollout is configured.
        const day = sidebarDay(this.now()), state = this._state(day);
        const used = state.attemptDay === day ? state.attempts : 0;
        const limit = !state.legacyPlayer && state.firstDay === day ? 6 : 1;
        if (used >= limit) return '今日订阅邀请次数已用完，明天再来吧';
        return this.save.updateFeedState({ ...state, attemptDay: day, attempts: used + 1 }) ? null : '保存失败，请重试';
    }

    private _recordFeedReturn(): void {
        const config = this._config, state = this._state(), query = this._launch.query ?? {};
        if (!config || !feedPlanKey(config) || !this._isFeedLaunch() || String(query.feed_game_channel) !== '1'
            || !state.cycleStart || state.planKey !== feedPlanKey(config)) return;
        const content = config.contents.find(item => item.contentID === query.feed_game_content_id
            && String(item.scene) === String(query.feed_game_scene));
        if (!content || state.consumed?.includes(content.contentID)) return;
        // A previous cycle's cached Feed card cannot consume the next cycle's content.
        let extra: any;
        try { extra = JSON.parse(query.feed_game_extra || '{}'); } catch { return; }
        if (extra.cycleStart !== state.cycleStart) return;
        this.save.updateFeedState({ ...state, consumed: [...(state.consumed ?? []), content.contentID] });
    }

    public async scheduleRevisit(): Promise<void> {
        const config = this._config, key = config && feedPlanKey(config);
        if (!config || !key || this._uploading || this._preview || this._disposed
            || this.platform.feedSubscribed !== true || this.platform.kind !== 'douyin'
            || !this.platform.supportsFeedSubscription || !this._supports('storeFeedData')) return;
        // A rate-limit/network failure must not cause repeated bursts on every click.
        if (this._lastUploadAttempt && this.now() - this._lastUploadAttempt < 60000) {
            if (!this._retryTimer) this._retryTimer = setTimeout(() => {
                this._retryTimer = null; void this.scheduleRevisit();
            }, 60000 - (this.now() - this._lastUploadAttempt));
            return;
        }
        this._lastUploadAttempt = this.now();
        this._uploading = true;
        try {
            let state = this._state();
            if (!state.cycleStart || this.now() >= state.cycleStart + 19 * FEED_DAY_MS || state.planKey !== key) {
                state = { ...state, cycleStart: this.now(), planKey: key, uploaded: [], consumed: [], cleared: [],
                    energyReadyAt: this.save.energyFullRecoveryAt };
                if (!this.save.updateFeedState(state)) return;
            }
            const energyReadyAt = this.save.energy < this.save.energyRecoveryLimit
                ? this.save.energyFullRecoveryAt : state.energyReadyAt ?? this.now();
            if (energyReadyAt > (state.energyReadyAt ?? 0)) {
                const energyContents = new Set(config.contents.filter(content => content.scene === 2).map(content => content.contentID));
                state = { ...state, energyReadyAt, uploaded: state.uploaded.filter(id => !energyContents.has(id)) };
                if (!this.save.updateFeedState(state)) return;
            }
            for (let i = 0; i < config.contents.length; i++) {
                if (this._disposed || this._preview || this.platform.feedSubscribed !== true) return;
                const content = config.contents[i];
                if (state.consumed?.includes(content.contentID)) {
                    if (state.cleared?.includes(content.contentID)) continue;
                    const cleared = await this._call('storeFeedData', { scene: content.scene, contentID: content.contentID,
                        leftValue: 'timeStampMs', operator: '>=', rightValue: String(this.now()), status: 0 });
                    if (!cleared || this._disposed) return;
                    state = { ...this._state(), cleared: [...(state.cleared ?? []), content.contentID] };
                    if (!this.save.updateFeedState(state)) return;
                    await this.wait(500);
                    continue;
                }
                if (state.uploaded.includes(content.contentID)) continue;
                const success = await this._call('storeFeedData', { scene: content.scene, contentID: content.contentID,
                    leftValue: 'timeStampMs', operator: '>=',
                    rightValue: String(Math.max(feedReadyAt(state.cycleStart, i), content.scene === 2 ? state.energyReadyAt ?? 0 : 0)), status: 1,
                    extra: JSON.stringify({ cycleStart: state.cycleStart, levelKey: content.levelKey ?? '' }) });
                if (!success || this._disposed) return;
                state = { ...this._state(), uploaded: [...state.uploaded, content.contentID] };
                if (!this.save.updateFeedState(state)) return;
                if (i < config.contents.length - 1) await this.wait(500);
            }
        } finally { this._uploading = false; }
    }

    /** Invoked after a prepared game frame has actually drawn, including Feed preview. */
    public async reportReady(): Promise<void> {
        if (this._disposed || this._reported || this._reporting || !this._isFeedLaunch()
            || this.platform.kind !== 'douyin' || !this._supports('reportScene')) return;
        this._reporting = true;
        try { this._reported = await this._call('reportScene', { sceneId: 7001 }); }
        finally { this._reporting = false; }
    }

    private _supports(api: string): boolean {
        const sdk = this.host.tt;
        try { return typeof sdk?.[api] === 'function' && (typeof sdk.canIUse !== 'function' || sdk.canIUse(api) !== false); }
        catch { return false; }
    }
    private _call(api: string, args: any): Promise<boolean> {
        return new Promise(resolve => {
            let settled = false;
            const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
            const timer = setTimeout(() => finish(false), 10000);
            try { this.host.tt[api]({ ...args, success: () => finish(true),
                fail: (error: any) => { console.warn(`[Feed] ${api} failed`, error); finish(false); } }); }
            catch (error) { console.warn(`[Feed] ${api} unavailable`, error); finish(false); }
        });
    }

    public dispose(): void {
        this._disposed = true;
        this._entryVersion++;
        if (this._retryTimer) clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this._cleanup.forEach(cleanup => { try { cleanup(); } catch { /* SDK already disposed */ } });
        this._cleanup = [];
        this.onPreviewChanged = null;
    }
}
