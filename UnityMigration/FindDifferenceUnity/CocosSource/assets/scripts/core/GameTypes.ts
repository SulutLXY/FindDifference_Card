export type AppScreen = 'lobby' | 'levels' | 'game';

export type RewardPlacement = 'revive' | 'hint' | 'add-time';

export interface DifferenceConfig {
    id: string;
    /** Normalized coordinate measured from the top-left corner. */
    x: number;
    /** Normalized coordinate measured from the top-left corner. */
    y: number;
    /** Hit radius relative to the displayed image width. */
    radius: number;
}

/** 关卡在 levels.json 中的条目：只含元信息与资源目录，差异点由目录内 differences.json 提供。 */
export interface LevelMeta {
    id: number;
    name: string;
    timeLimit: number;
    maxLives: number;
    /** resources 下的关卡目录，如 "levels/level-01"。目录内固定包含 scene-a.png / scene-b.png / differences.json。 */
    directory: string;
    /** 可选：选关卡片缩略图（resources 相对路径，如 "levels/level-01/thumbnail/spriteFrame"）。缺省时卡片保留模板自带贴图。 */
    thumbnail?: string;
}

/** 组装完成的关卡运行时数据（图片路径与差异点由 LevelMeta.directory 推导加载）。 */
export interface LevelConfig {
    id: number;
    name: string;
    timeLimit: number;
    maxLives: number;
    bundle: string;
    topImage: string;
    bottomImage: string;
    differences: DifferenceConfig[];
    /** 选关缩略图路径，可能为空。 */
    thumbnail?: string;
}

export interface LevelCollection {
    levels: LevelMeta[];
}

/** 各关目录内 differences.json 的格式：图片与差异点配置放在一起，替换资源时同目录改动。 */
export interface DifferenceCollection {
    differences: DifferenceConfig[];
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

export interface SaveData {
    version: number;
    unlockedLevel: number;
    levels: Record<string, LevelProgress>;
    musicEnabled: boolean;
    soundEnabled: boolean;
}

export interface RewardResult {
    success: boolean;
    completed: boolean;
    simulated: boolean;
    reason?: string;
}
