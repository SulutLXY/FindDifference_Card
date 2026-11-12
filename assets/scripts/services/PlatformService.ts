import { PlatformConfig, RewardPlacement, RewardResult } from '../core/GameTypes';
import { SidebarService } from './SidebarService';
import { BYTEDANCE, WECHAT, HTML5 } from 'cc/env';
import { PlayerInfoService } from './PlayerInfoService';

type RuntimeKind = 'h5' | 'wechat' | 'douyin';

type InterstitialState = {
    ad: any;
    adUnitId: string;
    ready: boolean;
    loading: boolean;
    loadingSince: number;
    shown: boolean;
    onLoad: () => void;
    onError: (error: any) => void;
    onClose: () => void;
    loaded: (() => void) | null;
    failed: ((error: any) => void) | null;
    closed: (() => void) | null;
};

const EMPTY_CONFIG: PlatformConfig = {
    cdnBaseUrl: '',
    apiBaseUrl: '',
    shareLandingUrl: '',
    wechatAppId: '',
    wechatRewardedAdUnitId: '',
    douyinAppId: '',
    douyinRewardedAdUnitId: '',
    douyinInterstitialAdUnitId: '',
    rewardOnAnyClose: false,
};

export class PlatformService {
    private readonly _host = globalThis as any;
    public readonly sidebar = new SidebarService(this._host);
    public readonly playerInfo = new PlayerInfoService(() => this.kind, this._host);
    private _config: PlatformConfig = EMPTY_CONFIG;
    private _interstitialBusy = false;
    private _rewardedBusy = false;
    private _finishInterstitial: (() => void) | null = null;
    private _interstitialLoading = false;
    /** 真机未展示的实例不能销毁，保留自动加载状态，下一次入口复用。 */
    private _interstitialState: InterstitialState | null = null;
    /** 引擎按钮重新收到触摸，说明原生遮罩已退出；清理遗漏的关闭回调或未展示请求。 */
    public recoverInterstitialOnTouch(): void {
        if (this._finishInterstitial) console.info('[InterstitialAd] 触摸恢复，结束上一次广告请求');
        this._finishInterstitial?.();
    }
    public canShowInterstitial: () => boolean = () => true;
    public get interstitialBusy(): boolean { return this._interstitialBusy; }
    private _lastInterstitialAttempt = 0;
    private _feedLoggedIn = false;
    private _feedLoginPending = false;
    private _entryBusy = false;
    public feedSubscribed: boolean | null = null;
    public canUseInteractiveFeatures: () => boolean = () => true;
    public beforeFeedSubscribe: (() => string | null) | null = null;
    public onFeedSubscribeSuccess: (() => void) | null = null;
    public get favoriteEntryConfigured(): boolean { return !!this._config.douyinFavoriteEntryRules?.length; }
    public get fromFavoriteToday(): boolean {
        return this.kind === 'douyin' && !this.isPcCompanion
            && this.sidebar.matchesEntryToday(this._config.douyinFavoriteEntryRules ?? []);
    }

    public async checkFeedStatus(): Promise<string | null> {
        if (!this.canUseInteractiveFeatures()) return '请进入游戏后再订阅';
        if (this.kind !== 'douyin' || this.isPcCompanion) return '请在手机抖音中使用订阅功能';
        await this.detectHarmony();
        if (!this.supportsFeedSubscription) return '当前系统暂不支持订阅功能';
        if (!this._feedLoggedIn) {
            const login = await this.playerInfo.login();
            if (!login.success) return '登录尚未完成，请稍后再试';
            this._feedLoggedIn = true;
        }
        const tt = this._host.tt;
        if (!this._supportsApi(tt, 'checkFeedSubscribeStatus') || !this._supportsAllSceneFeed()) return '当前版本暂不支持全场景订阅';
        return new Promise(resolve => {
            let settled = false;
            const finish = (message: string | null) => {
                if (settled) return;
                settled = true; clearTimeout(timer); resolve(message);
            };
            const timer = setTimeout(() => finish('订阅状态查询超时，请重试'), 10000);
            try {
                tt.checkFeedSubscribeStatus({ type: 'play', allScene: true,
                    success: (res: any) => {
                        if (typeof res?.status !== 'boolean') { finish('订阅状态暂不可用'); return; }
                        this.feedSubscribed = res.status; finish(null);
                    }, fail: (res: any) => finish(res?.errMsg || '订阅状态查询失败') });
            } catch { finish('订阅状态查询失败'); }
        });
    }

