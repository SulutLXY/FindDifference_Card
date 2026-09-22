import { PlatformConfig, RewardPlacement, RewardResult } from '../core/GameTypes';

type RuntimeKind = 'h5' | 'wechat' | 'douyin';

const EMPTY_CONFIG: PlatformConfig = {
    cdnBaseUrl: '',
    apiBaseUrl: '',
    shareLandingUrl: '',
    wechatAppId: '',
    wechatRewardedAdUnitId: '',
    douyinAppId: '',
    douyinRewardedAdUnitId: '',
    rewardOnAnyClose: true,
};

export class PlatformService {
    private readonly _host = globalThis as any;
    private _config: PlatformConfig = EMPTY_CONFIG;

    public configure(config: Partial<PlatformConfig>): void {
        this._config = { ...EMPTY_CONFIG, ...config };
    }

    public get kind(): RuntimeKind {
        if (this._host.wx?.createRewardedVideoAd) return 'wechat';
        if (this._host.tt?.createRewardedVideoAd) return 'douyin';
        return 'h5';
    }

    public async showRewardedAd(_placement: RewardPlacement): Promise<RewardResult> {
        if (this.kind === 'h5') {
            return { success: true, completed: true, simulated: true };
        }

        const sdk = this.kind === 'wechat' ? this._host.wx : this._host.tt;
        const adUnitId = this.kind === 'wechat'
            ? this._config.wechatRewardedAdUnitId
            : this._config.douyinRewardedAdUnitId;

        if (!adUnitId) {
            return {
                success: false,
                completed: false,
                simulated: false,
                reason: '广告位尚未配置',
            };
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

    public share(levelId: number): void {
        const query = `level=${levelId}&from=share&campaign=default`;
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
