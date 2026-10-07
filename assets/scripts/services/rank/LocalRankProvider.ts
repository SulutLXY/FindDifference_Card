import type { SaveService } from '../SaveService';
import { RankEntry, RankProvider, RankResult, RankTab } from './RankProvider';
import { createNpcRankPool, sortRankPool } from './NpcRankPool';

/** 浏览器本地预览；好友列表不伪造关系链，总榜使用固定NPC池。 */
export class LocalRankProvider implements RankProvider {
    public constructor(private readonly _save: SaveService) {}

    public supports(_tab: RankTab): boolean { return true; }

    public async fetch(tab: RankTab): Promise<RankResult> {
        const self: RankEntry = { name: '我', avatarUrl: '', passed: this._save.totalScore,
            stars: 0, time: 0, isSelf: true };
        const pool = tab === 'global' ? createNpcRankPool() : [];
        if (self.passed > 0) pool.push(self);
        const entries = sortRankPool(pool);
        const index = entries.findIndex(row => row.isSelf);
        return { entries, available: true, self, selfRank: index >= 0 ? index + 1 : 0,
            message: tab === 'global' ? '含模拟玩家' : '本地预览暂无好友数据' };
    }

    public submitScore(_passed: number, _stars: number, _time: number): void {}
}
