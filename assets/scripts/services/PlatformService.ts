import { PlatformConfig, RewardPlacement, RewardResult } from '../core/GameTypes';
import { BYTEDANCE, WECHAT } from 'cc/env';

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
    private _config: PlatformConfig = EMPTY_CONFIG;

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
        if (this._host.tt?.createRewardedVideoAd) return 'douyin';
        if (this._host.wx?.createRewardedVideoAd) return 'wechat';
        return 'h5';
    }

    public async showRewardedAd(_placement: RewardPlacement): Promise<RewardResult> {
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
            this._host.tt.shareAppMessage({
                title: '来挑战我的找茬成绩！',
                query,
            });
            return;
        }

        const url = this._config.shareLandingUrl
            ? `${this._config.shareLandingUrl}?${query}`
            : globalThis.location?.href ?? query;
        this._host.navigator?.clipboard?.writeText(url).catch(() => undefined);
    }
}
