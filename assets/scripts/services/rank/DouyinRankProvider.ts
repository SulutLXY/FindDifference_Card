import type { PlatformService } from '../PlatformService';
import { RankProvider, RankResult, RankTab } from './RankProvider';
import type { SaveService } from '../SaveService';

const ZONE_ID = 'default';

/** 主域登录、上报成绩，并打开抖音原生排行榜。 */
export class DouyinRankProvider implements RankProvider {
    public constructor(private readonly _platform: PlatformService, private readonly _save?: SaveService) {}

    private get _tt(): any {
        return this._platform.kind === 'douyin' ? (globalThis as any).tt : null;
    }

    public supports(_tab: RankTab): boolean { return true; }

    public async fetch(_tab: RankTab): Promise<RankResult> {
        return { entries: [], available: false, selfRank: 0, message: '请使用抖音原生排行榜' };
    }

    public async openNative(): Promise<{ success: boolean; message?: string }> {
        if (this._platform.isHarmony || await this._platform.detectHarmony?.()) {
            return { success: false, message: '鸿蒙系统暂不支持抖音排行榜' };
        }
        if (typeof this._tt?.getImRankList !== 'function') {
            return { success: false, message: '当前环境不支持抖音排行榜，请在抖音手机端体验' };
        }
        const login = await this._platform.playerInfo.login(true);
        if (login.success === false) return { success: false, message: login.message };
        if (login.data.isAnonymous) return { success: false, message: '请登录抖音账号后重试' };
        try {
            const passed = this._save?.totalScore ?? 0;
            if (passed > 0) await this._call('setImRankData', { dataType: 0, value: String(passed), zoneId: ZONE_ID });
        } catch (error) {
            // 写入失败仍可打开已有榜单。
            console.warn('[DouyinRank] 打开前成绩同步失败', error);
        }
        try {
            await this._call('getImRankList', { dataType: 0, rankType: 'all', relationType: 'default',
                zoneId: ZONE_ID, suffix: '关', rankTitle: '通关排行榜' });
            return { success: true };
        } catch (error) {
            console.warn('[DouyinRank] 原生排行榜打开失败', error);
            return { success: false, message: error instanceof Error ? error.message : '抖音排行榜打开失败，请重试' };
        }
    }

    public submitScore(passed: number, _stars: number, _time: number): void {
        if (!Number.isInteger(passed) || passed < 0 || passed >= 2147483647) return;
        void this._submit(passed);
    }

    private async _submit(passed: number): Promise<void> {
        if (this._platform.isHarmony || await this._platform.detectHarmony?.()) return;
        const login = await this._platform.playerInfo.login(false);
        if (login.success === false || login.data.isAnonymous) {
            console.warn('[DouyinRank] 未登录，成绩未上报');
            return;
        }
        try {
            await this._call('setImRankData', { dataType: 0, value: String(passed), zoneId: ZONE_ID });
        } catch (error) {
            console.warn('[DouyinRank] 成绩上报失败', error);
        }
    }

    private _call(method: string, options: Record<string, unknown>): Promise<void> {
        return new Promise((resolve, reject) => {
            const tt = this._tt;
            if (typeof tt?.[method] !== 'function') { reject(new Error(`当前环境不支持 ${method}`)); return; }
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error); else resolve();
            };
            const timer = setTimeout(() => finish(new Error(`${method} 响应超时，请重试`)), 15000);
            try {
                tt[method]({ ...options, success: () => finish(),
                    fail: (error: any) => finish(new Error(`${method}: ${error?.errMsg ?? '调用失败'}${error?.errNo != null ? ` (${error.errNo})` : ''}`)),
                });
            } catch (error) { finish(error instanceof Error ? error : new Error(`${method} 调用异常`)); }
        });
    }
}