    public get isPcCompanion(): boolean {
        if (this.kind !== 'douyin') return false;
        try {
            return this._host.tt.getSystemInfoSync?.().platform === 'windows'
                || String(this._host.tt.getLaunchOptionsSync?.().scene) === '029003';
        } catch { return false; }
    }

    /** Prepare login before a click, so subscription retains the user gesture. */
    public prepareFeedLogin(): void {
        if (!this.canUseInteractiveFeatures()) return;
        if (this.kind !== 'douyin' || this.isPcCompanion || this._feedLoggedIn || this._feedLoginPending) return;
        if (!this.supportsFeedSubscription) {
            if (!this.playerInfo.systemInfoKnown) void this.detectHarmony().then(() => {
                if (this.supportsFeedSubscription) this.prepareFeedLogin();
            });
            return;
        }
        const tt = this._host.tt;
        if (typeof tt?.login !== 'function') return;
        this._feedLoginPending = true;
        const timer = setTimeout(() => { this._feedLoginPending = false; }, 10000);
        try {
            tt.login({ success: () => { this._feedLoggedIn = true; },
                complete: () => { clearTimeout(timer); this._feedLoginPending = false; } });
        } catch { clearTimeout(timer); this._feedLoginPending = false; }
    }

    public addDesktop(): Promise<string> {
        return this._entryCall('addShortcut', {}, () => '桌面添加请求已完成，请检查桌面');
    }

    /** 在点击回调内同步发起收藏引导；成功调起与是否收藏分别处理。 */
    public favoriteGame(onGuideShown?: () => void): Promise<string> {
        return this._entryCall('showFavoriteGuide', { type: 'customize' },
            res => {
                onGuideShown?.();
                return res?.isFavorited === true ? '已收藏游戏'
                    : res?.isFavorited === false ? '暂未收藏游戏' : '收藏引导已打开，请在抖音中确认';
            });
    }

    /** Call synchronously from the native touch-end handler; never await login here. */
    public subscribeFeed(): Promise<string> {
        if (this.kind !== 'douyin' || this.isPcCompanion) {
            return this._entryCall('requestFeedSubscribe', {}, () => '');
        }
        if (!this.supportsFeedSubscription) {
            if (!this.playerInfo.systemInfoKnown) void this.detectHarmony();
            return Promise.resolve(this.isHarmony ? '鸿蒙系统暂不支持订阅功能' : '正在识别运行环境，请稍后重试');
        }
        if (!this._feedLoggedIn) {
            this.prepareFeedLogin();
            return Promise.resolve('正在准备登录，请稍后再点击订阅');
        }
        return this._entryCall('requestFeedSubscribe', { type: 'play', allScene: true }, res => {
            if (res?.success === true) { this.feedSubscribed = true; this.onFeedSubscribeSuccess?.(); return '订阅成功'; }
            return '暂未订阅';
        });
    }

