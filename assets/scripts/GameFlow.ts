import { FoodTips } from './ui/FoodTips';
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
    JsonAsset,
    instantiate,
    Label,
    Node,
    Prefab,
    ResolutionPolicy,
    SpriteFrame,
    Sprite,
    UITransform,
    UIOpacity,
    Vec3,
    resources,
    tween,
    view,
} from 'cc';
import {
    CityConfig,
    FoodCatalogEntry,
    CityIndex,
    DifferenceConfig,
    GradeConfig,
    LevelConfig,
    LevelFileConfig,
    PlatformConfig,
    RewardPlacement,
    RewardResult,
} from './core/GameTypes';
import { PlatformService } from './services/PlatformService';
import { SaveService } from './services/SaveService';
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

const { ccclass, property } = _decorator;

interface PageSpriteEntry {
    frame: SpriteFrame | null;
    pending: Promise<SpriteFrame | null>;
}

/**
 * 全局流程状态机：持有存档、平台服务、城市/关卡配置与对局状态，
 * 负责界面切换、倒计时、激励视频与结算。
 * 场景中唯一实例，界面组件通过 GameFlow.instance 访问。
 *
 * 关卡组织：levels/ 按 city-* 目录分组，每城独立 Bundle；配置与小图分别独立成包。
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

    @property({ type: CitySelectScreen, tooltip: '城市选择界面组件（Screens/CitySelect）' })
    public citySelect: CitySelectScreen | null = null;

    @property({ type: LevelSelectScreen, tooltip: '选关界面组件（Screens/LevelSelect）' })
    public levelSelect: LevelSelectScreen | null = null;

    @property({ type: GameScreen, tooltip: '对局界面：首次进关从 MainGameSources 动态创建，无需拖拽绑定' })
    public game: GameScreen | null = null;

    @property({ type: RankScreen, tooltip: '排行榜：首次打开从 SecondaryUI 创建，无需拖拽绑定' })
    public rank: RankScreen | null = null;

    @property({ type: CollectScreen, tooltip: '收藏页：首次打开从 SecondaryUI 创建，无需拖拽绑定' })
    public collect: CollectScreen | null = null;

    @property({ type: ResultModal, tooltip: '结算弹窗：首次进关从 MainGameSources 动态创建，无需拖拽绑定' })
    public resultModal: ResultModal | null = null;

    public readonly save = new SaveService();
    public readonly platform = new PlatformService();
    /** 排行榜平台适配层：抖音真实榜单，其余环境本地兜底（见 services/rank） */
    public readonly rankProvider = createRankProvider(this.platform, this.save);

    private _grades: GradeConfig = { maxLives: 5, baseTimeSeconds: 120, baseDifferenceCount: 4, secondsPerExtraDifference: 15 };
    private _cities: CityConfig[] = [];
    private _currentCity: CityConfig | null = null;
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
    private _musicVolumeBeforeResult: number | null = null;
    private readonly _comboClips = new Map<string, Promise<AudioClip>>();
    /** 默认连击组位于 MainGameSources；基础点击声仍在首包。 */
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
    /** 配置、小图及各城市大图 Bundle，首次使用时加载并缓存。 */
    private readonly _cityBundles = new Map<string, AssetManager.Bundle>();
    private readonly _cityBundlePending = new Map<string, Promise<AssetManager.Bundle>>();
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
    private _musicSource: AudioSource | null = null;
    private _musicPath = '';
    private readonly _musicClips = new Map<string, AudioClip>();
    private _musicRequest = 0;
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
    private _foods: FoodCatalogEntry[] = [];

    public get foods(): readonly FoodCatalogEntry[] { return this._foods; }

    public showCatalogFood(food: FoodCatalogEntry, unlocked = false): void {
        this._foodTips?.present({ key: food.levelKey || food.id, name: food.name,
            foodName: food.name, foodDesc: food.desc, icon: food.icon, reviews: food.reviews }, unlocked);
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
        this.platform.canShowInterstitial = () => this.save.data.firstPlayedDay === sidebarDay()
            && !this._roundInterstitialProtected;
        GameFlow._instance = this;
        registerGameFlow(this);
        void this.platform.sidebar.start();
        this._initLoading();
        const foodTips = this.node.parent?.getChildByName('FoodTips');
        if (foodTips) {
            foodTips.active = false;
            this._foodTips = foodTips.getComponent(FoodTips) ?? foodTips.addComponent(FoodTips);
        }
        const uiRoot = this.node.parent;
        if (uiRoot && !uiRoot.getComponent(UIAnimationBinding)) uiRoot.addComponent(UIAnimationBinding);
        if (uiRoot) {
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
        this._musicSource = this.node.addComponent(AudioSource);
        this._musicSource.playOnAwake = false;
        this._musicSource.loop = true;
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
        void this._loadComboClip(0).catch(error => console.warn('[GameFlow] 点击音效预加载失败', error));
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.SHOW_ALL);
    }

    protected start(): void {
        void this._bootstrap();
    }

    protected update(dt: number): void {
        if (this.platform.interstitialBusy || this._levelLoading) return;
        if (this._isGameOver || this._isPaused || !this._currentLevel) return;
        if (!this.game || !this.game.node.active) return;
        this._remainingTime = Math.max(0, this._remainingTime - dt);
        this._elapsedTime += dt;
        this.game.refreshHud();
        if (this._remainingTime <= 0) { this.finishLevel(false, 'time'); return; }
        this._maybeShowAssistTutorial();
    }

    public get cities(): readonly CityConfig[] {
        return this._cities;
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
        return this._isPaused || this._levelLoading;
    }

    public get isGameOver(): boolean {
        return this._isGameOver;
    }

    // ------------------------------------------------------------------
    // 界面切换
    // ------------------------------------------------------------------

    public showLobby(): void {
        this.resultModal?.close();
        this._switchTo(this.lobby);
    }

    public showSettings(inGame: boolean): void {
        if (!this._settings || (inGame && (this._isPaused || this._isGameOver))) return;
        this._settingsInGame = inGame;
        if (inGame) {
            this._isPaused = true;
            this._settingsOpenedAt = Date.now();
        }
        this._settings.present(inGame);
        // Lobby entries attempt on every click; in-game settings retain the cooldown.
        void this.platform.showInterstitial(() => this.isValid && !!this._settings?.node.activeInHierarchy, !inGame);
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
            this._playPageMusic(music.path, music.fromBundle);
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
            const caller = this.lobby?.node;
            await this.platform.showInterstitial(() => this.isValid && !!caller?.activeInHierarchy, true);
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
    public showCitySelect(): void {
        this._switchTo(this.citySelect);
        void this.lobby?.preloadHero();
    }

    /** 城市内关卡页。city 缺省时用当前城市（或第一城）。 */
    public async showLevelSelect(city?: CityConfig): Promise<void> {
        this._cancelSecondaryNavigation();
        const target = city ?? this._currentCity ?? this._cities[0] ?? null;
        if (!target) return;
        this._currentCity = target;
        try {
            await this.ensureCity(target);
        } catch (error) {
            console.error(`[GameFlow] 城市关卡加载失败: ${target.key}`, error);
            this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
            return;
        }
        this._switchTo(this.levelSelect);
        void this.lobby?.preloadHero();
    }

    /** 从城市页进入城市：设置当前城市并打开关卡页。 */
    public async enterCity(city: CityConfig): Promise<void> {
        await this.showLevelSelect(city);
    }

    /** 开始挑战目标：第一个未通关的关（全部通关返回 null）。 */
    public async findContinueTarget(): Promise<{ city: CityConfig; levelIndex: number; level: LevelConfig } | null> {
        for (let ci = 0; ci < this._cities.length; ci++) {
            if (!this.isCityUnlocked(ci)) continue;
            const city = this._cities[ci];
            for (let li = 0; li < city.levels.length; li++) {
                const key = `${city.key}/${city.levels[li]}`;
                if (this.isLevelUnlocked(ci, li) && !this.save.isCompleted(key)) {
                    const level = await this._ensureLevel(city, li);
                    return { city, levelIndex: li, level };
                }
            }
        }
        return null;
    }

    /** 开始挑战：第一个未通关的关（全部通关则重玩第一关）。 */
    public async startContinue(): Promise<void> {
        if (this._bootFailed) {
            await this._bootstrap();
            return;
        }
        try {
            const target = await this.findContinueTarget();
            if (target) {
                await this.startLevel(target.city, target.levelIndex);
            } else if (this._cities.length > 0) {
                await this.startLevel(this._cities[0], 0);
            } else {
                throw new Error('没有可用的城市关卡');
            }
        } catch (error) {
            console.error('[GameFlow] 当前关卡加载失败', error);
            this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
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

    public async startLevel(city: CityConfig, levelIndex: number, musicSource: 'select' | 'streak' | 'retry' = 'select', failureAction: 'lobby' | 'skip-next' = 'lobby'): Promise<void> {
        if (this._levelLoading) return;
        this._cancelSecondaryNavigation();
        this._updateGameMusic(city, levelIndex, musicSource);
        const version = ++this._levelLoadVersion;
        const active = () => this.isValid && version === this._levelLoadVersion;
        this._levelLoading = true;
        this._isPaused = true;
        this.resultModal?.close();
        if (this._loadingNode) {
            this._loadingNode.active = true;
            const footer = this._loadingNode.getChildByName('FooterEnv');
            if (footer) footer.active = false;
            this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
        }
        this._setLoadingProgress(0);
        let fallback: { city: CityConfig; levelIndex: number } | null = null;
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
            this._hintAdsUsed = 0;
            this._addTimeAdsUsed = 0;
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
            const dailyFirst = this.save.beginDailyFirstRound(sidebarDay());
            this._roundInterstitialProtected = dailyFirst;
            this._isPaused = false;
            if (this._loadingNode) this._loadingNode.active = false;
            this._showFirstLevelTutorial(level);
            void this.preloadNextLevel(level);
        } catch (error) {
            if (!active()) return;
            this.game?.clearLevel();
            console.error('[GameFlow] 关卡加载失败', error);
            if (failureAction === 'skip-next') fallback = this._nextLevelTarget(city, levelIndex, true);
            if (fallback) {
                this.toast('下一关加载失败，正在进入再下一关');
            } else {
                this._returnToLobbyOnLoadError('关卡加载失败，已返回主界面');
            }
        } finally {
            if (active()) this._levelLoading = false;
        }
        // 先解除本次加载锁，再尝试一次后继关卡；后继失败统一回首页。
        if (fallback && active()) await this.startLevel(fallback.city, fallback.levelIndex, 'streak', 'lobby');
    }

    private _showFirstLevelTutorial(level: LevelConfig): void {
        if (level.key !== `${this._cities[0]?.key}/${this._cities[0]?.levels[0]}`) return;
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
        const hintAction = this.unlimitedAssists || this.save.freeHints > 0 ? '使用提示'
            : this.canWatchHintAd ? '看广告获取提示' : '查看提示次数';
        const timeAction = this.unlimitedAssists || this.save.freeAddTimes > 0 ? '加时30秒'
            : this.canWatchAddTimeAd ? '看广告加时30秒' : '查看加时次数';
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
                this._playPageMusic(music.path, music.fromBundle);
            } else {
                this._playPageMusic('voice/BGmusic/Main_music00');
            }
        } else {
            console.warn('[GameFlow] 目标界面未在场景中配置');
        }
    }

    /** 同类页面延续播放；异步加载完成后只允许当前页面的音乐开始播放。 */
    private _playPageMusic(path: string, fromBundle = false): void {
        const source = this._musicSource;
        if (!source) return;
        if (!this.save.data.musicEnabled) {
            this._musicRequest++;
            this._musicPath = '';
            source.stop();
            return;
        }
        if (this._musicPath === path) return;
        this._musicPath = path;
        const request = ++this._musicRequest;
        source.stop();
        const play = (clip: AudioClip) => {
            if (!this.isValid || !source.isValid || request !== this._musicRequest) return;
            source.clip = clip;
            source.play();
        };
        const cached = this._musicClips.get(path);
        if (cached) {
            play(cached);
            return;
        }
        const onLoaded = (error: Error | null, clip?: AudioClip) => {
            if (!this.isValid) return;
            if (error || !clip) {
                if (request === this._musicRequest) this._musicPath = '';
                console.warn(`[GameFlow] 背景音乐加载失败: ${path}`, error);
                return;
            }
            this._musicClips.set(path, clip);
            play(clip);
        };
        if (fromBundle) {
            void this._loadGameBundle()
                .then(bundle => bundle.load(path, AudioClip, onLoaded))
                .catch(error => onLoaded(error instanceof Error ? error : new Error(String(error))));
        } else {
            resources.load(path, AudioClip, onLoaded);
        }
    }

    /** 第一座城市的前四关沿用固定曲目，之后随机播放。 */
    private _isRandomMusicLevel(city: CityConfig, levelIndex: number): boolean {
        return city !== this._cities[0] || levelIndex >= 4;
    }

    /** 游戏界面当前应播放的背景音乐：随机模式下为池中曲目，否则固定曲目。 */
    private _currentGameMusic(): { path: string; fromBundle: boolean } {
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
        this._disposeSecondaryPages();
        this._pageSpritesDisposed = true;
        for (const owner of this._pageSpriteFrames.keys()) this.releasePageSpriteFrames(owner);
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
        this._clickSource?.stop();
        this._musicSource?.stop();
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

    /** 城市解锁：首城、广告提前解锁，或前一城全部通关。 */
    public isCityUnlocked(cityIndex: number): boolean {
        const city = this._cities[cityIndex];
        if (!city) return false;
        if (cityIndex === 0 || this.save.isCityUnlocked(city.key)) return true;
        const prev = this._cities[cityIndex - 1];
        if (!prev) return false;
        return prev.levels.every(dir => this.save.isCompleted(`${prev.key}/${dir}`));
    }

    /** 关卡解锁：城市已解锁，且同城前一关已通关（首关除外）。 */
    public isLevelUnlocked(cityIndex: number, levelIndex: number): boolean {
        const city = this._cities[cityIndex];
        if (!city || !this.isCityUnlocked(cityIndex)) return false;
        if (levelIndex <= 0) return true;
        return this.save.isCompleted(`${city.key}/${city.levels[levelIndex - 1]}`);
    }

    /** 城市进度（无需加载关卡配置）。 */
    public cityProgress(city: CityConfig): { done: number; total: number } {
        const done = city.levels.filter(dir => this.save.isCompleted(`${city.key}/${dir}`)).length;
        return { done, total: city.levels.length };
    }

    /** 下一关：同城下一关 → 下一城第一关（已解锁时）。结算「下一关」按钮用。 */
    public findNextLevel(after: LevelConfig): { city: CityConfig; levelIndex: number } | null {
        const city = this._currentCity;
        if (!city) return null;
        const index = city.levels.findIndex(dir => `${city.key}/${dir}` === after.key);
        return index >= 0 ? this._nextLevelTarget(city, index) : null;
    }

    /** 根据目录定位后继关卡，不依赖可能尚未加载或损坏的配置。 */
    private _nextLevelTarget(city: CityConfig, levelIndex: number, allowLockedCity = false): { city: CityConfig; levelIndex: number } | null {
        if (levelIndex + 1 < city.levels.length) return { city, levelIndex: levelIndex + 1 };
        const cityIndex = this._cities.findIndex(item => item.key === city.key);
        if (cityIndex >= 0 && cityIndex + 1 < this._cities.length && this._cities[cityIndex + 1].levels.length > 0
            && (allowLockedCity || this.isCityUnlocked(cityIndex + 1))) {
            return { city: this._cities[cityIndex + 1], levelIndex: 0 };
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
        const cached = this._comboClips.get(ref.path);
        if (cached) return cached;
        const pending = new Promise<AudioClip>((resolve, reject) => {
            const done = (error: Error | null, clip?: AudioClip) => {
                if (error || !clip) {
                    this._comboClips.delete(ref.path);
                    reject(error ?? new Error(`[GameFlow] 连击音效加载失败: ${ref.path}`));
                } else {
                    resolve(clip);
                }
            };
            if (!ref.fromBundle) resources.load(ref.path, AudioClip, done);
            else void this._loadGameBundle()
                .then(bundle => bundle.load(ref.path, AudioClip, done))
                .catch(error => done(error instanceof Error ? error : new Error(String(error))));
        });
        this._comboClips.set(ref.path, pending);
        return pending;
    }

    /** 点击声在首包，错误声在局内包；1-5 号连击音跟随本关随机组。 */
    private _comboClipRef(stage: number): { path: string; fromBundle: boolean } {
        if (stage === -1) return { path: 'voice/GamePlay/voice_wrong', fromBundle: true };
        if (stage === 0) return { path: 'voice/ComboSound/Combo _F_type01_01/voice_Combo _F_type01_00', fromBundle: false };
        const group = this._discoverComboGroups().get(this._activeComboGroup);
        const discovered = group?.stages.get(stage);
        if (discovered) return { path: discovered, fromBundle: group!.fromBundle };
        // 发现结果缺少该档位时按命名约定回退：文件名 = voice_ + 组目录名 + _0N
        const suffix = String(stage).padStart(2, '0');
        return { path: `${GameFlow.BUNDLE_COMBO_ROOT}/${this._activeComboGroup}/voice_${this._activeComboGroup}_${suffix}`, fromBundle: true };
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

    /** 连击音效逐级递增，超过现有五档后保持最高档。 */
    public playSuccessTone(combo: number): void {
        const request = ++this._comboSoundRequest;
        if (!this.save.data.soundEnabled) return;
        const stage = Math.max(1, Math.min(5, Math.floor(combo)));
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
    private _hintAdsUsed = 0;
    private _addTimeAdsUsed = 0;

    @property({ tooltip: '每关提示广告次数上限' })
    public hintAdsPerLevel = 2;

    @property({ tooltip: '每关加时广告次数上限' })
    public addTimeAdsPerLevel = 1;

    /** 无广告网页版可直接使用辅助功能，不消耗库存或每关广告次数。 */
    public get unlimitedAssists(): boolean {
        return this.platform.kind === 'h5';
    }

    public get canWatchHintAd(): boolean {
        return this.unlimitedAssists || this._hintAdsUsed < this.hintAdsPerLevel;
    }

    public get canWatchAddTimeAd(): boolean {
        return this.unlimitedAssists || this._addTimeAdsUsed < this.addTimeAdsPerLevel;
    }

    public async requestHint(): Promise<void> {
        if (this._isPaused || this._isGameOver || !this.game?.node.activeInHierarchy
            || !this._currentLevel?.differences.some(item => !this._foundIds.has(item.id))) return;
        this.playHintSound();
        if (this.unlimitedAssists) {
            this.useHint();
            this.game.refreshHud();
            return;
        }
        if (this.save.freeHints > 0) {
            if (!this.save.consumeFreeHint()) {
                this.toast('保存失败，请稍后再试');
                return;
            }
            this.useHint();
            this.game.refreshHud();
            return;
        }
        if (!this.canWatchHintAd) { this.toast('免费次数已用完'); return; }
        const round = this._assistRoundVersion;
        await this.requestReward('hint', () => {
            if (!this.save.grantAssist('hint')) { this.toast('保存失败，请稍后再试'); return; }
            if (round === this._assistRoundVersion) this._hintAdsUsed++;
            if (round === this._assistRoundVersion && !this._isGameOver && this.game?.node.activeInHierarchy
                && this.save.consumeFreeHint()) this.useHint();
            this.game?.refreshHud();
        });
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
        if (this.unlimitedAssists) {
            this.addTime(30);
            return;
        }
        if (this.save.freeAddTimes > 0) {
            if (!this.save.consumeAddTime()) { this.toast('保存失败，请稍后再试'); return; }
            this.addTime(30);
            return;
        }
        if (!this.canWatchAddTimeAd) { this.toast('免费次数已用完'); return; }
        const round = this._assistRoundVersion;
        await this.requestReward('add-time', () => {
            if (!this.save.grantAssist('add-time')) { this.toast('保存失败，请稍后再试'); return; }
            if (round === this._assistRoundVersion) this._addTimeAdsUsed++;
            if (round === this._assistRoundVersion && !this._isGameOver && this.game?.node.activeInHierarchy
                && this.save.consumeAddTime()) this.addTime(30);
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
        if (source !== this._resultSource || this._musicVolumeBeforeResult !== null) return;
        const music = this._musicSource;
        if (!music?.isValid) return;
        this._musicVolumeBeforeResult = music.volume;
        music.volume = this._musicVolumeBeforeResult * 0.5;
    }

    private _onResultAudioEnded(source: AudioSource): void {
        // 多个音源挂在同一节点；点击音效或连击音效结束不恢复背景音乐。
        if (source === this._resultSource) this._restoreResultMusicVolume();
    }

    private _restoreResultMusicVolume(): void {
        if (this._musicVolumeBeforeResult === null) return;
        if (this._musicSource?.isValid) this._musicSource.volume = this._musicVolumeBeforeResult;
        this._musicVolumeBeforeResult = null;
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
                level,
                canRevive: !win && !this._reviveUsed,
                hasNext: win && this.findNextLevel(level) !== null,
            });
            if (win && !alreadyCollected && (level.type === 'food' || this._foods.some(food => food.levelKey === level.key))) this.showFoodTips(level, true);
            void this.platform.onRoundFinished(() => this.isValid && this._isGameOver && !this._isPaused
                && this._currentLevel === level && !!this.resultModal?.node.activeInHierarchy);
        };
        // 挑战成功先播差异圈从左到右的定格波浪动画（2秒内），结束后再弹结算窗；失败保持立即弹出
        if (win && this.game?.node.activeInHierarchy) {
            this.game.playVictoryWave(presentResult);
        } else {
            presentResult();
        }
    }


    public revive(): void {
        if (!this._isGameOver) return;
        this._stopResultTone();
        this._reviveUsed = true;
        this._lives = 1;
        this._remainingTime = Math.max(this._remainingTime, 30);
        this._isGameOver = false;
        // 广告结束时失败状态仍为true；复活必须同时解除广告留下的暂停状态。
        this._isPaused = false;
        this._combo = 0;
        this._lastFoundAt = 0;
        this.resultModal?.close();
        this.game?.refreshHud();
        this.toast('复活成功：生命 +1，时间 +30秒');
    }

    /** 结算面板主按钮：胜利且有下一关则进下一关，否则重玩本关。 */
    public resultPrimary(): void {
        const level = this._currentLevel;
        if (!level) return;
        const win = this._foundIds.size >= level.differences.length;
        const next = win ? this.findNextLevel(level) : null;
        this.resultModal?.close();
        if (next) {
            void this.startLevel(next.city, next.levelIndex, 'streak', 'skip-next');
        } else if (this._currentCity) {
            void this.startLevel(this._currentCity, Math.max(0, this._currentCity.levels.findIndex(dir => `${this._currentCity!.key}/${dir}` === level.key)), 'streak');
        }
    }

    // ------------------------------------------------------------------
    // 平台能力
    // ------------------------------------------------------------------

    private _rewardPending = false;

    public async requestReward(placement: RewardPlacement, onReward: () => void): Promise<void> {
        // 城市解锁不依赖对局暂停状态；广告并发单独保护，包含结算后的复活请求。
        if (this._rewardPending || (placement !== 'unlock-city' && this._isPaused && !this._isGameOver)) return;
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
            this._isPaused = placement === 'unlock-city' ? wasPaused : this._isGameOver;
        }
        if (result.success && result.completed) {
            onReward();
        } else {
            this.toast(result.reason ?? '广告未完成，请稍后重试');
        }
    }

    public share(levelKey?: string): void {
        this.platform.share(levelKey ?? this._currentLevel?.key ?? '1');
        this.toast(this.platform.kind === 'h5' ? '分享链接已尝试复制' : '已打开分享面板');
    }

    /** 当前图片就绪后，串行低优先级预下载下一关，不创建纹理。 */
    public async preloadNextLevel(level: LevelConfig): Promise<void> {
        if (this._prefetchRunning) { this._prefetchPending = level; return; }
        const version = this._levelLoadVersion;
        const active = () => this.isValid && version === this._levelLoadVersion
            && this._currentLevel === level && !!this.game?.node.activeInHierarchy;
        this._prefetchRunning = true;
        try {
            const cityIndex = this._cities.findIndex(city => city === this._currentCity);
            const city = this._cities[cityIndex];
            if (!city || !active()) return;
            const index = city.levels.findIndex(dir => `${city.key}/${dir}` === level.key);
            if (index < 0) return;
            const nextCity = index + 1 < city.levels.length ? city : this._cities[cityIndex + 1];
            const dir = nextCity?.levels[nextCity === city ? index + 1 : 0];
            if (!nextCity || !dir) return;
            const bundle = await this._loadCityBundle();
            if (!active()) return;
            const next = await this._loadLevel(bundle, nextCity.key, dir);
            for (const path of [next.topImage, next.bottomImage]) {
                if (!active()) return;
                if (!path.startsWith('levels/')) continue;
                const target = this._levelImageTarget(path);
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
        const bundle = target ? await this._loadCityBundle('levels', target.cityKey) : resources;
        const request = target ? target.request : path;
        return new Promise((resolve, reject) => {
            bundle.load(request, SpriteFrame, (error, frame) => {
                if (error) reject(error);
                else { frame.addRef(); resolve(frame); }
            });
        });
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
            const folder = path.startsWith('levels/') ? 'levels'
                : path.startsWith('thumbnails/') ? 'thumbnails'
                : path.startsWith('configs/city-') ? 'configs' : null;
            const target = folder === 'levels' ? this._levelImageTarget(path) : null;
            const bundle = folder ? await this._loadCityBundle(folder, target?.cityKey) : resources;
            if (!current()) return null;
            const request = target ? target.request : folder ? path.slice(folder.length + 1) : path;
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
        })().catch(error => {
            const stillCurrent = current();
            if (scope.get(path) === entry) scope.delete(path);
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
        for (const entry of entries.values()) entry.frame?.decRef();
        entries.clear();
    }

    /** 仅用于常驻的小图标、头像池等；页面图片使用 loadPageSpriteFrame。 */
    public loadSpriteFrame(path: string): Promise<SpriteFrame> {
        const cached = this._spriteFrameCache.get(path);
        if (cached && cached.isValid) return Promise.resolve(cached);
        // 大图按城市选包；配置与小图去掉分类前缀后加载。
        const folder = path.startsWith('levels/') ? 'levels'
            : path.startsWith('thumbnails/') ? 'thumbnails'
            : path.startsWith('configs/city-') ? 'configs' : null;
        const target = folder === 'levels' ? this._levelImageTarget(path) : null;
        const source = folder
            ? this._loadCityBundle(folder, target?.cityKey)
            : Promise.resolve(resources);
        const request = target ? target.request : folder ? path.slice(folder.length + 1) : path;
        return source.then(bundle => this._loadSpriteFrom(bundle, path, request));
    }

    /** levels/城市/关卡/图片 → 城市 Bundle + 关卡/图片。 */
    private _levelImageTarget(path: string): { cityKey: string; request: string } {
        const match = /^levels\/(city-\d{2}-[a-zA-Z0-9]+)\/(.+)$/.exec(path);
        if (!match) throw new Error(`无效的城市关卡图片路径：${path}`);
        return { cityKey: match[1], request: match[2] };
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
            report(++initialDone / 4 * 0.4);
            return result;
        };
        try {
            const [gradesAsset, platformAsset, cityBundle, foodAsset] = await Promise.all([
                initial(this._loadJson('configs/levels')),
                initial(this._loadJson('configs/platform-config')),
                initial(this._loadCityBundle()),
                initial(this._loadJson('configs/food-catalog')),
            ]);
            this._foods = (foodAsset.json as { foods: FoodCatalogEntry[] }).foods;
            this._grades = gradesAsset.json as GradeConfig;
            this.platform.configure(platformAsset.json as PlatformConfig);

            const cityIndexAsset = await this._loadJson('configs/cities');
            const index = cityIndexAsset.json as CityIndex;
            report(0.45);
            let cityDone = 0;
            this._cities = await Promise.all(index.cities.map(async key => {
                const city = await this._loadCityMeta(cityBundle, key);
                report(0.45 + ++cityDone / index.cities.length * 0.3);
                return city;
            }));
            report(0.75);
            // 场景引用的主页图片在场景进入前已加载；这里加载动态音频并复用缓存。
            const musicPath = 'voice/BGmusic/Main_music00';
            const music = new Promise<void>((resolve, reject) => {
                resources.load(musicPath, AudioClip, (error, clip) => {
                    if (error) { reject(error); return; }
                    this._musicClips.set(musicPath, clip);
                    resolve();
                });
            });
            await music;
            report(0.99);

            // v2 旧档迁移保持原城市顺序，新增前置专题不能占用旧关卡编号。
            const allKeys: string[] = [];
            for (const city of this._cities) {
                if (city.key === 'city-00-HotTips' || city.key === 'city-01-2026Hotmeme') continue;
                for (const dir of city.levels) {
                    allKeys.push(`${city.key}/${dir}`);
                }
            }
            this.save.migrateLegacy(allKeys);

            if (!this.isValid) return;
            report(1);
            // 保持启动遮罩，按存档直接进入当前关卡；关卡就绪后由 startLevel 关闭遮罩。
            await this.startContinue();
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

    private async _loadCityMeta(bundle: AssetManager.Bundle, key: string): Promise<CityConfig> {
        const asset = await this._loadBundleJson(bundle, key);
        const meta = asset.json as { name?: string; banner?: string; levels?: string[] };
        return {
            key,
            name: meta.name ?? key,
            banner: meta.banner ?? `configs/${key}-icon/spriteFrame`,
            levels: (meta.levels ?? []).filter(dir => dir !== 'level-00'),
            levelsLoaded: false,
            levelConfigs: [],
        };
    }

    /** 懒加载城市内全部关卡配置（幂等）。 */
    public async ensureCity(city: CityConfig): Promise<void> {
        if (city.levelsLoaded) return;
        for (let i = 0; i < city.levels.length; i++) {
            await this._ensureLevel(city, i);
        }
        city.levelsLoaded = true;
    }

    private async _ensureLevel(city: CityConfig, levelIndex: number): Promise<LevelConfig> {
        if (!city.levels[levelIndex]) throw new Error('关卡目录不存在');
        const cached = city.levelConfigs[levelIndex];
        if (cached) return cached;
        const level = await this._loadLevel(await this._loadCityBundle(), city.key, city.levels[levelIndex]);
        city.levelConfigs[levelIndex] = level;
        return level;
    }

    private async _loadLevel(bundle: AssetManager.Bundle, cityKey: string, levelDir: string): Promise<LevelConfig> {
        const key = `${cityKey}/${levelDir}`;
        const asset = await this._loadBundleJson(bundle, `${key}/differences`);
        const file = asset.json as LevelFileConfig;
        const topImage = file.topImage ?? `levels/${key}/scene-a/spriteFrame`;
        const bottomImage = file.bottomImage ?? `levels/${key}/scene-b/spriteFrame`;
        return {
            key,
            name: file.name ?? levelDir,
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

    /** 四处差异起步两分钟，每多一处增加十五秒（由配置控制）。 */
    private _timeFor(differenceCount: number): number {
        const base = this._grades.baseTimeSeconds ?? 120;
        const baseline = this._grades.baseDifferenceCount ?? 4;
        const increment = this._grades.secondsPerExtraDifference ?? 15;
        return base + Math.max(0, differenceCount - baseline) * increment;
    }

    /** 配置、小图和各城市大图分别按需加载；并发请求合并，失败后可重试。 */
    private _loadCityBundle(folder: 'configs' | 'thumbnails' | 'levels' = 'configs', cityKey?: string): Promise<AssetManager.Bundle> {
        if (folder === 'levels' && !cityKey) return Promise.reject(new Error('城市大图加载缺少城市标识'));
        const name = folder === 'levels' ? cityKey! : `city-${folder}`;
        const cached = this._cityBundles.get(name);
        if (cached) return Promise.resolve(cached);
        const pending = this._cityBundlePending.get(name);
        if (pending) return pending;
        const request = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(name, (error: Error | null, bundle: AssetManager.Bundle) => {
                if (error || !bundle) reject(error ?? new Error(`[GameFlow] ${name} Bundle 加载失败`));
                else { this._cityBundles.set(name, bundle); resolve(bundle); }
            });
        }).finally(() => { this._cityBundlePending.delete(name); });
        this._cityBundlePending.set(name, request);
        return request;
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

    private _loadSecondaryBundle(): Promise<AssetManager.Bundle> {
        if (this._secondaryBundle) return Promise.resolve(this._secondaryBundle);
        if (this._secondaryBundlePending) return this._secondaryBundlePending;
        this._secondaryBundlePending = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle('SecondaryUI', (error, bundle) => {
                if (error) reject(error);
                else if (this._secondaryDisposed) reject(new Error('游戏流程已销毁'));
                else { this._secondaryBundle = bundle; resolve(bundle); }
            });
        }).finally(() => { this._secondaryBundlePending = null; });
        return this._secondaryBundlePending;
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
                bundle.load(`prefabs/${kind === 'rank' ? 'RankScreen' : 'CollectScreen'}`, Prefab, (error, loaded) => {
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
            void this.platform.showInterstitial(() => this.isValid && page.node.activeInHierarchy, true);
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
            bundle.load(path, JsonAsset, (error, asset) => (error ? reject(error) : resolve(asset)));
        });
    }
}
