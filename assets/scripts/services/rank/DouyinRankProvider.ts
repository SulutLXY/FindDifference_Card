import type { PlatformService } from '../PlatformService';
import { RankEntry, RankProvider, RankResult, RankTab } from './RankProvider';

/** 榜单分区：不同维度开多个 zoneId（如 'passed' 通关榜、'stars' 星数榜），当前用单一默认分区 */
const ZONE_ID = 'default';

/**
 * 抖音排行榜适配：tt.setImRankData 写成绩 / tt.getImRankData 取数。
 *
 * 取数策略：优先主域直接调 getImRankData（抖音 IM 榜为主域设计，无需微信式开放数据域；
 * 若真机验证好友数据存在域限制，好友页签会自动降级隐藏——supports/fetch 的 available 已兜底）。
 *
 * 注意：relationType 枚举与返回字段名以真机联调为准，下方解析做了防御式兼容。
 */
export class DouyinRankProvider implements RankProvider {
    private readonly _host = globalThis as any;
    private readonly _platform: PlatformService;

    public constructor(platform: PlatformService) {
        this._platform = platform;
    }

    private get _tt(): any {
        return this._platform.kind === 'douyin' ? this._host.tt : null;
    }

    public supports(tab: RankTab): boolean {
        const tt = this._tt;
        if (!tt || typeof tt.getImRankData !== 'function') return false;
        // 好友榜涉及关系链，可能受限；总榜默认支持。最终可用性以 fetch 结果为准。
        return tab === 'global' || tab === 'friend';
    }

    public async fetch(tab: RankTab): Promise<RankResult> {
        const tt = this._tt;
        if (!tt) return { entries: [], available: false };
        try {
            const res = await this._getImRankData({
                dataType: 0,
                relationType: tab === 'friend' ? 'friend' : 'all',
                zoneId: ZONE_ID,
            });
            const list = this._extractList(res);
            const entries = list.map((user: any, index: number) => this._toEntry(user, index));
            return { entries, available: entries.length > 0 };
        } catch (error) {
            console.warn(`[DouyinRank] 拉取${tab}榜失败，按不可用处理`, error);
            return { entries: [], available: false };
        }
    }

    public submitScore(passed: number, _stars: number, _time: number): void {
        const tt = this._tt;
        if (!tt || typeof tt.setImRankData !== 'function') return;
        const write = (): void => {
            tt.setImRankData({
                dataType: 0,
                value: String(passed),
                zoneId: ZONE_ID,
                success: (res: unknown) => console.log('[DouyinRank] 成绩上报成功', res),
                fail: (res: { errMsg?: string }) => console.warn('[DouyinRank] 成绩上报失败', res?.errMsg),
            });
        };
        // 登录态校验：过期先 login 再写
        if (typeof tt.checkSession === 'function') {
            tt.checkSession({
                success: write,
                fail: () => {
                    if (typeof tt.login !== 'function') return;
                    tt.login({ success: write, fail: (err: unknown) => console.warn('[DouyinRank] 登录失败，无法上报', err) });
                },
            });
        } else {
            write();
        }
    }

    /** Promise 化 tt.getImRankData */
    private _getImRankData(options: Record<string, unknown>): Promise<any> {
        const tt = this._tt;
        return new Promise((resolve, reject) => {
            tt.getImRankData({
                ...options,
                success: resolve,
                fail: reject,
            });
        });
    }

    /** 防御式解析返回列表（字段名以真机为准） */
    private _extractList(res: any): any[] {
        if (!res) return [];
        const list = res.dataList ?? res.data ?? res.list ?? res.rankList;
        return Array.isArray(list) ? list : [];
    }

    /** UserInfo → RankEntry（字段名以真机为准做兼容取值） */
    private _toEntry(user: any, _index: number): RankEntry {
        const value = Number(user?.value ?? user?.score ?? user?.data ?? 0) || 0;
        return {
            name: String(user?.nickName ?? user?.nickname ?? user?.name ?? '玩家'),
            avatarUrl: String(user?.avatarUrl ?? user?.avatar ?? ''),
            passed: value,
            stars: Number(user?.ext?.stars ?? user?.stars ?? 0) || 0,
            time: Number(user?.ext?.time ?? user?.time ?? 0) || 0,
            isSelf: Boolean(user?.isSelf ?? user?.self),
        };
    }
}