    private _entryCall(api: string, args: Record<string, unknown>, message: (res: any) => string): Promise<string> {
        if (!this.canUseInteractiveFeatures()) return Promise.resolve('请进入游戏后再操作');
        if (this.kind !== 'douyin') return Promise.resolve('请在抖音小游戏真机中使用');
        if (this.isPcCompanion) return Promise.resolve('直播伴侣暂不支持此功能，请在手机抖音使用');
        if ((api === 'requestFeedSubscribe' || api === 'checkFeedSubscribeStatus') && !this.supportsFeedSubscription) {
            return Promise.resolve('当前系统暂不支持订阅功能');
        }
        const tt = this._host.tt;
        if (!this._supportsApi(tt, api)) return Promise.resolve('当前版本暂不支持此功能');
        if (this._entryBusy) return Promise.resolve('请完成当前操作后再试');
        if (api === 'requestFeedSubscribe') {
            if (!this._supportsAllSceneFeed()) return Promise.resolve('当前版本暂不支持全场景订阅');
            if (this.feedSubscribed === true) return Promise.resolve('已完成订阅');
            const blocked = this.beforeFeedSubscribe?.();
            if (blocked) return Promise.resolve(blocked);
        }
        this._entryBusy = true;
        return new Promise(resolve => {
            let settled = false;
            const finish = (value: string) => {
                if (settled) return;
                settled = true; clearTimeout(timer); this._entryBusy = false; resolve(value);
            };
            const timer = setTimeout(() => finish('操作超时，请重试'), 15000);
            try {
                tt[api]({ ...args, success: (res: any) => finish(message(res)),
                    fail: (res: any) => finish(Number(res?.errNo) === 10302
                        ? '当前系统暂不支持此功能' : res?.errMsg || '操作未完成，请稍后重试') });
            } catch { finish('当前环境调用失败，请稍后重试'); }
        });
    }

    private _supportsApi(sdk: any, api: string): boolean {
        if (typeof sdk?.[api] !== 'function') return false;
        try { return typeof sdk.canIUse !== 'function' || sdk.canIUse(api) !== false; }
        catch { return false; }
    }

    /** IDE exposes native advertisement mocks even when canIUse reports false. */
    private _supportsAdApi(sdk: any, api: 'createRewardedVideoAd' | 'createInterstitialAd'): boolean {
        if (this._supportsApi(sdk, api)) return true;
        if (this.kind !== 'douyin' || sdk !== this._host.tt || typeof sdk?.[api] !== 'function') return false;
        try {
            if (String(sdk.getSystemInfoSync?.().platform).toLowerCase() !== 'devtools') return false;
            console.info('[PlatformService] 使用开发工具广告模拟', api);
            return true;
        } catch { return false; }
    }

    private _supportsAllSceneFeed(): boolean {
        try {
            const sdk = this._host.tt;
            return typeof sdk?.canIUse !== 'function' || sdk.canIUse('checkFeedSubscribeStatus.object.allScene') !== false;
        } catch { return false; }
    }

    /** 只提前加载，不展示、不暂停玩法；未展示实例保留给下次入口复用。 */
    public preloadInterstitial(): void {
        if (!this.canUseInteractiveFeatures() || this.kind !== 'douyin' || this.isPcCompanion
            || this._rewardedBusy || this._finishInterstitial || !this._config.douyinInterstitialAdUnitId) return;
        const tt = this._host.tt;
        if (!this._supportsAdApi(tt, 'createInterstitialAd')) return;
        try {
            const state = this._getInterstitialState(this._config.douyinInterstitialAdUnitId);
            if (state.ready || (state.loading && Date.now() - state.loadingSince < 15000)) return;
            state.loading = true;
            state.loadingSince = Date.now();
            const loading = state.ad.load();
            if (loading && typeof loading.then === 'function') {
                void Promise.resolve(loading).then(() => {
                    state.ready = true; state.loading = false; state.loaded?.();
                }, error => state.onError(error));
            }
        } catch (error) {
            if (this._interstitialState) this._interstitialState.loading = false;
            console.warn('[InterstitialAd] 预加载失败，下次入口重试', error);
        }
    }

    private _getInterstitialState(adUnitId: string): InterstitialState {
        if (this._interstitialState?.adUnitId === adUnitId) return this._interstitialState;
        const ad = this._host.tt.createInterstitialAd({ adUnitId });
        const created: InterstitialState = {
            ad, adUnitId, ready: false, loading: typeof ad.onLoad === 'function', loadingSince: Date.now(), shown: false,
            loaded: null, failed: null, closed: null,
            onLoad: () => {
                created.ready = true; created.loading = false;
                created.loaded?.();
            },
            onError: (error: any) => {
                if (created.loading) created.ready = false;
                created.loading = false;
                if (created.failed) created.failed(error);
                else console.warn('[InterstitialAd] 后台预加载失败，下次入口重试', error);
            },
            onClose: () => {
                created.shown = true;
                created.closed?.();
            },
        };
        this._interstitialState = created;
        ad.onLoad?.(created.onLoad);
        ad.onClose(created.onClose);
        ad.onError(created.onError);
        return created;
    }

