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

export interface LevelConfig {
    id: number;
    name: string;
    timeLimit: number;
    maxLives: number;
    bundle: string;
    topImage: string;
    bottomImage: string;
    differences: DifferenceConfig[];
}

export interface LevelCollection {
    levels: LevelConfig[];
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
