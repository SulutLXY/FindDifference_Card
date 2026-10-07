import type { RankEntry } from './RankProvider';

export const RANK_LIMIT = 99;
const NAMES = ['星河','小鹿','阿团','青禾','木木','北辰','夏雨','小满','云朵','南风',
    '夜猫子','晨光','风中追风','小火慢炖','像素骑士','薄荷糖','橘子汽水','月亮船','小熊软糖','山间清风',
    '海盐饼干','布丁','柠檬茶','糯米团','蓝莓','小蘑菇','向日葵','西瓜籽','白桃乌龙','松果',
    '芝麻汤圆','小鲸鱼','晚风','微光','春日','夏蝉','秋叶','冬雪','小麦','晴空',
    '甜豆','丸子','小鱼干','橙皮','可可','奶盖','竹影','晨露','花卷','糖栗子'];

/** 固定NPC池，不随机刷新名次，不上报抖音。 */
export function createNpcRankPool(): RankEntry[] {
    return NAMES.map((name, index) => ({
        name, avatarUrl: '', passed: 45 - Math.floor(index * 44 / 49),
        stars: 0, time: 0, isNpc: true,
    }));
}

export function sortRankPool(rows: RankEntry[]): RankEntry[] {
    return rows.map((row, order) => ({ row, order }))
        .sort((a, b) => b.row.passed - a.row.passed || Number(!!a.row.isNpc) - Number(!!b.row.isNpc) || a.order - b.order)
        .slice(0, RANK_LIMIT).map(item => item.row);
}