    /** readyOnly 入口仅展示已就绪广告，未就绪不等加载、不延后补弹。 */
    public async showInterstitial(canShow: () => boolean, bypassCooldown = false, bypassRoundProtection = false,
        placement = 'secondary-page', readyOnly = false): Promise<void> {
        if (!this.canUseInteractiveFeatures()) return;
        const tt = this._host.tt;
        const adUnitId = this._config.douyinInterstitialAdUnitId;
        const context = { placement, platform: this.kind, adUnitId, bypassCooldown, bypassRoundProtection, readyOnly };
        console.info('[InterstitialAd] 请求插屏', context);
        // 所有未调用 SDK 的路径均留下原因，真机日志可区分入口未接线、运行环境和平台拒绝。
        const skipped = (reason: string) => { console.info('[InterstitialAd] 跳过插屏', { ...context, reason }); };
        if (this.kind !== 'douyin') { skipped('当前构建不使用抖音插屏'); return; }
        if (this.isPcCompanion) { skipped('直播伴侣或 Windows 环境不支持插屏'); return; }
        if (this._rewardedBusy) { skipped('激励视频正在播放'); return; }
        if (!bypassRoundProtection && !this.canShowInterstitial()) { skipped('首局保护'); return; }
        if (!adUnitId) { skipped('插屏广告位未配置'); return; }
        if (!this._supportsAdApi(tt, 'createInterstitialAd')) { skipped('当前 SDK 不支持 createInterstitialAd'); return; }
        if (this._finishInterstitial) { skipped('已有插屏正在加载或展示'); return; }
        if (!bypassCooldown && this._lastInterstitialAttempt > 0
            && Date.now() - this._lastInterstitialAttempt < 60000) { skipped('客户端 60 秒冷却'); return; }
        if (!canShow()) { skipped('入口页面已失效'); return; }
        if (readyOnly && (!this._interstitialState?.ready || this._interstitialState.adUnitId !== adUnitId)) {
            this.preloadInterstitial();
            skipped('广告未就绪，本次不延后弹出');
            return;
        }
        this._interstitialLoading = true;
        this._lastInterstitialAttempt = Date.now();
        let ad: any;
        let state: InterstitialState | null = null;
        let phase = 'create';
        let unusable = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        let complete!: () => void;
        const closed = new Promise<void>(resolve => { complete = resolve; });
        const cleanup = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            this._interstitialBusy = false;
            this._interstitialLoading = false;
            if (this._finishInterstitial === cleanup) this._finishInterstitial = null;
            this._lastInterstitialAttempt = Date.now();
            complete();
            if (state) {
                state.loaded = state.failed = state.closed = null;
                // 原生 SDK 不允许销毁未展示实例；频控失败或页面取消后仍复用同一个实例。
                if (state.shown || unusable) {
                    if (this._interstitialState === state) this._interstitialState = null;
                    try {
                        ad?.offLoad?.(state.onLoad);
                        ad?.offClose?.(state.onClose);
                        ad?.offError?.(state.onError);
                        if (state.shown) ad?.destroy?.();
                    } catch (error) { console.warn('[InterstitialAd] 清理失败', error); }
                }
                if (readyOnly && state.shown) this.preloadInterstitial();
            }
        };
        const onError = (error: any) => {
            if (settled) return;
            if (state && phase === 'load') { state.loading = false; state.ready = false; }
            const errMsg = error?.errMsg ?? error?.message ?? String(error);
            unusable = /has been destroyed|no ad object|there is no ad to show|already been shown|only be displayed once/i.test(errMsg);
            console.warn('[InterstitialAd] 插屏未展示', { ...context,
                phase, errCode: error?.errCode ?? error?.errNo, errNo: error?.errNo, errMsg });
            cleanup();
        };
        this._finishInterstitial = cleanup;
        try {
            state = this._getInterstitialState(adUnitId);
            ad = state.ad;
            const current = state;
            let markLoaded!: () => void;
            const loaded = new Promise<void>(resolve => { markLoaded = resolve; });
            current.loaded = markLoaded;
            current.failed = onError;
            current.closed = cleanup;
            phase = 'load';
            timer = setTimeout(() => onError({ errMsg: '插屏加载超时' }), 15000);
            if (current.ready) {
                markLoaded();
            } else if (!current.loading) {
                current.loading = true;
                current.loadingSince = Date.now();
                // 新建实例等待原生自动加载；仅失败后的旧实例或无 onLoad 的兼容 SDK 显式 load。
                const loading = ad.load();
                if (loading && typeof loading.then === 'function') {
                    void Promise.resolve(loading).then(() => {
                        current.ready = true; current.loading = false;
                        current.loaded?.();
                    }, error => {
                        if (!settled) onError(error);
                    });
                }
            }
            await Promise.race([loaded, closed]);
            if (settled) return;
            console.info('[InterstitialAd] 插屏加载完成', context);
            if (!canShow() || this._rewardedBusy || (!bypassRoundProtection && !this.canShowInterstitial())) {
                skipped('广告加载期间页面或广告状态改变'); cleanup(); return;
            }
            this._interstitialLoading = false;
            this._interstitialBusy = true;
            phase = 'show';
            await Promise.race([Promise.resolve(ad.show()), closed]);
            if (settled) return;
            current.shown = true;
            phase = 'close';
            console.info('[InterstitialAd] 插屏展示成功', context);
            if (timer) clearTimeout(timer);
            await closed;
        } catch (error) { onError(error); }
    }

    public onRoundFinished(canShow: () => boolean, placement = 'round-finished'): Promise<void> {
        return this.showInterstitial(canShow, true, true, placement, true);
    }

    public get isHarmony(): boolean { return this.kind === 'douyin' && this.playerInfo.isOpenHarmony; }

    /** 未识别系统时先隐藏受限入口，避免异步识别前误调用鸿蒙不支持的接口。 */
    public get supportsSharing(): boolean {
        return this.kind !== 'douyin' || (this.playerInfo.systemInfoKnown && !this.isHarmony);
    }
    public get supportsFeedSubscription(): boolean { return this.supportsSharing; }
    public get supportsRanking(): boolean { return this.supportsSharing; }

    private _harmonyPending: Promise<boolean> | null = null;

    public async detectHarmony(): Promise<boolean> {
        if (this.kind !== 'douyin') return false;
        if (this.isHarmony || this.playerInfo.systemInfoKnown) return this.isHarmony;
        if (this._harmonyPending) return this._harmonyPending;
        this._harmonyPending = this.playerInfo.getSystemInfo().then(() => this.isHarmony)
            .catch(() => false).finally(() => { this._harmonyPending = null; });
        return this._harmonyPending;
    }

    public configure(config: Partial<PlatformConfig>): void {
        this._config = { ...EMPTY_CONFIG, ...config };
        console.info('[PlatformService] 广告配置已加载', {
            platform: this.kind,
            douyinRewardedAdUnitId: this._config.douyinRewardedAdUnitId,
            douyinInterstitialAdUnitId: this._config.douyinInterstitialAdUnitId,
            wechatRewardedAdUnitId: this._config.wechatRewardedAdUnitId,
        });
    }

    public get kind(): RuntimeKind {
        // 构建目标优先，避免兼容环境同时暴露 wx/tt 时选错广告配置。
        if (BYTEDANCE) return 'douyin';
        if (WECHAT) return 'wechat';
        // 网页构建即使运行在带 wx/tt SDK 的浏览器中，也始终使用无广告 H5 流程。
        if (HTML5) return 'h5';
        if (this._host.tt?.createRewardedVideoAd || this._host.tt?.login || this._host.tt?.getSystemInfo) return 'douyin';
        if (this._host.wx?.createRewardedVideoAd || this._host.wx?.login || this._host.wx?.getSystemInfo) return 'wechat';
        return 'h5';
    }

    public async showRewardedAd(_placement: RewardPlacement): Promise<RewardResult> {
        if (!this.canUseInteractiveFeatures()) return { success: false, completed: false, simulated: false, reason: '请进入游戏后再操作' };
        if (this.kind === 'h5') {
            return { success: true, completed: true, simulated: true };
        }
        if (this._interstitialLoading) this._finishInterstitial?.();
        if (this._interstitialBusy) return { success: false, completed: false, simulated: false, reason: '请先关闭插屏广告' };
        if (this._rewardedBusy) return { success: false, completed: false, simulated: false, reason: '请先完成当前视频' };

        const kind = this.kind;
        const sdk = kind === 'wechat' ? this._host.wx : this._host.tt;
        const adUnitId = kind === 'wechat'
            ? this._config.wechatRewardedAdUnitId
            : this._config.douyinRewardedAdUnitId;

        if (!adUnitId) {
            console.error('[PlatformService] 广告位缺失', { platform: kind, adUnitId });
            return {
                success: false,
                completed: false,
                simulated: false,
                reason: `${kind === 'douyin' ? '抖音' : '微信'}广告位尚未配置`,
            };
        }

        if (!this._supportsAdApi(sdk, 'createRewardedVideoAd')) {
            return { success: false, completed: false, simulated: false, reason: '当前环境不支持激励视频广告，请使用真机预览' };
        }

        this._rewardedBusy = true;
        return new Promise<RewardResult>((resolve) => {
            let settled = false;
            const finish = (result: RewardResult) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            try {
                const ad = sdk.createRewardedVideoAd({ adUnitId });
                if (!ad || typeof ad.onClose !== 'function' || typeof ad.onError !== 'function' || typeof ad.show !== 'function') {
                    throw new Error('当前开发环境未提供可用的广告实例，请检查广告模拟设置或使用真机预览');
                }
                const onClose = (result?: { isEnded?: boolean }) => {
                    const completed = this._config.rewardOnAnyClose || result?.isEnded === true;
                    finish({ success: completed, completed, simulated: false });
                    ad.offClose?.(onClose);
                    ad.offError?.(onError);
                };
                const onError = (error: any) => {
                    finish({
                        success: false,
                        completed: false,
                        simulated: false,
                        reason: error?.errMsg ?? '广告暂时不可用',
                    });
                    ad.offClose?.(onClose);
                    ad.offError?.(onError);
                };

                ad.onClose(onClose);
                ad.onError(onError);
                Promise.resolve(ad.show()).catch(() => ad.load().then(() => ad.show()).catch(onError));
            } catch (error) {
                finish({
                    success: false,
                    completed: false,
                    simulated: false,
                    reason: error instanceof Error ? error.message : '广告调用失败',
                });
            }
        }).finally(() => { this._rewardedBusy = false; });
    }

    public share(levelKey: string): boolean {
        if (!this.canUseInteractiveFeatures()) return false;
        const query = `level=${levelKey}&from=share&campaign=default`;
        if (this.kind === 'wechat') {
            if (!this._supportsApi(this._host.wx, 'shareAppMessage')) return false;
            this._host.wx.shareAppMessage({ title: '来挑战我的找茬成绩！', query });
            return true;
        }
        if (this.kind === 'douyin') {
            if (this.isPcCompanion || !this.supportsSharing) {
                if (!this.playerInfo.systemInfoKnown) void this.detectHarmony();
                return false;
            }
            if (!this._supportsApi(this._host.tt, 'shareAppMessage')) return false;
            try { this._host.tt.shareAppMessage({
                title: '来挑战我的找茬成绩！',
                query,
                ...(this._config.douyinShareTemplateIds?.length ? {
                    templateId: this._config.douyinShareTemplateIds[Math.floor(Math.random() * this._config.douyinShareTemplateIds.length)],
                } : {}),
            }); } catch { return false; }
            return true;
        }

        const url = this._config.shareLandingUrl
            ? `${this._config.shareLandingUrl}?${query}`
            : globalThis.location?.href ?? query;
        this._host.navigator?.clipboard?.writeText?.(url)?.catch(() => undefined);
        return true;
    }
}
