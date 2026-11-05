export type AppScreen = 'lobby' | 'cities' | 'levels' | 'game';

export type CollectCategory = 'food' | 'porcelain';

export type RewardPlacement = 'revive' | 'hint' | 'add-time' | 'unlock-level' | 'unlock-chapter' | 'unlock-city' | 'level-select' | 'energy' | 'daily-sign-in';

export interface FoodCatalogEntry {
    id: string;
    cityKey: string;
    cityName: string;
    levelKey: string;
    name: string;
    desc: string;
    icon: string;
    reviews: string[];
    /** 旧美食目录未填时按 food；瓷器使用 porcelain。 */
    category?: CollectCategory;
    /** 资产排序编号；未填时沿用目录中的记录顺序。 */
    assetNumber?: number;
}

export interface FoodDetails {
    key: string;
    name: string;
    icon: string;
    foodName?: string;
    foodDesc?: string;
    reviews?: string[];
}

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
    /** Hit and marker radius relative to the displayed image's shorter side. */
    radius: number;
}

/** 等级设置：全局生命数、基础时长及每个额外差异增加的秒数。 */
export interface GradeConfig {
    maxLives: number;
    baseTimeSeconds: number;
    baseDifferenceCount: number;
    secondsPerExtraDifference: number;
}

/** configs/城市/关卡/differences.json 的原始格式。大图在 levels，封面在 thumbnails。 */
export interface LevelFileConfig {
    name: string;
    type: LevelType;
    topImage?: string;
    bottomImage?: string;
    icon?: string;
    foodName?: string;
    foodDesc?: string;
    reviews?: string[];
    differences: DifferenceConfig[];
}

/** 组装完成的关卡数据。key 是永久 ID，不代表当前章节或资源位置。 */
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
    foodName?: string;
    foodDesc?: string;
    reviews?: string[];
    differences: DifferenceConfig[];
}

/** 首包城市索引（resources/configs/cities.json，由 tools/build-manifest.py 生成）。 */
export interface CityIndex {
    cities: string[];
    /** 由每章源清单生成，启动/迁移不访问远程章节包。 */
    chapters: Record<string, CityMeta>;
    navigation?: string[];
    topics?: TopicConfig[];
}

/** 只组织叶子章节，不对应新资源包。 */
export interface TopicConfig {
    key: string;
    name: string;
    banner?: string;
    chapters: string[];
    defaultChapter: string;
}

export type ChapterSelection = CityConfig | TopicConfig;

/** 章节内容信息；公共解锁规则由 GameFlow 控制，不随各章资源发布。 */
export interface CityMeta {
    key: string;
    name: string;
    banner?: string;
    levels: Array<string | ChapterLevelEntry>;
    nextChapter?: string;
    legacyKeys?: string[];
}

/** 数组位置决定推关顺序；id 永久不变，name 和 folder 可独立修改。 */
export interface ChapterLevelEntry {
    id: string;
    name: string;
    folder: string;
}

/** 运行时城市数据：levels 按需懒加载填充 levelConfigs。 */
export interface CityConfig extends Omit<CityMeta, 'levels'> {
    levels: string[];
    levelIds?: Record<string, string>;
    levelNames?: Record<string, string>;
    levelsLoaded: boolean;
    levelConfigs: LevelConfig[];
}

export interface ChapterRulesConfig {
    version: number;
    legacyOrders: string[][];
}

/** 藏品条目（收藏页展示数据）。icon 为 resources 下 SpriteFrame 路径（不含扩展名）。 */
export interface CollectItem {
    id: string;
    name: string;
    desc: string;
    icon: string;
    /** 是否已获得；false 时图标置灰、获得时间显示「暂未获得」 */
    obtained?: boolean;
    category?: CollectCategory;
    assetNumber?: number;
    /** 本次打开页面时的新增排序快照，查看后不立即重排。 */
    newlyObtained?: boolean;
    /** 解锁时间展示文本（如 2026.09.25），未获得时忽略 */
    unlockTime?: string;
    /** 扩展数据（来源关卡、稀有度等，后续版本按需使用） */
    ext?: Record<string, string | number>;
}

export interface PlatformConfig {
    feed?: import('./Feed').FeedConfig;
    cdnBaseUrl: string;
    apiBaseUrl: string;
    shareLandingUrl: string;
    wechatAppId: string;
    wechatRewardedAdUnitId: string;
    douyinAppId: string;
    douyinRewardedAdUnitId: string;
    douyinInterstitialAdUnitId?: string;
    douyinShareTemplateIds?: string[];
    douyinFavoriteEntryRules?: Array<{ scene: string; launch_from?: string; location?: string }>;
    rewardOnAnyClose: boolean;
}

export interface LevelProgress {
    stars: number;
    bestTime: number;
}

/** 存档（v3）：通关集合 + 积分。积分 = 已通关关卡数，每通关一关 +1。 */
export interface SaveData {
    feed?: import('./Feed').FeedProgress;
    dailySignIn?: import('./DailySignIn').DailySignInProgress;
    /** 上次成功启动时的章节顺序快照，仅用于保留调整前已开放资格。 */
    contentLayout?: Record<string, string[]>;
    version: number;
    /** 开局体力；缺少该字段的旧档首次升级补入初始 15 点。 */
    energy?: number;
    energyUpdatedAt?: number;
    energyAdDay?: string;
    energyAdsUsed?: number;
    /** 激励视频授予的选关入口有效期，毫秒时间戳。 */
    levelSelectExpiresAt?: number;
    /** key（城市目录/关卡目录）→ 通关成绩 */
    completed: Record<string, LevelProgress>;
    /** 通过激励视频提前解锁的城市目录名。 */
    unlockedCities?: string[];
    /** 继续游戏以最后进入的大关卡为准，不按全局小关序号跳转。 */
    lastPlayedCityKey?: string;
    /** 最后成功加载的小关，用于跳关后的继续游戏。 */
    lastPlayedLevelKey?: string;
    /** 完整观看激励视频后永久解锁的小关，不计入通关成绩。 */
    unlockedLevels?: string[];
    /** 视频领取的收藏 ID；自然通关获得的收藏仍由 completed 判定。 */
    unlockedCollectibles?: string[];
    /** 已在收藏页实际展示过的收藏 ID。 */
    viewedCollectibles?: string[];
    chapterRulesVersion?: number;
    totalScore: number;
    /** 图鉴/成就（后续版本使用）：条目 id → 获得时间戳 */
    achievements: Record<string, number>;
    musicEnabled: boolean;
    soundEnabled: boolean;
    foodReviews?: Record<string, string>;
    freeHints?: number;
    freeAddTimes?: number;
    /** YYYY-MM-DD, Beijing time. */
    sidebarClaimDay?: string;
    favoriteClaimDay?: string;
    firstFailureInterstitialDay?: string;
    firstPlayedDay?: string;
    tutorialCompleted?: boolean;
    /** 分时引导：卡关时介绍提示/放大、时间不足时介绍加时，各只展示一次 */
    tutorialHintShown?: boolean;
    tutorialZoomShown?: boolean;
    tutorialAddTimeShown?: boolean;
}

export interface RewardResult {
    success: boolean;
    completed: boolean;
    simulated: boolean;
    reason?: string;
}
