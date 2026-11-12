import { FoodTips } from './ui/FoodTips';
import { EventTips } from './ui/EventTips';
import { GameTips } from './ui/GameTips';
import { PREVIEW } from 'cc/env';
import {
    _decorator,
    assetManager,
    AssetManager,
    AudioClip,
    AudioSource,
    BlockInputEvents,
    Color,
    Component,
    director,
    Director,
    Graphics,
    game,
    Game,
    JsonAsset,
    instantiate,
    Label,
    Node,
    Prefab,
    SpriteFrame,
    Sprite,
    UITransform,
    UIOpacity,
    Vec3,
    resources,
    tween,
} from 'cc';
import {
    CityConfig,
    ChapterSelection,
    TopicConfig,
    ChapterRulesConfig,
    FoodCatalogEntry,
    CityIndex,
    DifferenceConfig,
    GradeConfig,
    LevelConfig,
    LevelFileConfig,
    PlatformConfig,
    RewardPlacement,
    RewardResult,
    SurpriseAssistKind,
} from './core/GameTypes';
import { PlatformService } from './services/PlatformService';
import { SaveService } from './services/SaveService';
import { ContentBundlePool } from './services/ContentBundlePool';
import { BackgroundMusicMixer } from './services/BackgroundMusicMixer';
import { SidebarService, sidebarDay } from './services/SidebarService';
import { createRankProvider } from './services/rank/RankProvider';
import { registerGameFlow } from './ui/UIScreen';
import { CitySelectScreen } from './ui/CitySelectScreen';
import { CollectScreen } from './ui/CollectScreen';
import { GameScreen } from './ui/GameScreen';
import { LevelSelectScreen } from './ui/LevelSelectScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { RankScreen } from './ui/RankScreen';
import { ResultModal } from './ui/ResultModal';
import { SettingsModal } from './ui/SettingsModal';
import { UIAnimationBinding } from './ui/UIAnimationBinding';
import { TouchPointEffect } from './ui/TouchPointEffect';
import { DailySignInModal } from './ui/DailySignInModal';
import { DailySignInConfig } from './core/DailySignIn';
import { FavoriteGift } from './ui/FavoriteGift';
import { LobbyEntries } from './ui/LobbyEntries';
import { FeedService } from './services/FeedService';
import { PlayStatsService } from './services/PlayStatsService';

const { ccclass, property } = _decorator;

interface PageSpriteEntry {
    frame: SpriteFrame | null;
    pending: Promise<SpriteFrame | null>;
    releaseBundle?: () => void;
}

/**
 * 全局流程状态机：持有存档、平台服务、城市/关卡配置与对局状态，
 * 负责界面切换、倒计时、激励视频与结算。
 * 场景中唯一实例，界面组件通过 GameFlow.instance 访问。
 *
 * 章节索引在首包；封面、美食图标独立成包；各章配置、小关缩略图和大图随章加载。
 * resources/configs/cities.json 为城市索引，city-configs 的 城市目录名.json 列关卡清单，
 * 进关时只读取目标关卡配置，选关页读取本城全部关卡配置。
 */
@ccclass('GameFlow')
export class GameFlow extends Component {
    private static _instance: GameFlow | null = null;

    public static get instance(): GameFlow {
        if (!GameFlow._instance) {
            throw new Error('[GameFlow] 实例尚未初始化，请确认场景中存在 GameFlow 节点');
        }
        return GameFlow._instance;
    }

    @property({ type: LobbyScreen, tooltip: '大厅界面组件（Screens/Lobby）' })
    public lobby: LobbyScreen | null = null;
    private _lobbyBundle: AssetManager.Bundle | null = null;
    private _lobbyBundlePending: Promise<AssetManager.Bundle> | null = null;
    private _lobbyPending: Promise<LobbyScreen> | null = null;
    private _lobbyReturnVersion = -1;
    private _lobbyReturnWasPaused = false;
    /** Cold startup downloads only remote gameplay/current chapter; menu warmup waits eight active seconds. */
    private _lobbyWarmupRemaining: number | null = null;
    private _lobbyWarmupStarted = false;
    private _sharedUIReady = false;
    private _sharedUIPending: Promise<void> | null = null;

    @property({ type: CitySelectScreen, tooltip: '城市选择界面组件（Screens/CitySelect）' })
    public citySelect: CitySelectScreen | null = null;

    @property({ type: LevelSelectScreen, tooltip: '选关界面组件（Screens/LevelSelect）' })
    public levelSelect: LevelSelectScreen | null = null;
    private readonly _navigationPagesPending = new Map<'citySelect' | 'levelSelect', Promise<CitySelectScreen | LevelSelectScreen>>();

    @property({ type: GameScreen, tooltip: '对局界面：首次进关从 MainGameSources 动态创建，无需拖拽绑定' })
    public game: GameScreen | null = null;

    @property({ type: RankScreen, tooltip: '排行榜：从远程 LobbySources/SecondaryUI 创建，无需拖拽绑定' })
    public rank: RankScreen | null = null;

    @property({ type: CollectScreen, tooltip: '收藏页：从远程 LobbySources/SecondaryUI 创建，无需拖拽绑定' })
    public collect: CollectScreen | null = null;

    @property({ type: ResultModal, tooltip: '结算弹窗：首次进关从 MainGameSources 动态创建，无需拖拽绑定' })
    public resultModal: ResultModal | null = null;

    public readonly save = new SaveService();
    public readonly platform = new PlatformService();
    public readonly feed = new FeedService(this.save, this.platform);
    public readonly playStats = new PlayStatsService();
    private _feedStart: (() => void) | null = null;
    private _feedPauseBeforePreview: boolean | null = null;
    private _feedOffer: { token: string; version: number } | null = null;
    /** 排行榜平台适配层：抖音真实榜单，其余环境本地兜底（见 services/rank） */
    public readonly rankProvider = createRankProvider(this.platform, this.save);

    private _grades: GradeConfig = { maxLives: 3, baseTimeSeconds: 150, baseDifferenceCount: 10, secondsPerExtraDifference: 15, maxTimeSeconds: 300 };
    private _cities: CityConfig[] = [];
    private _currentCity: CityConfig | null = null;
    private _selectedTopic: TopicConfig | null = null;
    private _dailyConfig: DailySignInConfig | null = null;
    private _dailySignIn: DailySignInModal | null = null;
    private _dailyLoading: Promise<DailySignInModal> | null = null;
    private _dailyOpening = false;
    private _dailyAttemptDay = '';
    private _currentLevel: LevelConfig | null = null;
    private _remainingTime = 0;
    private _elapsedTime = 0;
    private _lives = 0;
    private readonly _foundIds = new Set<string>();
    private _isPaused = false;
    private _isGameOver = false;
    private _reviveUsed = false;
    private _combo = 0;
    private _lastFoundAt = 0;
    /** 本局最近一次找到差异时的 elapsedTime，用于卡关检测 */
    private _lastFoundElapsed = 0;
    private _comboSource: AudioSource | null = null;
    private _clickSource: AudioSource | null = null;
    private _resultSource: AudioSource | null = null;
    private readonly _resultClips = new Map<boolean, Promise<AudioClip>>();
    private _resultSoundRequest = 0;
    private readonly _comboClips = new Map<string, Promise<AudioClip>>();
    private readonly _chapterComboClips = new Set<AudioClip>();
    private _chapterComboGroup: { name: string; chapterBundle: string; stages: Map<number, string> } | null = null;
    /** 无章节专属连击组时使用远程 MainGameSources 中的通用组。 */
    private static readonly DEFAULT_COMBO_GROUP = 'Combo _F_type01';
    /** 局内资源包里的连击音效目录。 */
    private static readonly BUNDLE_COMBO_ROOT = 'voice/Combo _F_type';
    /** 本关使用的连击音效组（仅影响 1-5 号），第四关起进入关卡时随机 */
    private _activeComboGroup = GameFlow.DEFAULT_COMBO_GROUP;
    /** 已发现的音效组：组目录名 → 各档位路径与加载渠道。 */
    private _comboGroups: Map<string, { stages: Map<number, string>; fromBundle: boolean }> | null = null;
    /** 上次发现时是否已扫描过 Bundle；Bundle 就绪后需要重新发现才能看到新组 */
    private _comboGroupsScannedBundle = false;
    private _comboSoundRequest = 0;
    private readonly _spriteFrameCache = new Map<string, SpriteFrame>();
    /** 封面/横幅按页面持有；页面关闭或列表重建时释放，不使用内存预算。 */
    private readonly _pageSpriteFrames = new Map<Node, Map<string, PageSpriteEntry>>();
    private _pageSpritesDisposed = false;
    private readonly _contentBundles = new ContentBundlePool();
    private readonly _levelFrameBundles = new Map<SpriteFrame, Array<() => void>>();
    private _cityIndex: CityIndex | null = null;
    private _gameBundle: AssetManager.Bundle | null = null;
    private _gameBundlePending: Promise<AssetManager.Bundle> | null = null;
    private _gameScreensPending: Promise<void> | null = null;
    private _secondaryBundle: AssetManager.Bundle | null = null;
    private _secondaryBundlePending: Promise<AssetManager.Bundle> | null = null;
    private readonly _secondaryPagesPending = new Map<'rank' | 'collect', Promise<RankScreen | CollectScreen>>();
    private readonly _secondaryPrefabs = new Map<'rank' | 'collect', Prefab>();
    private _secondaryNavigationVersion = 0;
    private _secondaryPageLoading = false;
    private _secondaryDisposed = false;
    private _musicMixer: BackgroundMusicMixer | null = null;
    private _musicPath = '';
    private readonly _musicClips = new Map<string, AudioClip>();
    private _musicRequest = 0;
    private _chapterMusic: { path: string; chapterBundle: string } | null = null;
    /** 第五关起随机游戏背景音乐的候选池（MainGameSources/voice/BGmusic） */
    private static readonly GAME_MUSIC_POOL = [
        'voice/BGmusic/Game_music02',
        'voice/BGmusic/Game_music03',
        'voice/BGmusic/Game_music04',
    ];
    /** 当前随机到的游戏背景音乐（bundle 路径）；空串表示新手期固定曲目 */
    private _gameMusicPath = '';
    /** 随机音乐模式下连续游玩的关数，每满两关换一首 */
    private _gameMusicStreak = 0;
    private _foodTips: FoodTips | null = null;
    private _eventTips: EventTips | null = null;
    private _foods: FoodCatalogEntry[] = [];

    public get foods(): readonly FoodCatalogEntry[] { return this._foods; }

    public showCatalogFood(food: FoodCatalogEntry, unlocked = false): void {
        this._foodTips?.present({ key: food.levelKey || food.id, name: food.name,
            foodName: food.name, foodDesc: food.desc, icon: food.icon, reviews: food.reviews }, unlocked);
    }

    /** 收藏页直接看视频领取收藏，并永久开放它对应的关卡。 */
    public async requestCollectibleUnlock(id: string): Promise<boolean> {
        const item = this._foods.find(food => food.id === id);
        if (!item) return false;
        if (this.save.isCollectibleObtained(item.id, item.levelKey)) return true;
        const city = this._cities.find(chapter => chapter.levels.some(folder =>
            (chapter.levelIds?.[folder] ?? `${chapter.key}/${folder}`) === item.levelKey));
        if (!item.levelKey || !city) { this.toast('该收藏暂未关联可玩关卡'); return false; }
        let unlocked = false;
        await this.requestReward('unlock-level', () => {
            unlocked = this.save.unlockCollectible(item.id, item.levelKey, city.key);
            this.toast(unlocked ? `已获得收藏：${item.name}` : '收藏解锁保存失败，请稍后重试');
        });
        return unlocked;
    }
    private _settings: SettingsModal | null = null;
    private _settingsInGame = false;
    private _settingsOpenedAt = 0;
    private _loadingNode: Node | null = null;
    private _loadingFill: UITransform | null = null;
    private _loadingCat: Node | null = null;
    private _loadingLabel: Label | null = null;
    private _loadingWidth = 0;
    private _loadingLeft = 0;
    private _booting = false;
    private _bootFailed = false;

