import type { SaveService } from '../SaveService';
import { RankEntry, RankProvider, RankResult, RankTab } from './RankProvider';

/** 假数据：好友榜（接入真实平台数据前的本地兜底，阶段 D 可删减） */
const FRIEND_RANK: RankEntry[] = [
    { name: '星河', avatarUrl: '', passed: 10, stars: 28, time: 640 },
    { name: '小鹿', avatarUrl: '', passed: 10, stars: 26, time: 700 },
    { name: '阿团', avatarUrl: '', passed: 9, stars: 24, time: 730 },
    { name: '青禾', avatarUrl: '', passed: 9, stars: 22, time: 780 },
    { name: '木木', avatarUrl: '', passed: 8, stars: 20, time: 820 },
    { name: '北辰', avatarUrl: '', passed: 8, stars: 18, time: 860 },
    { name: '夏雨', avatarUrl: '', passed: 7, stars: 16, time: 900 },
    { name: '小满', avatarUrl: '', passed: 6, stars: 13, time: 980 },
    { name: '云朵', avatarUrl: '', passed: 5, stars: 10, time: 1050 },
    { name: '南风', avatarUrl: '', passed: 4, stars: 8, time: 1150 },
];

/** 假数据：全服榜 */
const GLOBAL_RANK: RankEntry[] = [
    { name: '王者之眼', avatarUrl: '', passed: 10, stars: 30, time: 560 },
    { name: '无敌手速', avatarUrl: '', passed: 10, stars: 29, time: 590 },
    { name: '找茬宗师', avatarUrl: '', passed: 10, stars: 29, time: 610 },
    { name: '全服第四', avatarUrl: '', passed: 10, stars: 28, time: 630 },
    { name: '夜猫子', avatarUrl: '', passed: 10, stars: 27, time: 660 },
    { name: '晨光', avatarUrl: '', passed: 10, stars: 26, time: 690 },
    { name: '风中追风', avatarUrl: '', passed: 9, stars: 25, time: 720 },
    { name: '小火慢炖', avatarUrl: '', passed: 9, stars: 24, time: 750 },
    { name: '像素骑士', avatarUrl: '', passed: 9, stars: 23, time: 790 },
    { name: '路过', avatarUrl: '', passed: 8, stars: 21, time: 830 },
];

/**
 * 本地排行榜：无平台（h5）或未接入平台时的兜底数据。
 * 假数据 + 自己的真实成绩混排，接口形态与平台实现完全一致。
 */
export class LocalRankProvider implements RankProvider {
    private readonly _save: SaveService;

    public constructor(save: SaveService) {
        this._save = save;
    }

    public supports(tab: RankTab): boolean {
        return tab === 'friend' || tab === 'global';
    }

    public async fetch(tab: RankTab): Promise<RankResult> {
        const source = tab === 'friend' ? FRIEND_RANK : GLOBAL_RANK;
        const entries = source.map(row => ({ ...row }));
        entries.push(this._myRow());
        entries.sort((a, b) => b.passed - a.passed || b.stars - a.stars || a.time - b.time);
        return { entries, available: true };
    }

    public submitScore(_passed: number, _stars: number, _time: number): void {
        // 本地环境无服务端，仅存档，无需上报
    }

    /** 自己：积分=通关数；星数与用时从通关集合统计（排序用） */
    private _myRow(): RankEntry {
        const completed = this._save.data.completed;
        let stars = 0;
        let time = 0;
        for (const key of Object.keys(completed)) {
            const progress = completed[key];
            if (progress && progress.stars > 0) {
                stars += progress.stars;
                time += progress.bestTime;
            }
        }
        return { name: '我', avatarUrl: '', passed: this._save.totalScore, stars, time, isSelf: true };
    }
}
