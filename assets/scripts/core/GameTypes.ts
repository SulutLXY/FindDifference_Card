export type AppScreen = 'lobby' | 'cities' | 'levels' | 'game';

export type RewardPlacement = 'revive' | 'hint' | 'add-time';

/**
 * 关卡类型标记（开放取值，按标记分组做收集/图鉴等功能）：
 * normal 普通 / food 美食 / travel 风土人文 / 后续可扩展。
 */
export type LevelType = string;

export interface DifferenceConfig {
    id: string;
    /** Normalized coordinate measured from the top-left corner. */
    x: number;
    /** Normalized coordinate measured from the top-left corner. */
    y: number;
    /** Hit radius relative to the displayed image width. */
    radius: number;
}

/** 等级设置（configs/levels.json）：全局生命数与按差异数分档的时限。 */
export interface TimeTier {
    /** 差异数上限（含），按从小到大排列，取第一个满足档 */
    maxDifferences: number;
    timeLimit: number;
}

export interface GradeConfig {
    maxLives: number;
    timeTiers: TimeTier[];
}

/** 关卡目录内 differences.json 的原始格式。图片路径可覆盖目录推导；icon 缺省回退 scene-a。 */
export interface LevelFileConfig {
    name: string;
    type: LevelType;
    topImage?: string;
    bottomImage?: string;
    icon?: string;
    differences: DifferenceConfig[];
}

/** 组装完成的关卡运行时数据。key = "城市目录/关卡目录"，是存档与解锁的唯一标识。 */
export interface LevelConfig {
    key: string;
    name: string;
    type: LevelType;
    timeLimit: number;
    maxLives: number;
    topImage: string;
    bottomImage: string;
    /** 选关封面路径（icon 优先，缺省等于 topImage） */
    icon: string;
    differences: DifferenceConfig[];
}

/** 城市索引（levels/cities.json，由 tools/build-manifest.py 生成）。 */
export interface CityIndex {
    cities: string[];
}

/** 城市清单（city.json）：levels 由工具刷新，name/banner 等手工维护。 */
export interface CityMeta {
    key: string;
    name: string;
    banner?: string;
    levels: string[];
}

/** 运行时城市数据：levels 按需懒加载填充 levelConfigs。 */
export interface CityConfig extends CityMeta {
    levelsLoaded: boolean;
    levelConfigs: LevelConfig[];
}

export interface PlatformConfig {
    cdnBaseUrl: string;
    apiBaseUrl: string;
    shareLandingUrl: string;
    wechatAppId: string;
    wechatRewardedAdUnitId: string;
    douyinAppId: string;
    douyinRewardedAdUnitId: string;
    rewardOnAnyClose: boolean;
}

export interface LevelProgress {
    stars: number;
    bestTime: number;
}

/** 存档（v3）：通关集合 + 积分。积分 = 已通关关卡数，每通关一关 +1。 */
export interface SaveData {
    version: number;
    /** key（城市目录/关卡目录）→ 通关成绩 */
    completed: Record<string, LevelProgress>;
    totalScore: number;
    /** 图鉴/成就（后续版本使用）：条目 id → 获得时间戳 */
    achievements: Record<string, number>;
    musicEnabled: boolean;
    soundEnabled: boolean;
}

export interface RewardResult {
    success: boolean;
    completed: boolean;
    simulated: boolean;
    reason?: string;
}