    private _initLoading(): void {
        const screens = this.node.parent?.getChildByName('Screens');
        this._loadingNode = screens?.getChildByName('Loading') ?? null;
        if (!this._loadingNode) return;
        if (!this._loadingNode.getComponent(BlockInputEvents)) this._loadingNode.addComponent(BlockInputEvents);
        for (const child of screens!.children) child.active = child === this._loadingNode;
        const bg = this._loadingNode.getChildByName('loading_sliderBG');
        const fill = bg?.getChildByName('loading_slider');
        this._loadingCat = bg?.getChildByName('Londing_ICON') ?? null;
        const back = this._loadingNode.getChildByName('LoadingBack');
        if (back) back.active = false;
        this._loadingFill = fill?.getComponent(UITransform) ?? null;
        this._loadingLabel = this._loadingNode.getChildByName('FooterEnv-001')?.getComponent(Label) ?? null;
        if (this._loadingFill && fill) {
            this._loadingWidth = this._loadingFill.width;
            this._loadingLeft = fill.position.x - this._loadingWidth * this._loadingFill.anchorX * fill.scale.x;
            const sprite = fill.getComponent(Sprite);
            if (sprite) sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
        bg?.on(Node.EventType.TOUCH_END, this._retryStartup, this);
        this._setLoadingProgress(0);
    }

    private _retryStartup(): void {
        if (this._bootFailed && !this._booting) void this._bootstrap();
    }

    private _setLoadingProgress(progress: number): void {
        const value = Math.max(0, Math.min(1, progress));
        const fill = this._loadingFill;
        if (fill) {
            fill.width = this._loadingWidth * value;
            fill.node.setPosition(this._loadingLeft + fill.width * fill.anchorX * fill.node.scale.x,
                fill.node.position.y, fill.node.position.z);
            if (this._loadingCat) {
                this._loadingCat.setPosition(this._loadingLeft + fill.width * fill.node.scale.x,
                    this._loadingCat.position.y, this._loadingCat.position.z);
            }
        }
        if (this._loadingLabel) this._loadingLabel.string = `加载中 ${Math.floor(value * 100)}%`;
    }

    protected onLoad(): void {
        game.on(Game.EVENT_SHOW, this.promptDailySignIn, this);
        this.platform.canShowInterstitial = () => this.save.data.firstPlayedDay === sidebarDay()
            && !this._roundInterstitialProtected && !this._dailySignIn?.node.activeInHierarchy;
        GameFlow._instance = this;
        registerGameFlow(this);
        this.platform.canUseInteractiveFeatures = () => !this.feed.isPreview;
        this.platform.beforeFeedSubscribe = () => this.feed.reserveSubscriptionAttempt();
        this.platform.onFeedSubscribeSuccess = () => { void this.feed.scheduleRevisit(); };
        this.feed.onPreviewChanged = () => this._onFeedPreviewChanged();
        this.feed.start();
        void this.platform.sidebar.start();
        this._initLoading();
        this._musicMixer = new BackgroundMusicMixer([
            this.node.addComponent(AudioSource), this.node.addComponent(AudioSource),
        ]);
        this._comboSource = this.node.addComponent(AudioSource);
        this._comboSource.playOnAwake = false;
        this._comboSource.loop = false;
        this._clickSource = this.node.addComponent(AudioSource);
        this._clickSource.playOnAwake = false;
        this._clickSource.loop = false;
        this._resultSource = this.node.addComponent(AudioSource);
        this._resultSource.playOnAwake = false;
        this._resultSource.loop = false;
        this.node.on(AudioSource.EventType.STARTED, this._onResultAudioStarted, this);
        this.node.on(AudioSource.EventType.ENDED, this._onResultAudioEnded, this);
    }

    private _initSharedUI(): void {
        const foodTips = this.node.parent?.getChildByName('FoodTips');
        if (foodTips) {
            foodTips.active = false;
            this._foodTips = foodTips.getComponent(FoodTips) ?? foodTips.addComponent(FoodTips);
        }
        const eventTips = this.node.parent?.getChildByName('EventTips');
        if (eventTips) {
            eventTips.active = false;
            this._eventTips = eventTips.getComponent(EventTips) ?? eventTips.addComponent(EventTips);
        }
        const uiRoot = this.node.parent;
        if (uiRoot && !uiRoot.getComponent(UIAnimationBinding)) uiRoot.addComponent(UIAnimationBinding);
        if (uiRoot) {
            if (!uiRoot.getComponent(LobbyEntries)) uiRoot.addComponent(LobbyEntries);
            if (!uiRoot.getComponent(FavoriteGift)) uiRoot.addComponent(FavoriteGift);
            const touchPoint = uiRoot.getComponent(TouchPointEffect) ?? uiRoot.addComponent(TouchPointEffect);
            touchPoint.playClickSound = event => {
                if (this._tutorial?.node.activeInHierarchy) return;
                const target = event.target as Node | null;
                if (GameFlow._hasAncestorNamed(target, 'BtnBack')) { this.playBackSound(); return; }
                // 提示/加时/放大按钮由各自逻辑播专属音效，跳过通用点击音
                if (GameFlow._hasAncestorNamed(target, 'BtnHint', 'BtnAddTime', 'BtnZoom')) return;
                if (!this.game?.isImageTouchTarget(target)) this.playClickSound();
            };
        }
        const settings = this.node.parent?.getChildByName('Settings');
        if (settings) {
            settings.active = false;
            this._settings = settings.getComponent(SettingsModal) ?? settings.addComponent(SettingsModal);
        }
    }

    protected start(): void {
        void this._bootstrap();
    }

    protected update(dt: number): void {
        if (this.feed?.isPreview) return;
        // 大厅、Loading、暂停和结算期间也必须推进切歌包络。
        this._musicMixer?.update(dt);
        this._tryFeedOffer();
        if (this.platform.interstitialBusy || this._levelLoading) return;
        if (this._isGameOver || this._isPaused || !this._currentLevel) return;
        if (!this.game || !this.game.node.active) return;
        this._tickLobbyWarmup(dt);
        this._remainingTime = Math.max(0, this._remainingTime - dt);
        this._elapsedTime += dt;
        this.game.refreshHud();
        if (this._remainingTime <= 0) { this.finishLevel(false, 'time'); return; }
        this._maybeShowAssistTutorial();
    }

    public get cities(): readonly CityConfig[] {
        return this._cities;
    }

    public get chapterSelections(): ChapterSelection[] {
        if (this._selectedTopic) return this._selectedTopic.chapters
            .map(key => this._cities.find(city => city.key === key)).filter((city): city is CityConfig => !!city);
        const topics = this._cityIndex?.topics ?? [];
        return (this._cityIndex?.navigation ?? this._cities.map(city => city.key))
            .map(key => topics.find(topic => topic.key === key) ?? this._cities.find(city => city.key === key))
            .filter((item): item is ChapterSelection => !!item);
    }

    public get chapterSelectionTitle(): string { return this._selectedTopic?.name ?? '关卡选择'; }

    public selectionProgress(item: ChapterSelection): { done: number; total: number } {
        if (!('chapters' in item)) return this.cityProgress(item);
        return item.chapters.reduce((sum, key) => {
            const city = this._cities.find(city => city.key === key);
            const progress = city ? this.cityProgress(city) : { done: 0, total: 0 };
            return { done: sum.done + progress.done, total: sum.total + progress.total };
        }, { done: 0, total: 0 });
    }

    /** 按当前章节的永久关卡 ID 匹配藏品；分组包含任一藏品即可显示宝箱。 */
    public selectionHasCollectibles(item: ChapterSelection): boolean {
        const chapters = 'chapters' in item
            ? this._cities.filter(city => item.chapters.includes(city.key)) : [item];
        const levelIds = new Set(chapters.flatMap(city => city.levels.map(folder =>
            city.levelIds?.[folder] ?? `${city.key}/${folder}`)));
        return this._foods.some(food => levelIds.has(food.levelKey));
    }

    public async enterChapterSelection(item: ChapterSelection): Promise<void> {
        if ('chapters' in item) this.showCitySelect(item.key);
        else await this.enterCity(item);
    }

    public backFromCitySelection(): void {
        if (this._selectedTopic) this.showCitySelect();
        else this.returnToLobby();
    }

    public returnToChapterSelection(): void {
        const topic = this._cityIndex?.topics?.find(item => item.chapters.includes(this._currentCity?.key ?? ''));
        this.showCitySelect(topic?.key);
    }

    public get currentCity(): CityConfig | null {
        return this._currentCity;
    }

    public get currentLevel(): LevelConfig | null {
        return this._currentLevel;
    }

    public get remainingTime(): number {
        return this._remainingTime;
    }

    public get elapsedTime(): number {
        return this._elapsedTime;
    }

    public get lives(): number {
        return this._lives;
    }

    public get foundIds(): ReadonlySet<string> {
        return this._foundIds;
    }

    public get isPaused(): boolean {
        return this._isPaused || this._levelLoading || !!this.feed?.isPreview;
    }

    public get isGameOver(): boolean {
        return this._isGameOver;
    }

    // ------------------------------------------------------------------
    // 界面切换
    // ------------------------------------------------------------------

    public showLobby(): void {
        this.resultModal?.close();
        if (this.lobby?.isValid) { this._switchTo(this.lobby); return; }
        void this._openLobby();
    }

    /** Foreground fallback shares the background request, and never opens after navigation changes. */
    private async _openLobby(): Promise<void> {
        const paused = this._lobbyReturnVersion === this._secondaryNavigationVersion && this._secondaryPageLoading
            ? this._lobbyReturnWasPaused : this._isPaused;
        this._cancelSecondaryNavigation();
        const version = this._secondaryNavigationVersion;
        this._lobbyReturnVersion = version;
        this._lobbyReturnWasPaused = paused;
        this._isPaused = true;
        this._secondaryPageLoading = true;
        if (this._loadingNode) { this._loadingNode.active = true; this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1); }
        try {
            const lobby = await this._ensureLobby();
            if (!this.isValid || version !== this._secondaryNavigationVersion) return;
            this._switchTo(lobby);
        } catch (error) {
            if (!this.isValid || version !== this._secondaryNavigationVersion) return;
            this._isPaused = paused;
            this._secondaryPageLoading = false;
            if (!this._currentLevel) this._bootFailed = true;
            if (this._loadingNode) this._loadingNode.active = this._bootFailed;
            this.toast('主页加载失败，请检查网络后重试');
            console.warn('[GameFlow] 主页加载失败', error);
        }
    }

