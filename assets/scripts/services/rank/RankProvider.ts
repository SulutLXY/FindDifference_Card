import { PlatformService } from '../PlatformService';
import { DouyinRankProvider } from './DouyinRankProvider';
import { LocalRankProvider } from './LocalRankProvider';

/** 排行榜条目：项目统一的榜单数据结构（RankScreen 只认这个） */
export interface RankEntry {
    /** 昵称 */
    name: string;
    /** 头像地址（https 远程或 resources 路径，空则使用本地头像池） */
    avatarUrl: string;
    /** 通关关卡数 */
    passed: number;
    /** 总星数（排序与展示用） */
    stars: number;
    /** 通关总用时（秒，排序用） */
    time: number;
    /** 是否当前玩家自己 */
    isSelf?: boolean;
}

/** 榜单拉取结果：available=false 时 UI 应隐藏对应页签 */
export interface RankResult {
    entries: RankEntry[];
    available: boolean;
}

export type RankTab = 'friend' | 'global';

/**
 * 排行榜平台适配接口。
 * 项目内所有榜单数据都经此接口获取，平台差异（抖音 tt.xxx、后续微信等）由各实现内部处理。
 */
export interface RankProvider {
    /** 当前平台是否支持该页签（false 则 UI 直接隐藏页签，不发请求） */
    supports(tab: RankTab): boolean;
    /** 拉取榜单；失败或为空时返回 available=false */
    fetch(tab: RankTab): Promise<RankResult>;
    /** 上报成绩（具体写入时机由 GameFlow 决定，如关卡结算/破纪录） */
    submitScore(passed: number, stars: number, time: number): void;
}

/** 按平台创建排行榜适配器：现在只有抖音接真实数据，其余环境走本地数据 */
export function createRankProvider(platform: PlatformService, save: import('../SaveService').SaveService): RankProvider {
    if (platform.kind === 'douyin') {
        return new DouyinRankProvider(platform);
    }
    return new LocalRankProvider(save);
}
