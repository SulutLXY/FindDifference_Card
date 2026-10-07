import { PlatformConfig, RewardPlacement, RewardResult } from '../core/GameTypes';
import { SidebarService } from './SidebarService';
import { BYTEDANCE, WECHAT } from 'cc/env';
import { PlayerInfoService } from './PlayerInfoService';

type RuntimeKind = 'h5' | 'wechat' | 'douyin';

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
    private _lastInterstitialAttempt = 0;
    private _feedLoggedIn = false;
    private _feedLoginPending = false;
    private _entryBusy = false;
    public feedSubscribed: boolean | null = null;
    public get favoriteEntryConfigured(): boolean { return !!this._config.douyinFavoriteEntryRules?.length; }
    public get fromFavoriteToday(): boolean {
        return this.kind === 'douyin' && !this.isPcCompanion
            && this.sidebar.matchesEntryToday(this._config.douyinFavoriteEntryRules ?? []);
    }

    public async checkFeedStatus(): Promise<string | null> {
        if (this.kind !== 'douyin' || this.isPcCompanion) return '请在手机抖音中使用订阅功能';
        if (!this._feedLoggedIn) {
            const login = await this.playerInfo.login();
            if (!login.success) return '登录尚未完成，请稍后再试';
            this._feedLoggedIn = true;
        }
        const tt = this._host.tt;
        if (typeof tt?.checkFeedSubscribeStatus !== 'function') return '当前版本暂不支持订阅状态查询';
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
        if (this.kind !== 'douyin' || this.isPcCompanion || this._feedLoggedIn || this._feedLoginPending) return;
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

    public favoriteGame(): Promise<string> {
        return this._entryCall('showFavoriteGuide', { type: 'customize' },
            res => res?.isFavorited === true ? '已收藏游戏' : '暂未收藏游戏');
    }

    /** Call synchronously from the native touch-end handler; never await login here. */
    public subscribeFeed(): Promise<string> {
        if (this.kind !== 'douyin' || this.isPcCompanion) {
            return this._entryCall('requestFeedSubscribe', {}, () => '');
        }
        if (!this._feedLoggedIn) {
            this.prepareFeedLogin();
            return Promise.resolve('正在准备登录，请稍后再点击订阅');
        }
        return this._entryCall('requestFeedSubscribe', { type: 'play', allScene: true }, res => {
            if (res?.success === true) { this.feedSubscribed = true; return '订阅成功'; }
            return '暂未订阅';
        });
    }

    private _entryCall(api: string, args: Record<string, unknown>, message: (res: any) => string): Promise<string> {
        if (this.kind !== 'douyin') return Promise.resolve('请在抖音小游戏真机中使用');
        if (this.isPcCompanion) return Promise.resolve('直播伴侣暂不支持此功能，请在手机抖音使用');
        const tt = this._host.tt;
        if (typeof tt?.[api] !== 'function') return Promise.resolve('当前版本暂不支持此功能');
        if (this._entryBusy) return Promise.resolve('请完成当前操作后再试');
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
                    fail: (res: any) => finish(res?.errMsg || '操作未完成，请稍后重试') });
            } catch { finish('当前环境调用失败，请稍后重试'); }
        });
    }

    /** Each requested entry attempts an ad; native frequency limits still apply. Resolves on close/error. */
    public async showInterstitial(canShow: () => boolean, bypassCooldown = false): Promise<void> {
        if (this.kind !== 'douyin' || this.isPcCompanion) return;
        const tt = this._host.tt;
        const adUnitId = this._config.douyinInterstitialAdUnitId;
        if (!adUnitId || typeof tt?.createInterstitialAd !== 'function' || this._interstitialBusy
            || (!bypassCooldown && this._lastInterstitialAttempt > 0
                && Date.now() - this._lastInterstitialAttempt < 60000) || !canShow()) return;
        this._interstitialBusy = true;
        this._lastInterstitialAttempt = Date.now();
        let ad: any;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        let complete!: () => void;
        const closed = new Promise<void>(resolve => { complete = resolve; });
        const cleanup = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            this._interstitialBusy = false;
            this._lastInterstitialAttempt = Date.now();
            complete();
            try {
                ad?.offClose?.(cleanup);
                ad?.offError?.(onError);
                ad?.destroy?.();
            } catch (error) { console.warn('[InterstitialAd] 清理失败', error); }
        };
        const onError = (error: any) => {
            console.warn('[InterstitialAd] 插屏未展示', error?.errCode, error?.errMsg ?? error);
            cleanup();
        };
        try {
            ad = tt.createInterstitialAd({ adUnitId });
            ad.onClose(cleanup);
            ad.onError(onError);
            timer = setTimeout(() => onError({ errMsg: '插屏加载超时' }), 15000);
            await ad.load();
            if (settled) return;
            if (!canShow()) { cleanup(); return; }
            await ad.show();
            if (timer) clearTimeout(timer);
            await closed;
        } catch (error) { onError(error); }
    }

    public onRoundFinished(canShow: () => boolean): Promise<void> {
        return this.showInterstitial(canShow, true);
    }

    public get isHarmony(): boolean { return this.kind === 'douyin' && this.playerInfo.isOpenHarmony; }

    public async detectHarmony(): Promise<boolean> {
        if (this.kind !== 'douyin') return false;
        if (this.isHarmony) return true;
        await this.playerInfo.getSystemInfo();
        return this.isHarmony;
    }

    public configure(config: Partial<PlatformConfig>): void {
        this._config = { ...EMPTY_CONFIG, ...config };
        console.info('[PlatformService] 广告配置已加载', {
            platform: this.kind,
            douyinRewardedAdUnitId: this._config.douyinRewardedAdUnitId,
            wechatRewardedAdUnitId: this._config.wechatRewardedAdUnitId,
        });
    }

    public get kind(): RuntimeKind {
        // 构建目标优先，避免兼容环境同时暴露 wx/tt 时选错广告配置。
        if (BYTEDANCE) return 'douyin';
        if (WECHAT) return 'wechat';
        if (this._host.tt?.createRewardedVideoAd || this._host.tt?.login || this._host.tt?.getSystemInfo) return 'douyin';
        if (this._host.wx?.createRewardedVideoAd || this._host.wx?.login || this._host.wx?.getSystemInfo) return 'wechat';
        return 'h5';
    }

    public async showRewardedAd(_placement: RewardPlacement): Promise<RewardResult> {
        if (this._interstitialBusy) return { success: false, completed: false, simulated: false, reason: '请先关闭插屏广告' };
        if (this.kind === 'h5') {
            return { success: true, completed: true, simulated: true };
        }

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

        if (typeof sdk?.createRewardedVideoAd !== 'function') {
            return { success: false, completed: false, simulated: false, reason: '当前环境不支持激励视频广告，请使用真机预览' };
        }

        return new Promise<RewardResult>((resolve) => {
            let settled = false;
            const finish = (result: RewardResult) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            try {
                const ad = sdk.createRewardedVideoAd({ adUnitId });
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
        });
    }

    public share(levelKey: string): void {
        const query = `level=${levelKey}&from=share&campaign=default`;
        if (this.kind === 'wechat') {
            this._host.wx.shareAppMessage({ title: '来挑战我的找茬成绩！', query });
            return;
        }
        if (this.kind === 'douyin') {
            if (this.isPcCompanion) return;
            this._host.tt.shareAppMessage({
                title: '来挑战我的找茬成绩！',
                query,
                ...(this._config.douyinShareTemplateIds?.length ? {
                    templateId: this._config.douyinShareTemplateIds[Math.floor(Math.random() * this._config.douyinShareTemplateIds.length)],
                } : {}),
            });
            return;
        }

        const url = this._config.shareLandingUrl
            ? `${this._config.shareLandingUrl}?${query}`
            : globalThis.location?.href ?? query;
        this._host.navigator?.clipboard?.writeText(url).catch(() => undefined);
    }
}