    private _loadLobbyBundle(): Promise<AssetManager.Bundle> {
        if (this._lobbyBundle) return Promise.resolve(this._lobbyBundle);
        if (this._lobbyBundlePending) return this._lobbyBundlePending;
        this._lobbyBundlePending = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle('LobbySources', (error, bundle) => {
                if (error || !bundle || !this.isValid) reject(error ?? new Error('主页资源包不可用'));
                else { this._lobbyBundle = bundle; resolve(bundle); }
            });
        }).finally(() => { this._lobbyBundlePending = null; });
        return this._lobbyBundlePending;
    }

    public async loadLobbyPrefab(path: string): Promise<Prefab> {
        const bundle = await this._loadLobbyBundle();
        return new Promise((resolve, reject) => bundle.load(path, Prefab, (error, prefab) => error ? reject(error) : resolve(prefab)));
    }

    private _ensureLobby(): Promise<LobbyScreen> {
        if (this.lobby?.isValid) return Promise.resolve(this.lobby);
        if (this._lobbyPending) return this._lobbyPending;
        this._lobbyPending = (async () => {
            if (!this._sharedUIReady) await this._ensureSharedUI();
            const prefab = await this.loadLobbyPrefab('prefabs/LobbyScreen');
            if (!this.isValid) throw new Error('游戏流程已销毁');
            const screens = this.node.parent?.getChildByName('Screens');
            if (!screens) throw new Error('主页容器不存在');
            const node = instantiate(prefab); node.active = false; node.name = 'Lobby';
            const lobby = node.getComponent(LobbyScreen);
            if (!lobby) { node.destroy(); throw new Error('主页预制体缺少 LobbyScreen'); }
            this.lobby = lobby; node.parent = screens;
            return lobby;
        })().finally(() => { this._lobbyPending = null; });
        return this._lobbyPending;
    }

    private async _preloadLobby(): Promise<void> {
        try {
            await this._ensureLobby();
            if (!this.isValid) return;
            const bundle = await this._loadLobbyBundle();
            await new Promise<void>((resolve, reject) => bundle.load('voice/BGmusic/Main_music00', AudioClip, (error, clip) => {
                if (error) reject(error);
                else { if (this.isValid) this._cacheMusicClip('voice/BGmusic/Main_music00', clip); resolve(); }
            }));
        } catch (error) { if (this.isValid) console.warn('[GameFlow] 主页后台预加载失败，返回时可重试', error); }
    }

    private _tickLobbyWarmup(dt: number): void {
        if (!this.isValid || this._lobbyWarmupStarted || this._lobbyWarmupRemaining == null) return;
        if (this.feed?.isPreview || this._levelLoading || this._isPaused || this._isGameOver
            || !this.game?.node.activeInHierarchy || this.platform.interstitialBusy) return;
        this._lobbyWarmupRemaining -= Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 1) : 0;
        if (this._lobbyWarmupRemaining > 0) return;
        this._lobbyWarmupRemaining = null;
        this._lobbyWarmupStarted = true;
        if (!this.lobby?.isValid) void this._preloadLobby();
    }

    private _ensureNavigationPage(kind: 'citySelect' | 'levelSelect'): Promise<CitySelectScreen | LevelSelectScreen> {
        if (this[kind]?.isValid) return Promise.resolve(this[kind]!);
        const pending = this._navigationPagesPending.get(kind);
        if (pending) return pending;
        const request = (async () => {
            const name = kind === 'citySelect' ? 'CitySelect' : 'LevelSelect';
            const prefab = await this.loadLobbyPrefab(`prefabs/${name}Screen`);
            if (!this.isValid) throw new Error('游戏流程已销毁');
            const screens = this.node.parent?.getChildByName('Screens');
            if (!screens) throw new Error('界面容器不存在');
            const node = instantiate(prefab); node.active = false; node.name = name;
            const page = kind === 'citySelect' ? node.getComponent(CitySelectScreen) : node.getComponent(LevelSelectScreen);
            if (!page) { node.destroy(); throw new Error('导航页面组件缺失'); }
            if (kind === 'citySelect') this.citySelect = page as CitySelectScreen;
            else this.levelSelect = page as LevelSelectScreen;
            node.parent = screens;
            return page;
        })().finally(() => this._navigationPagesPending.delete(kind));
        this._navigationPagesPending.set(kind, request);
        return request;
    }

    private async _openNavigationPage(kind: 'citySelect' | 'levelSelect'): Promise<void> {
        this._cancelSecondaryNavigation();
        const version = this._secondaryNavigationVersion;
        this._secondaryPageLoading = true;
        if (this._loadingNode) { this._loadingNode.active = true; this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1); }
        try {
            const page = await this._ensureNavigationPage(kind);
            if (!this.isValid || version !== this._secondaryNavigationVersion) return;
            this._switchTo(page);
        } catch (error) {
            if (!this.isValid || version !== this._secondaryNavigationVersion) return;
            this._secondaryPageLoading = false;
            if (this._loadingNode) this._loadingNode.active = false;
            this.toast('页面加载失败，请重试');
            console.warn('[GameFlow] 导航页面加载失败', error);
        }
    }

    /** 签到属于远程主页包，仅在主页显示；可直接编辑独立预制体。 */
    public async openDailySignIn(automatic = false): Promise<boolean> {
        if (this._dailyOpening || !this._dailyConfig || !this.lobby?.node.activeInHierarchy) return false;
        const day = sidebarDay();
        if (automatic && (!this.save.dailyStatus(day, this._dailyConfig).canClaim
            || (this.save.data.dailySignIn?.promptDay ?? '') >= day || this._dailyAttemptDay === day)) return false;
        if (automatic) this._dailyAttemptDay = day;
        this._dailyOpening = true;
        try {
            const modal = await this._ensureDailySignIn();
            if (!this.isValid || !this.lobby?.node.activeInHierarchy) return false;
            if (automatic && !this.save.markDailyPrompt(day, this._dailyConfig)) return false;
            await modal.present(this._dailyConfig);
            return true;
        } catch (error) {
            console.warn('[DailySignIn] 弹窗加载失败', error);
            this.toast('签到暂不可用，请稍后从主页重试');
            return false;
        } finally { this._dailyOpening = false; }
    }

    public promptDailySignIn(): void {
        if (!this._booting && !this._bootFailed && this.lobby?.node.activeInHierarchy) void this.openDailySignIn(true);
    }

    public get dailySignInAvailable(): boolean {
        return !!this._dailyConfig && this.save.dailyStatus(sidebarDay(), this._dailyConfig).canClaim;
    }

    private _ensureDailySignIn(): Promise<DailySignInModal> {
        if (this._dailySignIn?.isValid) return Promise.resolve(this._dailySignIn);
        if (this._dailyLoading) return this._dailyLoading;
        this._dailyLoading = new Promise<DailySignInModal>((resolve, reject) => {
            void this._loadLobbyBundle().then(bundle => bundle.load('prefabs/DailySignInModal', Prefab, (error, prefab) => {
                const canvas = this.node.parent;
                if (error || !prefab || !this.isValid || !canvas) { reject(error ?? new Error('签到界面已销毁')); return; }
                const node = instantiate(prefab); node.active = false; node.parent = canvas;
                const modal = node.getComponent(DailySignInModal);
                if (!modal) { node.destroy(); reject(new Error('签到预制体缺少 DailySignInModal 组件')); return; }
                this._dailySignIn = modal;
                resolve(modal);
            })).catch(reject);
        }).finally(() => { this._dailyLoading = null; });
        return this._dailyLoading;
    }

    private _returnAdPending = false;

    /** 玩家主动返回主页时请求插屏；加载失败等内部跳转仍使用 showLobby。 */
    public returnToLobby(): void {
        if (this._returnAdPending) return;
        const opening = this.lobby?.isValid ? (this.showLobby(), Promise.resolve()) : this._openLobby();
        this._returnAdPending = true;
        void opening.then(() => {
            if (!this.isValid || !this.lobby?.node.activeInHierarchy) return;
            const navigation = this._secondaryNavigationVersion;
            return this.platform.showInterstitial(() => this.isValid && navigation === this._secondaryNavigationVersion
                && !!this.lobby?.node.activeInHierarchy, true, true, 'return-home');
        })
            .finally(() => { this._returnAdPending = false; });
    }

    public showSettings(inGame: boolean): void {
        if (!this._settings || (inGame && (this._isPaused || this._isGameOver))) return;
        this._settingsInGame = inGame;
        if (inGame) {
            this._isPaused = true;
            this._settingsOpenedAt = Date.now();
        }
        this._settings.present(inGame);
        // 设置入口立即尝试已预加载的插屏，不受客户端首局/冷却限制，也不延后补弹。
        void this.platform.showInterstitial(() => this.isValid && !!this._settings?.node.activeInHierarchy,
            true, true, 'settings', true);
    }

    public closeSettings(): void {
        if (this._settingsInGame) {
            this.continueFromSettings();
        } else {
            this._settings?.close();
        }
    }

    public continueFromSettings(): void {
        if (!this._settingsInGame || !this._settings?.node.active) return;
        if (this._lastFoundAt) this._lastFoundAt += Date.now() - this._settingsOpenedAt;
        this._settings.close();
        this._settingsInGame = false;
        this._isPaused = this._isGameOver;
    }

    public setMusicEnabled(enabled: boolean): void {
        this.save.setMusicEnabled(enabled);
        if (this.game?.node.active) {
            const music = this._currentGameMusic();
            this._playPageMusic(music.path, music.fromBundle, music.chapterBundle);
        } else {
            this._playPageMusic('voice/BGmusic/Main_music00');
        }
    }

    public setSoundEnabled(enabled: boolean): void {
        this.save.setSoundEnabled(enabled);
        if (!enabled) {
            this._stopResultTone();
            this._comboSoundRequest++;
            this._comboSource?.stop();
        }
    }

    public showRank(): void {
        if (this.platform.isHarmony) return;
        if (this.platform.kind === 'douyin') {
            void this._showNativeRank();
            return;
        }
        void this._openSecondaryPage('rank');
    }

    private _openingNativeRank = false;

    private async _showNativeRank(): Promise<void> {
        if (this._openingNativeRank) return;
        this._cancelSecondaryNavigation();
        this._openingNativeRank = true;
        try {
            if (await this.platform.detectHarmony() || this.platform.supportsRanking === false) return;
            const caller = this.lobby?.node;
            await this.platform.showInterstitial(() => this.isValid && !!caller?.activeInHierarchy,
                true, true, 'rank', true);
            if (!this.isValid || !caller?.activeInHierarchy) return;
            const result = await this.rankProvider.openNative?.();
            if (!result?.success) this.toast(result?.message ?? '当前环境不支持抖音排行榜');
        } catch (error) {
            console.warn('[GameFlow] 原生排行榜打开失败', error);
            this.toast('排行榜打开失败，请重试');
        } finally { this._openingNativeRank = false; }
    }

    /** 收藏页。 */
    public showFoodTips(level: LevelConfig, unlocked = false): void {
        const food = this._foods.find(item => item.levelKey === level.key);
        if (!food) {
            console.warn(`[GameFlow] 美食未关联关卡，无法显示美食详情: ${level.key}`);
            return;
        }
        this.showCatalogFood(food, unlocked);
    }

    public showCollect(): void {
        void this._openSecondaryPage('collect');
    }

    /** 城市列表页。 */
    public showCitySelect(topicKey?: string): void | Promise<void> {
        this._selectedTopic = this._cityIndex?.topics?.find(topic => topic.key === topicKey) ?? null;
        if (!this.citySelect?.isValid) return this._openNavigationPage('citySelect');
        this._switchTo(this.citySelect);
    }

    private _levelSelectEntryPending = false;

    /** 主页选关入口直接开放，不读取旧24小时资格，也不请求激励解锁。 */
    public async enterLevelSelection(): Promise<void> {
        if (!this.isValid || this._levelSelectEntryPending || this._returnAdPending || this._rewardPending || !this.lobby?.node.activeInHierarchy) return;
        this._levelSelectEntryPending = true;
        try {
            // 先进入详情页，再请求插屏，避免加载或缺失关闭回调让玩家一直停在主页。
            await this.showCitySelect();
            if (!this.isValid || !this.citySelect?.node.activeInHierarchy) return;
            const enteredNavigation = this._secondaryNavigationVersion;
            // 已进入页面后沿用该入口插屏规则，不将广告作为进入资格。
            await this.platform.showInterstitial(() => this.isValid && enteredNavigation === this._secondaryNavigationVersion
                && !!this.citySelect?.node.activeInHierarchy, true, true, 'level-select-entry');
        } finally {
            this._levelSelectEntryPending = false;
        }
    }

    public async requestEnergyReward(): Promise<void> {
        if (this.save.energy >= this.save.energyRecoveryLimit) return;
        await this.requestReward('energy', () => {
            const before = this.save.energy;
            if (before >= this.save.energyLimit) { this.toast('体力已恢复至上限'); return; }
            if (this.save.claimEnergyAd(sidebarDay())) this.toast(`体力 +${this.save.energy - before}`);
            else this.toast('体力领取失败，请稍后重试');
        });
    }

    /** 城市内关卡页。city 缺省时用当前城市（或第一城）。 */
    public async showLevelSelect(city?: CityConfig): Promise<void> {
        this._cancelSecondaryNavigation();
        const target = city ?? this._currentCity ?? this._cities[0] ?? null;
        if (!target) return;
        if (!this.isCityUnlocked(this._cities.indexOf(target))) { this.toast('请先观看视频解锁该城市'); return; }
        const navigationVersion = this._secondaryNavigationVersion;
        this._currentCity = target;
        if (!this.levelSelect?.isValid && this._loadingNode) {
            this._secondaryPageLoading = true;
            this._loadingNode.active = true;
            this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
        }
        try {
            await Promise.all([this.ensureCity(target), this._ensureNavigationPage('levelSelect')]);
        } catch (error) {
            if (!this.isValid || navigationVersion !== this._secondaryNavigationVersion) return;
            console.error(`[GameFlow] 城市关卡加载失败: ${target.key}`, error);
            this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
            return;
        }
        if (!this.isValid || navigationVersion !== this._secondaryNavigationVersion) return;
        this._switchTo(this.levelSelect);
    }

    /** 从城市页进入城市：设置当前城市并打开关卡页。 */
    public async enterCity(city: CityConfig): Promise<void> {
        const navigation = this._secondaryNavigationVersion;
        if (!this.isCityUnlocked(this._cities.indexOf(city))) {
            if (!await this.requestCityUnlock(city)) return;
            if (!this.isValid || navigation !== this._secondaryNavigationVersion || !this.citySelect?.node.activeInHierarchy) return;
        }
        await this.showLevelSelect(city);
    }

    /** 一次完整视频永久开放城市入口，不同时解锁该城所有小关。 */
    public async requestCityUnlock(city: CityConfig): Promise<boolean> {
        const index = this._cities.indexOf(city);
        if (index < 0) return false;
        if (this.isCityUnlocked(index)) return true;
        let granted = false;
        await this.requestReward('unlock-city', () => {
            granted = this.save.unlockCity(city.key);
            if (!granted) this.toast('城市解锁保存失败，请重试');
        });
        if (this.citySelect?.node.activeInHierarchy) this.citySelect.rebuild();
        return granted;
    }

    /** 优先从最后游玩的小关继续；无记录的旧存档按原章节进度继续。 */
    public async findContinueTarget(): Promise<{ city: CityConfig; levelIndex: number; level: LevelConfig } | null> {
        // 独立大关卡只继续本章；初次进入从网络热点开始。
        const lastKey = this.save.data?.lastPlayedLevelKey;
        const owner = lastKey && this._cities.find(city => city.levels.some(dir =>
            (city.levelIds?.[dir] ?? `${city.key}/${dir}`) === lastKey));
        const preferred = this._currentCity ?? owner ?? this._cities.find(city => city.key === this.save.data?.lastPlayedCityKey);
        const current = preferred && this.isCityUnlocked(this._cities.indexOf(preferred))
            ? preferred : this._cities[0];
        const lastIndex = current?.levels.findIndex(dir => (current.levelIds?.[dir] ?? `${current.key}/${dir}`) === this.save.data?.lastPlayedLevelKey) ?? -1;
        if (current && lastIndex >= 0 && this.isLevelUnlocked(this._cities.indexOf(current), lastIndex)) {
            let target = { city: current, levelIndex: lastIndex };
            // 通关后向前继续，不因中间跳过的小关退回旧进度。
            while (this.save.isCompleted((target.city.levelIds?.[target.city.levels[target.levelIndex]] ?? `${target.city.key}/${target.city.levels[target.levelIndex]}`))) {
                const next = this._nextLevelTarget(target.city, target.levelIndex);
                if (!next || !this.isLevelUnlocked(this._cities.indexOf(next.city), next.levelIndex)) break;
                target = next;
            }
            return { ...target, level: await this._ensureLevel(target.city, target.levelIndex) };
        }
        const sequence = current?.nextChapter
            ? [current, this._cities.find(city => city.key === current.nextChapter)].filter((city): city is CityConfig => !!city)
            : current ? [current] : [];
        for (const city of sequence) {
            const ci = this._cities.indexOf(city);
            if (!this.isCityUnlocked(ci)) continue;
            for (let li = 0; li < city.levels.length; li++) {
                const key = (city.levelIds?.[city.levels[li]] ?? `${city.key}/${city.levels[li]}`);
                if (this.isLevelUnlocked(ci, li) && !this.save.isCompleted(key)) {
                    const level = await this._ensureLevel(city, li);
                    return { city, levelIndex: li, level };
                }
            }
        }
        // 本章全通后可重玩本章，不自动切到其他独立大关卡。
        if (current?.levels.length && this.isCityUnlocked(this._cities.indexOf(current))) {
            return { city: current, levelIndex: 0, level: await this._ensureLevel(current, 0) };
        }
        return null;
    }

    private _continuePending = false;

    /** 开始挑战：继续当前大关卡，全部通关则重玩本章第一关。 */
    public async startContinue(): Promise<void> {
        if (this._bootFailed) {
            await this._bootstrap();
            return;
        }
        if (this._continuePending || this._levelLoading) return;
        this._continuePending = true;
        try {
            const target = await this.findContinueTarget();
            if (target) {
                await this.startLevel(target.city, target.levelIndex);
            } else if (this._cities.length > 0) {
                const city = this._currentCity && this.isCityUnlocked(this._cities.indexOf(this._currentCity))
                    ? this._currentCity : this._cities[0];
                await this.startLevel(city, 0);
            } else {
                throw new Error('没有可用的城市关卡');
            }
        } catch (error) {
            console.error('[GameFlow] 当前关卡加载失败', error);
            this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
        } finally {
            this._continuePending = false;
        }
    }

    private _returnToLobbyOnLoadError(message: string): void {
        this.game?.clearLevel();
        this._currentLevel = null;
        this._isPaused = false;
        this._isGameOver = false;
        this._levelLoading = false;
        this.showLobby();
        this.toast(message);
    }

    private _levelLoading = false;
    private _tutorial: GameTips | null = null;
    @property({ tooltip: '仅编辑器预览：首关强制展示引导，不清除存档，不影响发布版本' })
    public previewTutorial = false;
    private _finishLoadingFrame: (() => void) | null = null;

    /** 缓存命中可能在同一帧完成，先让 Loading 真正绘制出来。 */
    private _drawLoadingFrame(): Promise<void> {
        return new Promise(resolve => {
            const finish = () => {
                director.off(Director.EVENT_AFTER_DRAW, finish);
                if (this._finishLoadingFrame === finish) this._finishLoadingFrame = null;
                resolve();
            };
            this._finishLoadingFrame = finish;
            director.once(Director.EVENT_AFTER_DRAW, finish);
        });
    }
    private _roundInterstitialProtected = false;
    private _prefetchRunning = false;
    private _prefetchPending: LevelConfig | null = null;
    private _levelLoadVersion = 0;

    private _onFeedPreviewChanged(): void {
        if (this.feed.isPreview) {
            this._feedPauseBeforePreview = this._isPaused;
            this._isPaused = true;
            this._musicRequest++;
            this._musicPath = '';
            this._musicMixer?.stop();
            if (this.game?.node.activeInHierarchy && this._currentLevel && !this._levelLoading) {
                void this._drawLoadingFrame().then(() => { if (this.isValid) void this.feed.reportReady(); });
            }
            return;
        }
        this.platform.prepareFeedLogin();
        this.platform.preloadInterstitial?.();
        const begin = this._feedStart;
        this._feedStart = null;
        if (begin) begin();
        else {
            if (this._feedPauseBeforePreview !== null) this._isPaused = this._feedPauseBeforePreview;
            if (this._currentLevel && this.game?.node.activeInHierarchy && !this._levelLoading) {
                const version = this._levelLoadVersion;
                void this.feed.onLevelEntered(this._currentLevel.key).then(token => {
                    if (this.isValid && version === this._levelLoadVersion && token) this._feedOffer = { token, version };
                });
            }
        }
        this._feedPauseBeforePreview = null;
        if (this.game?.node.activeInHierarchy && this._currentCity) {
            const music = this._currentGameMusic();
            this._playPageMusic(music.path, music.fromBundle, music.chapterBundle);
        }
    }

    private _tryFeedOffer(): void {
        const offer = this._feedOffer;
        if (!offer) return;
        if (offer.version !== this._levelLoadVersion || this._isGameOver || !this.game?.node.activeInHierarchy) {
            this._feedOffer = null; return;
        }
        if (this._isPaused || this._levelLoading || this._rewardPending || this.platform.interstitialBusy
            || this.feed.isPreview || this._tutorial?.node.activeInHierarchy || this._settings?.node.activeInHierarchy) return;
        const entries = this.node.parent?.getComponent(LobbyEntries);
        if (entries?.openFeedSubscription(this.game.node, () => {
            if (this.isValid && offer.version === this._levelLoadVersion) this._isPaused = this._isGameOver;
        })) {
            this._isPaused = true;
            this.feed.markOffered(offer.token);
        }
        this._feedOffer = null;
    }

    public async startLevel(city: CityConfig, levelIndex: number, musicSource: 'select' | 'streak' | 'retry' = 'select', failureAction: 'lobby' | 'skip-next' = 'lobby'): Promise<void> {
        if (this._levelLoading || this._rewardPending || this._levelSelectEntryPending || this._returnAdPending) return;
        if (!this.isLevelUnlocked(this._cities.indexOf(city), levelIndex)) {
            this.toast('请先通关上一关，或在选关页看视频解锁本关');
            return;
        }
        if (!this.feed?.isPreview && this.save.energy < 1) {
            if (this._loadingNode?.active) this.showLobby();
            this.toast('体力不足，无法开始挑战');
            return;
        }
        this._cancelSecondaryNavigation();
        this._updateGameMusic(city, levelIndex, musicSource);
        const version = ++this._levelLoadVersion;
        this._feedStart = null;
        this._feedOffer = null;
        const active = () => this.isValid && version === this._levelLoadVersion;
        this._levelLoading = true;
        this._isPaused = true;
        ++this._comboSoundRequest;
        this._comboSource?.stop();
        this.resultModal?.close();
        if (this._loadingNode) {
            this._loadingNode.active = true;
            const footer = this._loadingNode.getChildByName('FooterEnv');
            if (footer) footer.active = false;
            this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
        }
        this._setLoadingProgress(0);
        let fallback: { city: CityConfig; levelIndex: number } | null = null;
        const releaseBundle = this._contentBundles.retain(city.key);
        try {
            await this._drawLoadingFrame();
            if (!active()) return;
            await this._ensureGameScreens();
            if (!active()) return;
            if (musicSource !== 'retry') this._updateComboGroup(city, levelIndex);
            this.game?.clearLevel();
            const level = await this._ensureLevel(city, levelIndex);
            if (!active()) return;
            if (!level || !this.game) throw new Error('关卡或游戏页面不存在');
            const chapterMusic = await this._resolveChapterMusic(city, musicSource);
            if (!active()) return;
            const chapterCombo = await this._resolveChapterComboGroup(city, musicSource);
            if (!active()) return;
            this._chapterMusic = chapterMusic;
            this._chapterComboGroup = chapterCombo;
            this._currentCity = city;
            this._currentLevel = level;
            this._remainingTime = level.timeLimit;
            this._elapsedTime = 0;
            this._lives = level.maxLives;
            this._foundIds.clear();
            this._combo = 0;
            this._lastFoundAt = 0;
            this._lastFoundElapsed = 0;
            this._isGameOver = false;
            this._reviveUsed = false;
            this._assistRoundVersion++;
            this._setLoadingProgress(0.2);
            await this.game.setupLevel(level, value => {
                if (active()) this._setLoadingProgress(0.2 + value * 0.8);
            });
            if (!active()) return;
            // 两张关卡图绑定完成后才启用玩法页；动态创建的节点不能盖过 Loading。
            this._switchTo(this.game);
            if (this._loadingNode) {
                this._loadingNode.active = true;
                this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
            }
            await this._drawLoadingFrame();
            if (!active()) return;
            (globalThis as any).__findDifferencePerformance?.mark('level-prepared');
            const begin = () => {
                if (!active() || this.feed?.isPreview) return;
                if (!this.save.consumeEnergy()) {
                    this._returnToLobbyOnLoadError(this.save.energy < 1 ? '体力不足，已返回主页' : '体力保存失败，请重试');
                    return;
                }
                const dailyFirst = this.save.beginDailyFirstRound(sidebarDay());
                this.save.setLastPlayedLevel(city.key, level.key);
                this.playStats?.recordEntry(level.key);
                this._roundInterstitialProtected = dailyFirst;
                if (this._loadingNode) this._loadingNode.active = false;
                // Queue only the lobby shell after active play; menu catalogs/hero stay on demand.
                if (!this._lobbyWarmupStarted && this._lobbyWarmupRemaining == null) this._lobbyWarmupRemaining = 8;
                this._isPaused = false;
                this._showFirstLevelTutorial(level);
                (globalThis as any).__findDifferencePerformance?.mark('playable');
                void this.preloadNextLevel(level);
                void this.feed?.onLevelEntered(level.key).then(token => {
                    if (active() && token) this._feedOffer = { token, version };
                });
            };
            if (this.feed?.isPreview) {
                this._feedStart = begin;
                this._isPaused = true;
                if (this._loadingNode) this._loadingNode.active = false;
            } else begin();
            if (this.feed) void this._drawLoadingFrame().then(() => {
                if (active()) void this.feed.reportReady();
            }).catch(error => console.warn('[Feed] 首帧上报等待失败', error));
        } catch (error) {
            if (!active()) return;
            this.game?.clearLevel();
            console.error('[GameFlow] 关卡加载失败', error);
            if (failureAction === 'skip-next') fallback = this._nextLevelTarget(city, levelIndex, true);
            if (fallback && !this.isLevelUnlocked(this._cities.indexOf(fallback.city), fallback.levelIndex)) fallback = null;
            if (fallback) {
                this.toast('下一关加载失败，正在进入再下一关');
            } else {
                this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
            }
        } finally {
            releaseBundle();
            if (active()) this._levelLoading = false;
        }
        // 先解除本次加载锁，再尝试一次后继关卡；后继失败统一回首页。
        if (fallback && active()) await this.startLevel(fallback.city, fallback.levelIndex, 'streak', 'lobby');
    }

    private _showFirstLevelTutorial(level: LevelConfig): void {
        if (level.key !== (this._cities[0]?.levelIds?.[this._cities[0]?.levels[0]] ?? `${this._cities[0]?.key}/${this._cities[0]?.levels[0]}`)) return;
        if (!(PREVIEW && this.previewTutorial) && (this.save.data.tutorialCompleted || this.save.totalScore > 0)) return;
        const difference = level.differences[0];
        if (!difference) return;
        const target = this.game?.tutorialTarget(difference);
        const node = this.node.parent?.getChildByPath('Screens/GameTips');
        if (!target || !node) return;
        this._tutorial = node.getComponent(GameTips) ?? node.addComponent(GameTips);
        const finish = () => {
            this._tutorial?.dismiss();
            this.save.completeTutorial();
            this._isPaused = this._isGameOver;
        };
        const control = (kind: 'zoom' | 'hint' | 'time' | 'lives' | 'add-time') => this.game?.tutorialControl(kind);
        // 开局只讲核心规则；放大/提示/加时改由分时引导在卡关或时间不足时介绍
        const steps = [
            { target: () => target, text: '点击亮处，找出不同', action: () => this.onDifferenceFound(difference) },
            { target: () => control('time'), text: '时间用完会失败，点击继续', action: () => {} },
            { target: () => control('lives'), text: '点错扣生命，耗尽会失败，点击继续', action: () => {} },
        ];
        const show = (index: number): void => {
            if (!this.isValid || this._currentLevel !== level || !this.game?.node.activeInHierarchy) return;
            if (index >= steps.length || this._isGameOver) { finish(); return; }
            const step = steps[index];
            const focus = step.target();
            if (!focus) { show(index + 1); return; }
            this._isPaused = true;
            this._tutorial!.present(focus.node, focus.local, focus.radius, hit => {
                if (!this.isValid || this._currentLevel !== level || !this.game?.node.activeInHierarchy) return;
                if (!hit) { finish(); return; }
                this._isPaused = false;
                step.action();
                show(index + 1);
            }, step.text);
        };
        show(0);
    }

    /** 卡关 20 秒或剩余时间不足 30 秒时弹出一次性教学，阈值与 HUD 提醒动画一致。 */
    private static readonly ASSIST_STUCK_SECONDS = 20;
    private static readonly ASSIST_LOW_TIME_SECONDS = 30;

    /** 分时引导：首关教学完成后，按对局状态介绍提示/放大/加时，每人各一次。 */
    private _maybeShowAssistTutorial(): void {
        if (!this.save.data.tutorialCompleted) return;
        if (this._tutorial?.node.activeInHierarchy) return;
        if (!this._currentLevel || !this.game?.node.activeInHierarchy) return;
        if (!this._currentLevel.differences.some(item => !this._foundIds.has(item.id))) return;
        // 时间不足更紧急，优先介绍加时
        if (this._remainingTime > 0 && this._remainingTime < GameFlow.ASSIST_LOW_TIME_SECONDS
            && !this.save.data.tutorialAddTimeShown) {
            this._presentAssistTutorial('add-time');
            return;
        }
        if (this._elapsedTime - this._lastFoundElapsed < GameFlow.ASSIST_STUCK_SECONDS) return;
        if (!this.save.data.tutorialHintShown) this._presentAssistTutorial('hint');
        else if (!this.save.data.tutorialZoomShown) this._presentAssistTutorial('zoom');
    }

    private _presentAssistTutorial(kind: 'hint' | 'zoom' | 'add-time'): void {
        const game = this.game;
        const focus = game?.tutorialControl(kind);
        const node = this.node.parent?.getChildByPath('Screens/GameTips');
        if (!game || !focus || !node) return;
        this._tutorial = node.getComponent(GameTips) ?? node.addComponent(GameTips);
        const level = this._currentLevel;
        const round = this._assistRoundVersion;
        const hintAction = this.unlimitedAssists || this.save.freeHints > 0 ? '使用提示' : '看广告获取提示';
        const timeAction = this.unlimitedAssists || this.save.freeAddTimes > 0 ? '加时60秒' : '看广告加时60秒';
        const text = kind === 'hint' ? `找不到？点击${hintAction}，指出一处不同`
            : kind === 'zoom' ? '点击放大镜查看细节，可拖动，再点一次还原'
            : `时间不足！点击${timeAction}`;
        this._isPaused = true;
        this._tutorial.present(focus.node, focus.local, focus.radius, hit => {
            if (!this.isValid || this._currentLevel !== level || round !== this._assistRoundVersion
                || !this.game?.node.activeInHierarchy) return;
            this.save.markAssistTutorialShown(kind);
            this._isPaused = this._isGameOver;
            if (!hit) return;
            // 高亮点击与普通按钮走同一库存、激励视频及每关次数校验。
            this.platform.recoverInterstitialOnTouch();
            if (kind === 'hint') void this.requestHint();
            else if (kind === 'zoom') this.game.tutorialZoom();
            else void this.requestAddTime();
        }, text, '');
    }

    private _switchTo(screen: LobbyScreen | CitySelectScreen | LevelSelectScreen | GameScreen | RankScreen | CollectScreen | null): void {
        this._cancelSecondaryNavigation();
        this._tutorial?.dismiss();
        if (screen !== this.game) {
            ++this._levelLoadVersion;
            this._finishLoadingFrame?.();
            this._levelLoading = false;
            this._prefetchPending = null;
            if (this._loadingNode) this._loadingNode.active = false;
        }
        this._stopResultTone();
        this._foodTips?.close();
        this._eventTips?.close();
        this._dailySignIn?.close();
        this._settings?.close();
        this._settingsInGame = false;
        this._comboSoundRequest++;
        this._comboSource?.stop();
        // 任何界面切换都先关闭结算弹窗，避免弹窗残留在新界面上层
        this.resultModal?.close();
        for (const item of [this.lobby, this.citySelect, this.levelSelect, this.game, this.rank, this.collect]) {
            if (item && item !== screen) item.close();
        }
        if (screen) {
            screen.open();
            if (screen === this.game) {
                const music = this._currentGameMusic();
                this._playPageMusic(music.path, music.fromBundle, music.chapterBundle);
            } else {
                this._playPageMusic('voice/BGmusic/Main_music00');
            }
        } else {
            console.warn('[GameFlow] 目标界面未在场景中配置');
        }
    }

    /** 同类页面延续播放；异步加载完成后只允许当前页面的音乐开始播放。 */
    private _playPageMusic(path: string, fromBundle = false, chapterBundle?: string): void {
        if (this.feed?.isPreview) return;
        const mixer = this._musicMixer;
        if (!mixer) return;
        if (!this.save.data.musicEnabled) {
            this._musicRequest++;
            this._musicPath = '';
            mixer.stop();
            return;
        }
        const musicKey = chapterBundle ? `${chapterBundle}:${path}` : path;
        if (this._musicPath === musicKey) return;
        this._musicPath = musicKey;
        const request = ++this._musicRequest;
        if (mixer.resume(musicKey)) return;
        const cached = chapterBundle ? undefined : this._musicClips.get(path);
        if (cached) {
            mixer.play(musicKey, cached);
            return;
        }
        const onLoaded = (error: Error | null, clip?: AudioClip) => {
            if (!this.isValid || request !== this._musicRequest) return;
            if (error || !clip) {
                this._musicPath = '';
                console.warn(`[GameFlow] 背景音乐加载失败: ${path}`, error);
                if (chapterBundle) {
                    this._chapterMusic = null;
                    this._playPageMusic(this._gameMusicPath || 'voice/BGmusic/Game_music01', true);
                }
                return;
            }
            if (!chapterBundle) this._cacheMusicClip(path, clip);
            mixer.play(musicKey, clip, chapterBundle ? this._contentBundles.retain(chapterBundle) : undefined);
        };
        if (chapterBundle) {
            // 异步加载持有包；播放成功后转交给音乐持有者，切歌/离开时归还。
            void this._contentBundles.use(chapterBundle, bundle => new Promise<void>(resolve => {
                bundle.load(path, AudioClip, (error, clip) => {
                    onLoaded(error, clip);
                    resolve();
                });
            })).catch(error => onLoaded(error instanceof Error ? error : new Error(String(error))));
        } else if (fromBundle) {
            void this._loadGameBundle()
                .then(bundle => bundle.load(path, AudioClip, onLoaded))
                .catch(error => onLoaded(error instanceof Error ? error : new Error(String(error))));
        } else if (path === 'voice/BGmusic/Main_music00') {
            void this._loadLobbyBundle().then(bundle => bundle.load(path, AudioClip, onLoaded)).catch(error => onLoaded(error));
        } else {
            void this._loadGameBundle().then(bundle => bundle.load(`Common/${path}`, AudioClip, onLoaded)).catch(error => onLoaded(error));
        }
    }

    private _cacheMusicClip(path: string, clip: AudioClip): void {
        const previous = this._musicClips.get(path);
        if (previous === clip) return;
        clip.addRef();
        this._musicClips.set(path, clip);
        previous?.decRef();
    }

    /** 只查包内音频索引，不预下载整个目录；空目录或无音频时沿用通用曲目。 */
    private async _resolveChapterMusic(city: CityConfig, source: 'select' | 'streak' | 'retry'):
        Promise<{ path: string; chapterBundle: string } | null> {
        try {
            return await this._contentBundles.use(city.key, async bundle => {
                const paths = bundle.getDirWithPath('BGmusic', AudioClip).map(info => info.path)
                    .filter(path => path.startsWith('BGmusic/')).sort();
                if (!paths.length) return null;
                const previous = this._chapterMusic;
                const path = source === 'retry' && previous?.chapterBundle === city.key && paths.includes(previous.path)
                    ? previous.path : paths[Math.floor(Math.random() * paths.length)];
                return { path, chapterBundle: city.key };
            });
        } catch (error) {
            console.warn(`[GameFlow] 章节音乐索引读取失败，使用通用音乐: ${city.key}`, error);
            return null;
        }
    }

    /** 第一座城市的前四关沿用固定曲目，之后随机播放。 */
    private _isRandomMusicLevel(city: CityConfig, levelIndex: number): boolean {
        return city !== this._cities[0] || levelIndex >= 4;
    }

    /** 章节 BGmusic 优先；没有专属曲目时沿用通用随机/新手音乐。 */
    private _currentGameMusic(): { path: string; fromBundle: boolean; chapterBundle?: string } {
        if (this._chapterMusic) return { ...this._chapterMusic, fromBundle: true };
        return this._gameMusicPath
            ? { path: this._gameMusicPath, fromBundle: true }
            : { path: 'voice/BGmusic/Game_music01', fromBundle: true };
    }

    /**
     * 随机背景音乐决策：
     * - select：从关卡选择/大厅进入，随机一首并重新开始计数；
     * - streak：结算后连玩，每满两关随机换一首（允许重复）；
     * - retry：加载失败重试，沿用当前曲目。
     */
    private _updateGameMusic(city: CityConfig, levelIndex: number, source: 'select' | 'streak' | 'retry'): void {
        if (!this._isRandomMusicLevel(city, levelIndex)) {
            this._gameMusicPath = '';
            this._gameMusicStreak = 0;
            return;
        }
        if (source === 'retry') return;
        if (source === 'select') {
            this._gameMusicStreak = 1;
        } else {
            this._gameMusicStreak++;
            if (this._gameMusicStreak <= 2) return;
            this._gameMusicStreak = 1;
        }
        const pool = GameFlow.GAME_MUSIC_POOL;
        this._gameMusicPath = pool[Math.floor(Math.random() * pool.length)];
    }

    protected onDestroy(): void {
        this._lobbyWarmupRemaining = null;
        this._lobbyWarmupStarted = true;
        this.feed?.dispose();
        this.playStats?.dispose();
        this._feedStart = null;
        this._feedOffer = null;
        game.off(Game.EVENT_SHOW, this.promptDailySignIn, this);
        this._dailySignIn?.close();
        this._eventTips?.close();
        this._disposeSecondaryPages();
        this._pageSpritesDisposed = true;
        for (const owner of this._pageSpriteFrames.keys()) this.releasePageSpriteFrames(owner);
        this.game?.clearLevel();
        this._musicMixer?.stop();
        this._contentBundles.dispose();
        ++this._levelLoadVersion;
        this._finishLoadingFrame?.();
        this._stopResultTone();
        this.node.off(AudioSource.EventType.STARTED, this._onResultAudioStarted, this);
        this.node.off(AudioSource.EventType.ENDED, this._onResultAudioEnded, this);
        this._resultClips.clear();
        this.platform.sidebar.dispose();
        this._musicRequest++;
        this._comboSoundRequest++;
        this._comboSource?.stop();
        this._comboClips.clear();
        for (const clip of this._chapterComboClips) clip.decRef();
        this._chapterComboClips.clear();
        this._clickSource?.stop();
        this._musicMixer = null;
        for (const clip of this._musicClips.values()) clip.decRef();
        this._musicClips.clear();
        for (const frame of this._spriteFrameCache.values()) frame.decRef();
        this._spriteFrameCache.clear();
        if (GameFlow._instance === this) GameFlow._instance = null;
    }

    private _disposeSecondaryPages(): void {
        this._secondaryDisposed = true;
        this._cancelSecondaryNavigation();
        for (const page of [this.rank, this.collect]) {
            if (page?.isValid) { page.close(); page.node.destroy(); }
        }
        for (const prefab of this._secondaryPrefabs.values()) prefab.decRef();
        this._secondaryPrefabs.clear();
    }

    // ------------------------------------------------------------------
    // 解锁判定（积分制：通关集合驱动）
    // ------------------------------------------------------------------

    /** 顶层专题直接开放；分组内默认城市免费，其余城市保留已有资格或看视频解锁。 */
    public isCityUnlocked(cityIndex: number): boolean {
        if (!Number.isInteger(cityIndex) || cityIndex < 0 || cityIndex >= this._cities.length) return false;
        const city = this._cities[cityIndex];
        const topic = this._cityIndex?.topics?.find(item => item.chapters.includes(city.key));
        if (!topic || topic.defaultChapter === city.key) return true;
        return this.save.isCityUnlocked(city.key) || (city.legacyKeys ?? []).some(key => this.save.isCityUnlocked(key))
            || city.levels.some(dir => this.save.isCompleted(city.levelIds?.[dir] ?? `${city.key}/${dir}`))
            || city.levels.slice(1).some(dir => this.save.isLevelUnlocked(city.levelIds?.[dir] ?? `${city.key}/${dir}`))
            || this.save.data?.lastPlayedCityKey === city.key
            || (city.legacyKeys ?? []).includes(this.save.data?.lastPlayedCityKey ?? '');
    }

    /** 每章首关免费开放，后续小关通关前一关后免费开放。 */
    public isLevelUnlocked(cityIndex: number, levelIndex: number): boolean {
        const city = this._cities[cityIndex];
        if (!city || !this.isCityUnlocked(cityIndex)) return false;
        if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= city.levels.length) return false;
        const key = (city.levelIds?.[city.levels[levelIndex]] ?? `${city.key}/${city.levels[levelIndex]}`);
        return levelIndex === 0 || this.save.isCompleted(key) || this.save.isLevelUnlocked(key)
            || this.save.isCompleted((city.levelIds?.[city.levels[levelIndex - 1]] ?? `${city.key}/${city.levels[levelIndex - 1]}`));
    }

    /** 城市进度（无需加载关卡配置）。 */
    public cityProgress(city: CityConfig): { done: number; total: number } {
        const done = city.levels.filter(dir => this.save.isCompleted((city.levelIds?.[dir] ?? `${city.key}/${dir}`))).length;
        return { done, total: city.levels.length };
    }

    /** 下一关按本章配置推进；跨章节只读取 nextChapter 配置。 */
    public findNextLevel(after: LevelConfig): { city: CityConfig; levelIndex: number } | null {
        const city = this._currentCity;
        if (!city) return null;
        const index = city.levels.findIndex(dir => (city.levelIds?.[dir] ?? `${city.key}/${dir}`) === after.key);
        return index >= 0 ? this._nextLevelTarget(city, index) : null;
    }

    /** 根据目录定位后继关卡，不依赖可能尚未加载或损坏的配置。 */
    private _nextLevelTarget(city: CityConfig, levelIndex: number, allowLockedCity = false): { city: CityConfig; levelIndex: number } | null {
        if (levelIndex + 1 < city.levels.length) return { city, levelIndex: levelIndex + 1 };
        // 未配置 nextChapter 的独立专题在章内推进。
        if (city.nextChapter) {
            const next = this._cities.find(item => item.key === city.nextChapter);
            if (next?.levels.length && this.isCityUnlocked(this._cities.indexOf(next))) return { city: next, levelIndex: 0 };
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 对局逻辑
    // ------------------------------------------------------------------

    /** 连击窗口：两次找对间隔在此时间内连击 +1，否则重新计数。 */
    public static readonly COMBO_WINDOW_MS = 5000;
    /** 第五连击及以上需在更短的间隔内继续找对。 */
    public static readonly TOP_COMBO_WINDOW_MS = 3500;

    public onDifferenceFound(difference: DifferenceConfig, imageNode?: Node): void {
        if (this.feed?.isPreview) return;
        if (this._isGameOver || this._isPaused || !this._currentLevel || this._foundIds.has(difference.id)) return;
        this._foundIds.add(difference.id);
        this._lastFoundElapsed = this._elapsedTime;

        // 连击：窗口内连续找对升级，点错/超时清零
        const now = Date.now();
        const window = this._combo >= 4 ? GameFlow.TOP_COMBO_WINDOW_MS : GameFlow.COMBO_WINDOW_MS;
        this._combo = now - this._lastFoundAt <= window ? this._combo + 1 : 1;
        this._lastFoundAt = now;

        this.game?.drawFoundMarker(difference);
        this.game?.showSuccessFx(this._combo, difference, imageNode);
        if (this._combo >= 2) this.playSuccessTone(this._combo);
        else this.playRightSound();
        this.game?.refreshHud();
        if (this._foundIds.size >= this._currentLevel.differences.length) {
            this.finishLevel(true);
        }
    }

    public onWrongTap(localPosition: Vec3, imageNode: Node): void {
        if (this.feed?.isPreview) return;
        if (this._isGameOver || this._isPaused) return;
        ++this._comboSoundRequest;
        this._comboSource?.stop();
        this.playWrongSound();
        this._combo = 0;
        this._lives = Math.max(0, this._lives - 1);
        this.game?.drawWrongMarker(localPosition, imageNode);
        this.game?.refreshHud();
        if (this._lives <= 0) this.finishLevel(false);
    }

    private _loadComboClip(stage: number): Promise<AudioClip> {
        const ref = this._comboClipRef(stage);
        const key = `${ref.chapterBundle ?? 'MainGameSources'}:${ref.path}`;
        const cached = this._comboClips.get(key);
        if (cached) return cached;
        const pending = new Promise<AudioClip>((resolve, reject) => {
            const done = (error: Error | null, clip?: AudioClip) => {
                if (error || !clip) {
                    this._comboClips.delete(key);
                    reject(error ?? new Error(`[GameFlow] 连击音效加载失败: ${ref.path}`));
                } else {
                    // 章节页面退出后也可能仍在播尾音；缓存显式持有引用，销毁时归还。
                    if (ref.chapterBundle && this.isValid && !this._chapterComboClips.has(clip)) {
                        clip.addRef();
                        this._chapterComboClips.add(clip);
                    }
                    resolve(clip);
                }
            };
            const load = (bundle: AssetManager.Bundle) => new Promise<void>(finish => {
                bundle.load(ref.fromBundle ? ref.path : `Common/${ref.path}`, AudioClip, (error, clip) => {
                    done(error, clip);
                    finish();
                });
            });
            void (ref.chapterBundle
                ? this._contentBundles.use(ref.chapterBundle, load)
                : this._loadGameBundle().then(load))
                .catch(error => done(error instanceof Error ? error : new Error(String(error))));
        });
        this._comboClips.set(key, pending);
        return pending;
    }

    /** 点击/错误声仍用通用包；连击优先使用当前章节包的独立音效。 */
    private _comboClipRef(stage: number): { path: string; fromBundle: boolean; chapterBundle?: string } {
        if (stage === -1) return { path: 'voice/GamePlay/voice_wrong', fromBundle: true };
        if (stage === 0) return { path: 'voice/ComboSound/Combo _F_type01_01/voice_Combo _F_type01_00', fromBundle: false };
        const chapter = this._chapterComboGroup;
        const chapterPath = chapter?.stages.get(stage);
        if (chapterPath) return { path: chapterPath, fromBundle: true, chapterBundle: chapter!.chapterBundle };
        const group = this._discoverComboGroups().get(this._activeComboGroup);
        const discovered = group?.stages.get(stage);
        if (discovered) return { path: discovered, fromBundle: group!.fromBundle };
        // 发现结果缺少该档位时按命名约定回退：文件名 = voice_ + 组目录名 + _0N
        const suffix = String(stage).padStart(2, '0');
        return { path: `${GameFlow.BUNDLE_COMBO_ROOT}/${this._activeComboGroup}/voice_${this._activeComboGroup}_${suffix}`, fromBundle: true };
    }

    /** 只读取当前章节的资源索引；完整的五档专属组优先，不下载其他章节的音频。 */
    private async _resolveChapterComboGroup(city: CityConfig, source: 'select' | 'streak' | 'retry'):
        Promise<{ name: string; chapterBundle: string; stages: Map<number, string> } | null> {
        try {
            return await this._contentBundles.use(city.key, async bundle => {
                const groups = new Map<string, Map<number, string>>();
                for (const info of bundle.getDirWithPath('Combo _F_type', AudioClip)) {
                    const match = /^Combo _F_type\/([^/]+)\/[^/]+_0([1-5])(?:\.\w+)?$/.exec(info.path);
                    if (!match) continue;
                    let stages = groups.get(match[1]);
                    if (!stages) groups.set(match[1], stages = new Map());
                    stages.set(Number(match[2]), info.path);
                }
                const names = Array.from(groups.keys()).filter(name => groups.get(name)!.size === 5).sort();
                if (!names.length) return null;
                const previous = this._chapterComboGroup;
                const name = source === 'retry' && previous?.chapterBundle === city.key && names.includes(previous.name)
                    ? previous.name : names[Math.floor(Math.random() * names.length)];
                return { name, chapterBundle: city.key, stages: groups.get(name)! };
            });
        } catch (error) {
            console.warn(`[GameFlow] 章节连击音效索引读取失败，使用通用音效: ${city.key}`, error);
            return null;
        }
    }

    /** 枚举局内包的 1-5 号连击音效；枚举失败时至少保留默认组。 */
    private _discoverComboGroups(): Map<string, { stages: Map<number, string>; fromBundle: boolean }> {
        if (this._comboGroups && (this._comboGroupsScannedBundle || !this._gameBundle)) return this._comboGroups;
        const groups = new Map<string, { stages: Map<number, string>; fromBundle: boolean }>();
        const pattern = /^voice\/(?:ComboSound|Combo _F_type)\/([^/]+)\/voice_Combo .*_0([1-5])(?:\.\w+)?$/;
        const add = (path: string | undefined, fromBundle: boolean) => {
            if (!path) return;
            const match = pattern.exec(path);
            if (!match) return;
            let group = groups.get(match[1]);
            if (!group) {
                group = { stages: new Map(), fromBundle };
                groups.set(match[1], group);
            }
            group.stages.set(Number(match[2]), path);
        };
        if (this._gameBundle) {
            for (const info of this._gameBundle.getDirWithPath(GameFlow.BUNDLE_COMBO_ROOT, AudioClip)) add(info.path, true);
        }
        if (!groups.has(GameFlow.DEFAULT_COMBO_GROUP)) {
            groups.set(GameFlow.DEFAULT_COMBO_GROUP, { stages: new Map(), fromBundle: true });
        }
        this._comboGroups = groups;
        this._comboGroupsScannedBundle = !!this._gameBundle;
        return groups;
    }

    /** 第四关起每次进入关卡随机一组连击音效（可重复），前三关固定默认组。 */
    private _updateComboGroup(city: CityConfig, levelIndex: number): void {
        const random = city !== this._cities[0] || levelIndex >= 3;
        if (!random) {
            this._activeComboGroup = GameFlow.DEFAULT_COMBO_GROUP;
            return;
        }
        const names = Array.from(this._discoverComboGroups().keys());
        this._activeComboGroup = names.length > 0
            ? names[Math.floor(Math.random() * names.length)]
            : GameFlow.DEFAULT_COMBO_GROUP;
    }

    /** 每次按下独立播放，连续点击不会截断上一声或影响连击音效。 */
    public playClickSound(): void {
        this._playTapSound(0);
    }

    public playWrongSound(): void {
        this._playTapSound(-1);
    }

    private static _hasAncestorNamed(target: Node | null, ...names: string[]): boolean {
        for (let node = target; node; node = node.parent) {
            if (names.indexOf(node.name) >= 0) return true;
        }
        return false;
    }

    private readonly _tapClips = new Map<string, Promise<AudioClip>>();

    private _loadTapClip(name: string): Promise<AudioClip> {
        const cached = this._tapClips.get(name);
        if (cached) return cached;
        const pending = new Promise<AudioClip>((resolve, reject) => {
            void this._loadGameBundle().then(bundle => bundle.load(`voice/GamePlay/${name}`, AudioClip, (error, clip) => {
                if (error) {
                    this._tapClips.delete(name);
                    reject(error);
                } else {
                    resolve(clip);
                }
            })).catch(error => { this._tapClips.delete(name); reject(error); });
        });
        this._tapClips.set(name, pending);
        return pending;
    }

    /** 与点击音效共用通道，playOneShot 连续触发互不截断。 */
    public playNamedTapSound(name: string): void {
        if (!this.save.data.soundEnabled) return;
        void this._loadTapClip(name).then(clip => {
            const source = this._clickSource;
            if (!this.isValid || !this.enabledInHierarchy || !source?.isValid || !this.save.data.soundEnabled) return;
            source.playOneShot(clip);
        }).catch(error => console.warn(`[GameFlow] 音效播放失败: ${name}`, error));
    }

    public playBackSound(): void { this.playNamedTapSound('voice_Back'); }
    public playHintSound(): void { this.playNamedTapSound('voice_TipsTik'); }
    public playAddTimeSound(): void { this.playNamedTapSound('voice_AddTime'); }
    public playZoomSound(): void { this.playNamedTapSound('voice_MakeCkear'); }

    /** 找对但未连击时播放；连击由 playSuccessTone 接管，先停掉连击通道避免叠加。 */
    public playRightSound(): void {
        ++this._comboSoundRequest;
        this._comboSource?.stop();
        this.playNamedTapSound('voice_Right');
    }

    private _playTapSound(stage: number): void {
        if (!this.save.data.soundEnabled) return;
        void this._loadComboClip(stage).then(clip => {
            const source = this._clickSource;
            if (!this.isValid || !this.enabledInHierarchy || !source?.isValid || !this.save.data.soundEnabled) return;
            source.playOneShot(clip);
        }).catch(error => console.warn('[GameFlow] 点击/错误音效播放失败', error));
    }

    /** 首次找对使用普通提示声；二至六连击对应音效1至5档，此后保持最高档。 */
    public playSuccessTone(combo: number): void {
        const request = ++this._comboSoundRequest;
        if (!this.save.data.soundEnabled) return;
        const stage = Math.max(1, Math.min(5, Math.floor(combo) - 1));
        void this._loadComboClip(stage).then(clip => {
            const source = this._comboSource;
            if (!this.isValid || !source?.isValid || !this.save.data.soundEnabled || request !== this._comboSoundRequest) return;
            source.stop();
            source.clip = clip;
            source.play();
        }).catch(error => console.warn('[GameFlow] 连击音效播放失败', error));
    }

    public useHint(onDismiss?: () => void): void {
        if (this._isGameOver) return;
        const level = this._currentLevel;
        const difference = level?.differences.find(item => !this._foundIds.has(item.id));
        if (!level || !difference) { onDismiss?.(); return; }
        // 先还原视图，避免目标差异位于放大视口外。
        this.game?.tutorialResetZoom();
        const target = this.game?.tutorialTarget(difference);
        const node = this.node.parent?.getChildByPath('Screens/GameTips');
        if (!target || !node) { this.toast('提示暂不可用'); onDismiss?.(); return; }
        this._tutorial = node.getComponent(GameTips) ?? node.addComponent(GameTips);
        this._tutorial.presentHint(target.node, target.local, target.radius, () => {
            if (!this.isValid || this._currentLevel !== level || !this.game?.node.activeInHierarchy) return;
            this.game.refreshHud();
            onDismiss?.();
        });
    }

    private _assistRoundVersion = 0;

    /** 无广告网页版在库存耗尽后仍可直接使用辅助功能；有库存时照常扣除。 */
    public get unlimitedAssists(): boolean {
        return this.platform.kind === 'h5';
    }

    public async requestHint(): Promise<void> {
        if (this._isPaused || this._isGameOver || !this.game?.node.activeInHierarchy
            || !this._currentLevel?.differences.some(item => !this._foundIds.has(item.id))) return;
        this.playHintSound();
        if (this.save.freeHints > 0) {
            if (!this.save.consumeFreeHint()) {
                this.toast('保存失败，请稍后再试');
                return;
            }
            this.useHint();
            this.game.refreshHud();
            return;
        }
        if (this.unlimitedAssists) {
            this.useHint();
            this.game.refreshHud();
            return;
        }
        const round = this._assistRoundVersion;
        await this.requestReward('hint', () => {
            if (!this.save.grantAssist('hint')) { this.toast('保存失败，请稍后再试'); return; }
            if (round === this._assistRoundVersion && !this._isGameOver && this.game?.node.activeInHierarchy
                && this.save.consumeFreeHint()) this.useHint();
            this.game?.refreshHud();
        });
    }

    /** 惊喜掉落立即使用1个，仅将剩余部分写入库存。 */
    public async claimSurpriseAssist(kind: SurpriseAssistKind, amount: number): Promise<boolean> {
        if ((kind !== 'hint' && kind !== 'add-time' && kind !== 'life') || !Number.isSafeInteger(amount) || amount < 1 || amount > 3
            || this.isPaused || this._isGameOver || this._rewardPending || this.platform.interstitialBusy
            || !this.game?.node.activeInHierarchy) return false;
        if (kind === 'life') {
            if (amount !== 1 || !this._currentLevel || this._lives <= 0 || this._lives >= this._currentLevel.maxLives) return false;
            this._lives = Math.min(this._currentLevel.maxLives, this._lives + 1);
            this.game.refreshHud();
            this.toast('恢复生命 +1');
            return true;
        }
        const round = this._assistRoundVersion;
        let granted = false;
        const grant = () => {
            if (round !== this._assistRoundVersion || this._isGameOver || !this.game?.node.activeInHierarchy) return;
            // 仅保存净增加的库存，避免先发再扣的两次写入导致失败时重复领取。
            if (amount > 1 && !this.save.grantAssist(kind, amount - 1)) { this.toast('保存失败，请稍后再试'); return; }
            granted = true;
            if (kind === 'hint') { this.playHintSound(); this.useHint(); }
            else { this.playAddTimeSound(); this.addTime(60); }
            this.game.refreshHud();
            this.toast(`已使用${kind === 'hint' ? '提示' : '加时'}道具${amount > 1 ? `，另${amount - 1}个已存入库存` : ''}`);
        };
        if (amount >= 2) await this.requestReward('surprise', grant);
        else grant();
        return granted;
    }

    public claimSidebarReward(): boolean {
        const sidebar = this.platform.sidebar;
        if (!sidebar.supported || !sidebar.fromSidebarToday) {
            this.toast('请从首页侧边栏进入游戏后领取');
            return false;
        }
        const result = this.save.claimSidebar(sidebarDay(), SidebarService.HINT_REWARD);
        this.toast(result === 'claimed' ? `已领取免费提示 ×${SidebarService.HINT_REWARD}`
            : result === 'already-claimed' ? '今日已领取，明日再来' : '保存失败，请稍后再试');
        return result === 'claimed';
    }

    public addTime(seconds: number): void {
        if (this._isGameOver || !Number.isFinite(seconds) || seconds <= 0) return;
        this._remainingTime += seconds;
        this.game?.refreshHud();
    }

    public async requestAddTime(): Promise<void> {
        if (this._isPaused || this._isGameOver || !this.game?.node.activeInHierarchy) return;
        this.playAddTimeSound();
        if (this.save.freeAddTimes > 0) {
            if (!this.save.consumeAddTime()) { this.toast('保存失败，请稍后再试'); return; }
            this.addTime(60);
            return;
        }
        if (this.unlimitedAssists) {
            this.addTime(60);
            return;
        }
        const round = this._assistRoundVersion;
        await this.requestReward('add-time', () => {
            if (!this.save.grantAssist('add-time')) { this.toast('保存失败，请稍后再试'); return; }
            if (round === this._assistRoundVersion && !this._isGameOver && this.game?.node.activeInHierarchy
                && this.save.consumeAddTime()) this.addTime(60);
            this.game?.refreshHud();
        });
    }

    private _loadResultClip(win: boolean): Promise<AudioClip> {
        const cached = this._resultClips.get(win);
        if (cached) return cached;
        const path = `voice/ResultSound/level-${win ? 'victory' : 'failure'}`;
        const pending = new Promise<AudioClip>((resolve, reject) => {
            void this._loadGameBundle().then(bundle => bundle.load(path, AudioClip, (error, clip) => {
                if (error) {
                    this._resultClips.delete(win);
                    reject(error);
                } else resolve(clip);
            })).catch(error => { this._resultClips.delete(win); reject(error); });
        });
        this._resultClips.set(win, pending);
        return pending;
    }

    private _onResultAudioStarted(source: AudioSource): void {
        if (source === this._resultSource) this._musicMixer?.setDucked(true);
    }

    private _onResultAudioEnded(source: AudioSource): void {
        // 多个音源挂在同一节点；点击音效或连击音效结束不恢复背景音乐。
        if (source === this._resultSource) this._restoreResultMusicVolume();
    }

    private _restoreResultMusicVolume(): void {
        this._musicMixer?.setDucked(false);
    }

    private _stopResultTone(): void {
        this._resultSoundRequest++;
        this._resultSource?.stop();
        this._restoreResultMusicVolume();
    }

    private _playResultTone(win: boolean, timeOver = false): void {
        this._stopResultTone();
        this._comboSoundRequest++;
        this._comboSource?.stop();
        if (!this.save.data.soundEnabled) return;
        const request = this._resultSoundRequest;
        // 时间耗尽播放专属提示音，其余结算沿用胜利/失败音效
        const pending = timeOver ? this._loadTapClip('voice_TimeOver') : this._loadResultClip(win);
        void pending.then(clip => {
            const source = this._resultSource;
            if (!this.isValid || !this.enabledInHierarchy || !source?.isValid
                || request !== this._resultSoundRequest || !this.save.data.soundEnabled) return;
            source.clip = clip;
            source.play();
        }).catch(error => console.warn('[GameFlow] 结算音效播放失败', error));
    }

    public finishLevel(win: boolean, failReason: 'time' | 'lives' = 'lives'): void {
        if (this._isGameOver || !this._currentLevel) return;
        this._isGameOver = true;
        this._playResultTone(win, !win && failReason === 'time');

        const level = this._currentLevel;
        const alreadyCollected = this.save.isCompleted(level.key);
        let stars = 0;
        if (win) {
            const ratio = this._remainingTime / level.timeLimit;
            stars = ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1;
            this.save.completeLevel(level.key, stars, Math.max(1, Math.round(this._elapsedTime)));
            // 上报平台排行榜（抖音 setImRankData 等；非平台环境为空实现）
            this.rankProvider.submitScore(this.save.totalScore, stars, Math.max(1, Math.round(this._elapsedTime)));
        }

        const presentResult = () => {
            if (!this.isValid || !this._isGameOver || this._currentLevel !== level) return;
            this.resultModal?.present({
                win,
                stars,
                elapsedSeconds: Math.max(1, Math.round(this._elapsedTime)),
                foundCount: this._foundIds.size,
                failReason: win ? undefined : failReason,
                level,
                canRevive: !win && !this._reviveUsed,
                hasNext: win && this.findNextLevel(level) !== null,
            });
            if (win && !alreadyCollected && (level.type === 'food' || this._foods.some(food => food.levelKey === level.key))) this.showFoodTips(level, true);
            void this.platform.onRoundFinished(() => this.isValid && this._isGameOver && !this._isPaused
                && this._currentLevel === level && !!this.resultModal?.node.activeInHierarchy,
                win ? 'round-success' : 'round-failure');
        };
        // 挑战成功先播差异圈从左到右的定格波浪动画（2秒内），结束后再弹结算窗；失败保持立即弹出
        if (win && this.game?.node.activeInHierarchy) {
            this.game.playVictoryWave(presentResult);
        } else {
            presentResult();
        }
    }


    public get reviveBonusSeconds(): number { return 30; }

    public revive(): void {
        if (!this._isGameOver || this._reviveUsed) return;
        this._stopResultTone();
        this._reviveUsed = true;
        this._lives = 3;
        this._remainingTime = Math.max(0, this._remainingTime) + this.reviveBonusSeconds;
        this._isGameOver = false;
        // 广告结束时失败状态仍为true；复活必须同时解除广告留下的暂停状态。
        this._isPaused = false;
        this._combo = 0;
        this._lastFoundAt = 0;
        this.resultModal?.close();
        this.game?.refreshHud();
        this.toast(`复活成功：生命恢复至3点，时间增加${this.reviveBonusSeconds}秒`);
    }

    /** 结算面板主按钮：胜利且有下一关则进下一关，否则重玩本关。 */
    public resultPrimary(): void {
        const level = this._currentLevel;
        if (!level) return;
        const win = this._foundIds.size >= level.differences.length;
        const next = win ? this.findNextLevel(level) : null;
        if (next) {
            void this.startLevel(next.city, next.levelIndex, 'streak', 'skip-next');
        } else if (this._currentCity) {
            void this.startLevel(this._currentCity, Math.max(0, this._currentCity.levels.findIndex(dir => (this._currentCity!.levelIds?.[dir] ?? `${this._currentCity!.key}/${dir}`) === level.key)), 'streak');
        }
    }

    // ------------------------------------------------------------------
    // 平台能力
    // ------------------------------------------------------------------

    private _rewardPending = false;

    /** 点击锁定关卡先确认，不在卡片点击时直接请求广告。 */
    public async requestLevelUnlock(city: CityConfig, levelIndex: number): Promise<boolean> {
        const cityIndex = this._cities.indexOf(city);
        if (!this.isCityUnlocked(cityIndex) || !Number.isInteger(levelIndex)
            || levelIndex < 0 || levelIndex >= city.levels.length) return false;
        if (this.isLevelUnlocked(cityIndex, levelIndex)) return true;
        if (!this._eventTips?.isValid) {
            this.toast('解锁弹窗暂不可用，请稍后重试');
            return false;
        }
        return this._eventTips.present(city, levelIndex);
    }

    /** 仅由确认弹窗的单关按钮调用；是否进入由当前导航状态决定。 */
    public async watchLevelUnlockVideo(city: CityConfig, levelIndex: number): Promise<boolean> {
        const cityIndex = this._cities.indexOf(city);
        if (!this.isCityUnlocked(cityIndex) || !Number.isInteger(levelIndex)
            || levelIndex < 0 || levelIndex >= city.levels.length) return false;
        if (this.isLevelUnlocked(cityIndex, levelIndex)) return true;
        let unlocked = false;
        await this.requestReward('unlock-level', () => {
            unlocked = this.save.unlockLevel((city.levelIds?.[city.levels[levelIndex]] ?? `${city.key}/${city.levels[levelIndex]}`));
            if (!unlocked) this.toast('关卡解锁保存失败，请稍后重试');
        });
        return unlocked;
    }

    /** 整章每次点击只播放一个视频，累计进度由本次 EventTips 会话持有。 */
    public async watchChapterUnlockVideo(city: CityConfig): Promise<boolean> {
        if (!this.isCityUnlocked(this._cities.indexOf(city)) || !city.levels.length) return false;
        let completed = false;
        await this.requestReward('unlock-chapter', () => { completed = true; });
        return completed;
    }

    public async requestReward(placement: RewardPlacement, onReward: () => void): Promise<void> {
        if (this.feed?.isPreview) return;
        // 广告并发单独保护，包含结算后的复活请求。
        const isUnlock = placement === 'unlock-level' || placement === 'unlock-chapter' || placement === 'unlock-city' || placement === 'level-select' || placement === 'energy' || placement === 'daily-sign-in';
        if (this._rewardPending || (!isUnlock && this._isPaused && !this._isGameOver)) return;
        const wasPaused = this._isPaused;
        this._rewardPending = true;
        this._isPaused = true;
        let result: RewardResult;
        try {
            result = await this.platform.showRewardedAd(placement);
        } catch (error) {
            console.warn('[Reward] 广告播放失败', error);
            this.toast('广告加载失败，请稍后重试');
            return;
        } finally {
            this._rewardPending = false;
            this._isPaused = isUnlock ? wasPaused : this._isGameOver;
        }
        if (result.success && result.completed) {
            onReward();
        } else {
            this.toast(result.reason ?? '广告未完成，请稍后重试');
        }
    }

    public share(levelKey?: string): void {
        if (this.platform.share(levelKey ?? this._currentLevel?.key ?? '1') === false) {
            this.toast(this.platform.isHarmony ? '鸿蒙系统暂不支持分享' : '当前环境暂不支持分享，请稍后重试');
            return;
        }
        this.toast(this.platform.kind === 'h5' ? '分享链接已尝试复制' : '已打开分享面板');
    }

    /** 当前图片就绪后，串行低优先级预下载下一关，不创建纹理。 */
    public async preloadNextLevel(level: LevelConfig): Promise<void> {
        if (this._prefetchRunning) { this._prefetchPending = level; return; }
        const version = this._levelLoadVersion;
        const active = () => this.isValid && version === this._levelLoadVersion
            && this._currentLevel === level && !!this.game?.node.activeInHierarchy;
        this._prefetchRunning = true;
        let releaseBundle: (() => void) | undefined;
        try {
            const cityIndex = this._cities.findIndex(city => city === this._currentCity);
            const city = this._cities[cityIndex];
            if (!city || !active()) return;
            const index = city.levels.findIndex(dir => (city.levelIds?.[dir] ?? `${city.key}/${dir}`) === level.key);
            if (index < 0) return;
            const targetLevel = this._nextLevelTarget(city, index);
            const nextCity = targetLevel?.city;
            const dir = nextCity?.levels[targetLevel!.levelIndex];
            if (!nextCity || !dir || nextCity.key !== city.key) return;
            if (!active()) return;
            releaseBundle = this._contentBundles.retain(nextCity.key);
            const next = await this._loadLevel(null, nextCity.key, dir);
            for (const path of [next.topImage, next.bottomImage]) {
                if (!active()) return;
                if (!path.startsWith('levels/')) continue;
                const target = this._levelImageTarget(path);
                if (target.cityKey !== city.key) continue;
                const images = await this._loadCityBundle('levels', target.cityKey);
                if (!active()) return;
                const info = images.getInfoWithPath(target.request, SpriteFrame);
                if (!info) continue;
                await new Promise<void>((resolve, reject) => {
                    assetManager.preloadAny({ uuid: info.uuid, bundle: images.name }, { priority: -1, maxConcurrency: 1 },
                        error => error ? reject(error) : resolve());
                });
            }
        } catch (error) {
            console.warn('[GameFlow] 下一关预加载失败，进入时重试', error);
        } finally {
            releaseBundle?.();
            this._prefetchRunning = false;
            const pending = this._prefetchPending;
            this._prefetchPending = null;
            if (pending && this.isValid && this._currentLevel === pending && this.game?.node.activeInHierarchy) {
                void this.preloadNextLevel(pending);
            }
        }
    }

    /** 页面持有独立引用，离开关卡时 decRef；不写入永久图片缓存。 */
    public async acquireLevelFrame(path: string): Promise<SpriteFrame> {
        const remote = path.startsWith('levels/');
        const target = remote ? this._levelImageTarget(path) : null;
        const release = target ? this._contentBundles.retain(target.cityKey) : () => {};
        try {
            const bundle = target ? await this._loadCityBundle('levels', target.cityKey) : await this._loadGameBundle();
            const frame = await new Promise<SpriteFrame>((resolve, reject) => {
                bundle.load(target ? target.request : `Common/${path}`, SpriteFrame, (error, loaded) => {
                    if (error) reject(error);
                    else { loaded.addRef(); resolve(loaded); }
                });
            });
            const leases = this._levelFrameBundles.get(frame) ?? [];
            leases.push(release);
            this._levelFrameBundles.set(frame, leases);
            return frame;
        } catch (error) { release(); throw error; }
    }

    public releaseLevelFrame(frame: SpriteFrame): void {
        const leases = this._levelFrameBundles.get(frame);
        const release = leases?.pop();
        if (!leases?.length) this._levelFrameBundles.delete(frame);
        frame.decRef();
        release?.();
    }

    /** 页面内去重并合并并发加载；失效页面的加载结果返回 null。 */
    public loadPageSpriteFrame(path: string, owner: Node): Promise<SpriteFrame | null> {
        if (this._pageSpritesDisposed || !owner.isValid || !owner.activeInHierarchy) return Promise.resolve(null);
        let entries = this._pageSpriteFrames.get(owner);
        if (!entries) {
            entries = new Map();
            this._pageSpriteFrames.set(owner, entries);
        }
        const cached = entries.get(path);
        if (cached) return cached.pending;
        const scope = entries;
        const entry: PageSpriteEntry = { frame: null, pending: Promise.resolve(null) };
        scope.set(path, entry);
        const current = () => !this._pageSpritesDisposed && owner.isValid && owner.activeInHierarchy
            && this._pageSpriteFrames.get(owner) === scope && scope.get(path) === entry;
        entry.pending = (async () => {
            const target = this._chapterSpriteTarget(path);
            if (target) entry.releaseBundle = this._contentBundles.retain(target.cityKey);
            const load = async (bundle: AssetManager.Bundle): Promise<SpriteFrame | null> => {
                if (!current()) return null;
                const request = target ? target.request : `Common/${path}`;
                // 每个页面拥有一份独立引用，不写入常驻小图标缓存。
                const frame = await new Promise<SpriteFrame>((resolve, reject) => {
                    const complete = (error: Error | null, loaded: SpriteFrame) => {
                        if (error) reject(error);
                        else { loaded.addRef(); resolve(loaded); }
                    };
                    bundle.load(request, SpriteFrame, (error, loaded) => {
                        if (error && current()) bundle.load(`${request}/spriteFrame`, SpriteFrame, complete);
                        else complete(error, loaded);
                    });
                });
                if (!current()) { frame.decRef(); return null; }
                entry.frame = frame;
                return frame;
            };
            return target ? await this._contentBundles.use(target.cityKey, load) : await load(await this._loadGameBundle());
        })().catch(error => {
            const stillCurrent = current();
            if (scope.get(path) === entry) scope.delete(path);
            entry.releaseBundle?.();
            if (!stillCurrent) return null;
            throw error;
        });
        return entry.pending;
    }

    public releasePageSpriteFrames(owner: Node): void {
        const entries = this._pageSpriteFrames.get(owner);
        if (!entries) return;
        // 先令异步请求失效；即使同一帧重新打开页面，旧请求也不能写入新页面。
        this._pageSpriteFrames.delete(owner);
        const frames = new Set<SpriteFrame>();
        for (const entry of entries.values()) if (entry.frame) frames.add(entry.frame);
        // 隐藏但复用的节点也必须清掉贴图，防止保留已释放的 SpriteFrame。
        if (owner.isValid) {
            for (const sprite of owner.getComponentsInChildren(Sprite)) {
                if (sprite.spriteFrame && frames.has(sprite.spriteFrame)) sprite.spriteFrame = null;
            }
        }
        for (const entry of entries.values()) {
            entry.frame?.decRef();
            entry.releaseBundle?.();
        }
        entries.clear();
    }

    /** 仅用于常驻的小图标、头像池等；页面图片使用 loadPageSpriteFrame。 */
    public loadSpriteFrame(path: string): Promise<SpriteFrame> {
        const cached = this._spriteFrameCache.get(path);
        if (cached && cached.isValid) return Promise.resolve(cached);
        // 内容图片按封面、收藏图标、章节三个渠道路由。
        const target = this._chapterSpriteTarget(path);
        const request = target ? target.request : path;
        return target
            ? this._contentBundles.use(target.cityKey, bundle => this._loadSpriteFrom(bundle, path, request))
            : this._loadGameBundle().then(bundle => this._loadSpriteFrom(bundle, path, `Common/${request}`));
    }

    /** levels/城市/关卡/图片 → 城市 Bundle + 关卡/图片。 */
    private _levelImageTarget(path: string): { cityKey: string; request: string } {
        const match = /^levels\/([a-zA-Z0-9-]+)\/(.+)$/.exec(path);
        if (!match) throw new Error(`无效的城市关卡图片路径：${path}`);
        return { cityKey: match[1], request: match[2] };
    }

    private _chapterSpriteTarget(path: string): { cityKey: string; request: string } | null {
        if (path.startsWith('levels/')) return this._levelImageTarget(path);
        const shared = /^(chapter-covers|food-icons)\/(.+)$/.exec(path);
        if (shared) return { cityKey: shared[1], request: shared[2] };
        const thumbnail = /^thumbnails\/([a-zA-Z0-9-]+)\/(.+)$/.exec(path);
        if (thumbnail) return { cityKey: thumbnail[1], request: `thumbnails/${thumbnail[2]}` };
        if (path.startsWith('thumbnails/') || path.startsWith('configs/city-')) throw new Error(`无效的关卡资源路径：${path}`);
        return null;
    }

    private _loadSpriteFrom(source: AssetManager.Bundle, path: string, request = path): Promise<SpriteFrame> {
        // 封面可能直接使用关卡上图。缓存必须独立持有引用，否则退出关卡的 decRef 会销毁仍在显示的封面。
        const retain = (frame: SpriteFrame): SpriteFrame => {
            if (this._spriteFrameCache.get(path) !== frame) {
                frame.addRef();
                this._spriteFrameCache.set(path, frame);
            }
            return frame;
        };
        return new Promise((resolve, reject) => {
            source.load(request, SpriteFrame, (error, asset) => {
                if (error) {
                    // 部分资源（如 webp 单图）在 bundle 中仅登记 spriteFrame 子资源，自动补后缀重试
                    source.load(`${request}/spriteFrame`, SpriteFrame, (retryError, retryAsset) => {
                        if (retryError) {
                            reject(retryError);
                            return;
                        }
                        resolve(retain(retryAsset));
                    });
                    return;
                }
                resolve(retain(asset));
            });
        });
    }

    // ------------------------------------------------------------------
    // 运行时动态元素（Toast / 模拟广告 / 遮罩）
    // ------------------------------------------------------------------

    public toast(message: string): void {
        const parent = this.node.parent ?? this.node;
        const toastNode = new Node('Toast');
        toastNode.parent = parent;
        const ui = toastNode.addComponent(UITransform);
        ui.setContentSize(560, 70);
        ui.anchorX = 0.5;
        ui.anchorY = 0.5;
        toastNode.setPosition(0, -480);
        const graphics = toastNode.addComponent(Graphics);
        graphics.fillColor = new Color(5, 20, 42, 235);
        graphics.roundRect(-280, -35, 560, 70, 18);
        graphics.fill();
        const labelNode = new Node('Label');
        labelNode.parent = toastNode;
        const labelUi = labelNode.addComponent(UITransform);
        labelUi.setContentSize(520, 56);
        const label = labelNode.addComponent(Label);
        label.string = message;
        label.fontSize = 24;
        label.color = Color.WHITE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        const opacity = toastNode.addComponent(UIOpacity);
        tween(opacity).delay(1.4).to(0.35, { opacity: 0 }).call(() => toastNode.destroy()).start();
    }

    // ------------------------------------------------------------------
    // 配置加载
    // ------------------------------------------------------------------

    private async _bootstrap(): Promise<void> {
        if (this._booting) return;
        this._booting = true;
        this._bootFailed = false;
        this._setLoadingProgress(0);
        let active = true;
        const report = (value: number) => {
            if (active && this.isValid) this._setLoadingProgress(value);
        };
        let initialDone = 0;
        const initial = async <T>(task: Promise<T>): Promise<T> => {
            const result = await task;
            report(++initialDone / 6 * 0.4);
            return result;
        };
        try {
            const [gradesAsset, platformAsset, cityIndexAsset, foodAsset, dailyAsset, porcelainAsset] = await Promise.all([
                initial(this._loadJson('configs/levels')),
                initial(this._loadJson('configs/platform-config')),
                initial(this._loadJson('configs/cities')),
                initial(this._loadJson('configs/food-catalog')),
                initial(this._loadJson('configs/daily-sign-in')),
                initial(this._loadJson('configs/porcelain-catalog')),
            ]);
            this._foods = [...(foodAsset.json as { foods: FoodCatalogEntry[] }).foods];
            this._grades = gradesAsset.json as GradeConfig;
            this._dailyConfig = dailyAsset.json as DailySignInConfig;
            this.platform.configure(platformAsset.json as PlatformConfig);
            this.platform.preloadInterstitial?.();
            this.playStats?.configure((platformAsset.json as PlatformConfig).playStats, (platformAsset.json as PlatformConfig).apiBaseUrl);
            this.feed?.configure((platformAsset.json as PlatformConfig).feed);

            const index = cityIndexAsset.json as CityIndex;
            // Draft chapters retain their collection mapping without exposing unplayable video rewards.
            const publishedLevelIds = new Set(index.cities.flatMap(key => index.chapters[key]?.levels
                .map(level => typeof level === 'string' ? `${key}/${level}` : level.id) ?? []));
            const porcelain = (porcelainAsset.json as { items?: FoodCatalogEntry[] }).items ?? [];
            this._foods.push(...porcelain.filter(item => publishedLevelIds.has(item.levelKey)));
            this._cityIndex = index;
            report(0.45);
            let cityDone = 0;
            this._cities = await Promise.all(index.cities.map(async key => {
                const city = await this._loadCityMeta(null, key);
                report(0.45 + ++cityDone / index.cities.length * 0.3);
                return city;
            }));
            report(0.75);
            report(0.99);

            // v2 旧档迁移保持原城市顺序，新增前置专题不能占用旧关卡编号。
            const rules = (await this._loadJson('configs/chapter-rules')).json as ChapterRulesConfig;
            const legacyLayout = (await this._loadJson('configs/chapter-layout-legacy')).json as Record<string, string[]>;
            const allKeys: string[] = [];
            for (const key of rules.legacyOrders[0]) {
                allKeys.push(...(legacyLayout[key] ?? []));
            }
            const migratedLegacy = this.save.migrateLegacy(allKeys);
            if (!this.save.migrateChapterRules(rules, this._cities, migratedLegacy)) {
                throw new Error('旧关卡解锁进度保存失败，请重试');
            }
            if (!this.save.migrateContentLayout(this._cities, legacyLayout)) {
                throw new Error('章节调整前的关卡资格保存失败，请重试');
            }

            if (!this.isValid) return;
            report(1);
            // 保持启动遮罩，按存档直接进入当前关卡；关卡就绪后由 startLevel 关闭遮罩。
            const feedKey = this.feed?.launchLevelKey;
            const feedTarget = feedKey ? this._cities.map((city, cityIndex) => ({ city, cityIndex,
                levelIndex: city.levels.findIndex(dir => (city.levelIds?.[dir] ?? `${city.key}/${dir}`) === feedKey) }))
                .find(target => target.levelIndex >= 0 && this.isCityUnlocked(target.cityIndex)
                    && this.isLevelUnlocked(target.cityIndex, target.levelIndex)) : null;
            if (feedTarget) await this.startLevel(feedTarget.city, feedTarget.levelIndex);
            else await this.startContinue();
        } catch (error) {
            active = false;
            this._bootFailed = true;
            // 失败的音效Promise不能留在缓存中，否则重试仍会立即失败。
            this._comboClips.clear();
            console.error('[GameFlow] 资源加载失败', error);
            this._returnToLobbyOnLoadError('资源加载失败，已返回主界面');
        } finally {
            active = false;
            this._booting = false;
        }
    }

    private async _loadCityMeta(_bundle: AssetManager.Bundle | null, key: string): Promise<CityConfig> {
        const meta = this._cityIndex?.chapters?.[key];
        if (!meta) throw new Error(`主包缺少章节索引: ${key}，请重新生成关卡清单`);
        const entries = (meta.levels ?? []).filter(entry => entry !== 'level-00').map(entry =>
            typeof entry === 'string' ? { id: `${key}/${entry}`, name: '', folder: entry } : entry);
        const levelIds: Record<string, string> = {}, levelNames: Record<string, string> = {};
        for (const entry of entries) {
            levelIds[entry.folder] = entry.id;
            levelNames[entry.folder] = entry.name;
        }
        return {
            key,
            name: meta.name ?? key,
            banner: meta.banner ?? `chapter-covers/${key}-icon/spriteFrame`,
            levels: entries.map(entry => entry.folder),
            levelIds,
            levelNames,
            nextChapter: meta.nextChapter,
            legacyKeys: meta.legacyKeys,
            levelsLoaded: false,
            levelConfigs: [],
        };
    }

    /** 懒加载城市内全部关卡配置（幂等）。 */
    public async ensureCity(city: CityConfig): Promise<void> {
        if (city.levelsLoaded) return;
        await this._contentBundles.use(city.key, async () => {
            for (let i = 0; i < city.levels.length; i++) await this._ensureLevel(city, i);
        });
        city.levelsLoaded = true;
    }

    private async _ensureLevel(city: CityConfig, levelIndex: number): Promise<LevelConfig> {
        if (!city.levels[levelIndex]) throw new Error('关卡目录不存在');
        const cached = city.levelConfigs[levelIndex];
        if (cached) return cached;
        const level = await this._loadLevel(null, city.key, city.levels[levelIndex]);
        city.levelConfigs[levelIndex] = level;
        return level;
    }

    private async _loadLevel(_bundle: AssetManager.Bundle | null, cityKey: string, levelDir: string): Promise<LevelConfig> {
        const meta = this._cityIndex?.chapters?.[cityKey];
        const entry = meta?.levels.find(item => typeof item !== 'string' && item.folder === levelDir);
        const definition = typeof entry === 'object' ? entry : undefined;
        const key = definition?.id ?? `${cityKey}/${levelDir}`;
        const file = await this._contentBundles.use(cityKey, async bundle => {
            const asset = await this._loadBundleJson(bundle, `configs/${levelDir}/differences`);
            // 运行时只保留普通配置数据，配对归还 JsonAsset 引用。
            try { return JSON.parse(JSON.stringify(asset.json)) as LevelFileConfig; }
            finally { asset.decRef(); }
        });
        const topImage = file.topImage ?? `levels/${cityKey}/${levelDir}/scene-a/spriteFrame`;
        const bottomImage = file.bottomImage ?? `levels/${cityKey}/${levelDir}/scene-b/spriteFrame`;
        return {
            key,
            name: definition?.name ?? file.name ?? levelDir,
            type: file.type ?? 'normal',
            timeLimit: this._timeFor(file.differences?.length ?? 0),
            maxLives: this._grades.maxLives,
            topImage,
            bottomImage,
            icon: file.icon || topImage,
            foodName: file.foodName,
            foodDesc: file.foodDesc,
            reviews: file.reviews,
            differences: file.differences ?? [],
        };
    }

    /** 十处差异起步两分半，每多一处增加十五秒，初始最多五分钟（由配置控制）。 */
    private _timeFor(differenceCount: number): number {
        const base = this._grades.baseTimeSeconds ?? 150;
        const baseline = this._grades.baseDifferenceCount ?? 10;
        const increment = this._grades.secondsPerExtraDifference ?? 15;
        const maximum = this._grades.maxTimeSeconds ?? 300;
        return Math.min(maximum, base + Math.max(0, differenceCount - baseline) * increment);
    }

    /** 每章一个完整资源包，配置、小图、大图共享请求及缓存。 */
    private _loadCityBundle(_folder: 'configs' | 'thumbnails' | 'levels' = 'levels', cityKey?: string): Promise<AssetManager.Bundle> {
        if (!cityKey) return Promise.reject(new Error('关卡资源包加载缺少大关卡标识'));
        return this._contentBundles.load(cityKey);
    }

    /** 局内素材独立加载；失败后可重试，并合并同时发起的加载请求。 */
    private _loadGameBundle(): Promise<AssetManager.Bundle> {
        if (this._gameBundle) return Promise.resolve(this._gameBundle);
        if (this._gameBundlePending) return this._gameBundlePending;
        this._gameBundlePending = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle('MainGameSources', (error: Error | null, bundle: AssetManager.Bundle) => {
                if (error || !bundle) reject(error ?? new Error('局内资源包加载失败'));
                else { this._gameBundle = bundle; resolve(bundle); }
            });
        }).finally(() => { this._gameBundlePending = null; });
        return this._gameBundlePending;
    }

    public async loadGameSpriteFrame(path: string): Promise<SpriteFrame> {
        return this._loadSpriteFrom(await this._loadGameBundle(), path);
    }

    public async loadGamePrefab(name: string): Promise<Prefab> {
        const bundle = await this._loadGameBundle();
        return new Promise((resolve, reject) => bundle.load(`prefabs/${name}`, Prefab,
            (error, prefab) => error ? reject(error) : resolve(prefab)));
    }

    public async loadCommonPrefab(name: string): Promise<Prefab> {
        const bundle = await this._loadGameBundle();
        return new Promise((resolve, reject) => bundle.load(`Common/prefabs/${name}`, Prefab,
            (error, prefab) => error ? reject(error) : resolve(prefab)));
    }

    /** Loading has no references to these nodes. Mount their original local coordinates after download. */
    private _ensureSharedUI(): Promise<void> {
        if (this._sharedUIReady) return Promise.resolve();
        if (this._sharedUIPending) return this._sharedUIPending;
        this._sharedUIPending = (async () => {
            const bundle = await this._loadGameBundle();
            const prefab = await new Promise<Prefab>((resolve, reject) => bundle.load('prefabs/GameplaySupport', Prefab,
                (error, asset) => error ? reject(error) : resolve(asset)));
            if (!this.isValid) throw new Error('游戏流程已销毁');
            const canvas = this.node.parent, screens = canvas?.getChildByName('Screens');
            if (!canvas || !screens) throw new Error('界面容器不存在');
            const root = instantiate(prefab);
            root.active = false;
            for (const child of [...root.children]) child.parent = child.name === 'GameTips' ? screens : canvas;
            root.destroy();
            this._initSharedUI();
            this._sharedUIReady = true;
            void this._loadComboClip(0).catch(error => console.warn('[GameFlow] 点击音效预加载失败', error));
        })().finally(() => { this._sharedUIPending = null; });
        return this._sharedUIPending;
    }

    private _loadSecondaryBundle(): Promise<AssetManager.Bundle> {
        return this._loadLobbyBundle();
    }

    /** 首次打开才加载，合并重复点击；页面节点复用，封面仍按页面生命周期释放。 */
    private _ensureSecondaryPage(kind: 'rank' | 'collect'): Promise<RankScreen | CollectScreen> {
        const existing = this[kind];
        if (existing?.isValid) return Promise.resolve(existing);
        const pending = this._secondaryPagesPending.get(kind);
        if (pending) return pending;
        const request = (async () => {
            const bundle = await this._loadSecondaryBundle();
            if (this._secondaryDisposed) throw new Error('游戏流程已销毁');
            const prefab = await new Promise<Prefab>((resolve, reject) => {
                bundle.load(`SecondaryUI/prefabs/${kind === 'rank' ? 'RankScreen' : 'CollectScreen'}`, Prefab, (error, loaded) => {
                    if (error) { reject(error); return; }
                    loaded.addRef();
                    if (this._secondaryDisposed) { loaded.decRef(); reject(new Error('游戏流程已销毁')); return; }
                    this._secondaryPrefabs.set(kind, loaded);
                    resolve(loaded);
                });
            });
            if (this._secondaryDisposed) throw new Error('游戏流程已销毁');
            const screens = this.node.parent?.getChildByName('Screens');
            if (!screens) throw new Error('界面容器不存在');
            const node = instantiate(prefab);
            node.active = false;
            node.name = kind === 'rank' ? 'Rank' : 'Collect';
            const page = kind === 'rank' ? node.getComponent(RankScreen) : node.getComponent(CollectScreen);
            if (!page) { node.destroy(); throw new Error('页面预制体缺少界面组件'); }
            node.parent = screens;
            if (kind === 'rank') this.rank = page as RankScreen;
            else this.collect = page as CollectScreen;
            return page;
        })().catch(error => {
            const prefab = this._secondaryPrefabs.get(kind);
            if (prefab) { this._secondaryPrefabs.delete(kind); prefab.decRef(); }
            throw error;
        }).finally(() => { this._secondaryPagesPending.delete(kind); });
        this._secondaryPagesPending.set(kind, request);
        return request;
    }

    private _cancelSecondaryNavigation(): void {
        ++this._secondaryNavigationVersion;
        if (this._secondaryPageLoading && this._loadingNode) this._loadingNode.active = false;
        this._secondaryPageLoading = false;
    }

    private async _openSecondaryPage(kind: 'rank' | 'collect'): Promise<void> {
        this._cancelSecondaryNavigation();
        const version = this._secondaryNavigationVersion;
        const active = () => !this._secondaryDisposed && version === this._secondaryNavigationVersion;
        if (!this[kind]?.isValid && this._loadingNode) {
            this._setLoadingProgress(0);
            this._secondaryPageLoading = true;
            this._loadingNode.active = true;
            this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
        }
        try {
            const page = await this._ensureSecondaryPage(kind);
            if (!active()) return;
            this._secondaryPageLoading = false;
            this._setLoadingProgress(1);
            this._switchTo(page);
            void this.platform.showInterstitial(() => this.isValid && page.node.activeInHierarchy,
                true, kind === 'rank', kind === 'rank' ? 'rank' : 'secondary-page', kind === 'rank');
        } catch (error) {
            if (!active()) return;
            this._secondaryPageLoading = false;
            if (this._loadingNode) this._loadingNode.active = false;
            console.warn('[GameFlow] 页面加载失败', kind, error);
            this.toast('页面加载失败，请重试');
        }
    }

    /** 首页不持有局内预制体引用；第一次进关在加载遮罩下创建，后续复用。 */
    private async _ensureGameScreens(): Promise<void> {
        if (this.game?.isValid && this.resultModal?.isValid) return;
        if (this._gameScreensPending) return this._gameScreensPending;
        this._gameScreensPending = (async () => {
            if (!this._sharedUIReady) await this._ensureSharedUI();
            const bundle = await this._loadGameBundle();
            const load = (path: string): Promise<Prefab> => new Promise((resolve, reject) => {
                bundle.load(path, Prefab, (error, prefab) => error ? reject(error) : resolve(prefab));
            });
            const [gamePrefab, resultPrefab] = await Promise.all([
                load('prefabs/GameScreen'), load('prefabs/ResultModal'),
            ]);
            if (!this.isValid) throw new Error('游戏流程已销毁');
            const canvas = this.node.parent;
            const screens = canvas?.getChildByName('Screens');
            if (!canvas || !screens) throw new Error('界面容器不存在');
            const gameNode = instantiate(gamePrefab);
            const resultNode = instantiate(resultPrefab);
            const game = gameNode.getComponent(GameScreen);
            const result = resultNode.getComponent(ResultModal);
            if (!game || !result) {
                gameNode.destroy(); resultNode.destroy();
                throw new Error('局内预制体缺少界面组件');
            }
            gameNode.active = resultNode.active = false;
            gameNode.name = 'Game';
            resultNode.name = 'ResultModal';
            gameNode.parent = screens;
            resultNode.parent = canvas;
            this.game = game;
            this.resultModal = result;
        })().finally(() => { this._gameScreensPending = null; });
        return this._gameScreensPending;
    }

    private _loadJson(path: string): Promise<JsonAsset> {
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (error, asset) => (error ? reject(error) : resolve(asset)));
        });
    }

    private _loadBundleJson(bundle: AssetManager.Bundle, path: string): Promise<JsonAsset> {
        return new Promise((resolve, reject) => {
            bundle.load(path, JsonAsset, (error, asset) => {
                if (error) reject(error);
                else { asset.addRef(); resolve(asset); }
            });
        });
    }
}
