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
    Label,
    Node,
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

/**
 * 全局流程状态机：持有存档、平台服务、城市/关卡配置与对局状态，
 * 负责界面切换、倒计时、激励视频与结算。
 * 场景中唯一实例，界面组件通过 GameFlow.instance 访问。
 *
 * 关卡组织：levels/ 按 city-* 目录分组，整体位于名为 city 的 Asset Bundle（assets/Bundle），
 * cities.json 为城市索引，每城 city.json 列关卡清单（tools/build-manifest.py 生成），
 * 进入城市时才懒加载该城各关的 differences.json。
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

    @property({ type: GameScreen, tooltip: '对局界面组件（Screens/Game）' })
    public game: GameScreen | null = null;

    @property({ type: RankScreen, tooltip: '排行榜界面组件（Screens/Rank）' })
    public rank: RankScreen | null = null;

    @property({ type: CollectScreen, tooltip: '收藏界面组件（Screens/Collect）' })
    public collect: CollectScreen | null = null;

    @property({ type: ResultModal, tooltip: '结算弹窗组件（ResultModal）' })
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
    /** 默认音效组目录名：0 号点击音与 voice_wrong 始终使用该组（resources/voice/ComboSound） */
    private static readonly DEFAULT_COMBO_GROUP = 'Combo _F_type01_01';
    /** 新音效组所在目录（assets/Bundle/voice/Combo _F_type，随 city Bundle 加载） */
    private static readonly BUNDLE_COMBO_ROOT = 'voice/Combo _F_type';
    /** 本关使用的连击音效组（仅影响 1-5 号），第四关起进入关卡时随机 */
    private _activeComboGroup = GameFlow.DEFAULT_COMBO_GROUP;
    /** 已发现的音效组：组目录名 → 各档位路径与加载渠道（resources 或 city Bundle） */
    private _comboGroups: Map<string, { stages: Map<number, string>; fromBundle: boolean }> | null = null;
    /** 上次发现时是否已扫描过 Bundle；Bundle 就绪后需要重新发现才能看到新组 */
    private _comboGroupsScannedBundle = false;
    private _comboSoundRequest = 0;
    private readonly _spriteFrameCache = new Map<string, SpriteFrame>();
    /** 关卡资源所在 Asset Bundle（assets/Bundle，bundleName: city），首次使用时加载并缓存。 */
    private _cityBundle: AssetManager.Bundle | null = null;
    private _overlay: Node | null = null;
    private _musicSource: AudioSource | null = null;
    private _musicPath = '';
    private readonly _musicClips = new Map<string, AudioClip>();
    private _musicRequest = 0;
    /** 第五关起随机游戏背景音乐的候选池（assets/Bundle/voice/BGmusic） */
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
        if (this._levelRetry && !this._levelLoading) { this._levelRetry(); return; }
        if (this._bootFailed && !this._booting) void this._bootstrap();
    }

    private _setLoadingProgress(progress: number): void {
        const value = Math.max(0, Math.min(1, progress));
        const fill = this._loadingFill;
        if (fill) {
            fill.width = this._loadingWidth * value;
            fill.node.setPosition(this._loadingLeft + fill.width * fill.anchorX * fill.node.scale.x,
                fill.node.position.y, fill.node.position.z);
        }
        if (this._loadingLabel) this._loadingLabel.string = `加载中 ${Math.floor(value * 100)}%`;
    }

    protected onLoad(): void {
        this.platform.canShowInterstitial = () => this.save.totalScore >= 2
            && this.save.data.firstPlayedDay === sidebarDay() && !this._roundInterstitialProtected;
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
        for (const win of [true, false]) {
            void this._loadResultClip(win).catch(error => console.warn('[GameFlow] 结算音效预加载失败', error));
        }
        void this._loadComboClip(0).catch(error => console.warn('[GameFlow] 点击音效预加载失败', error));
        void this._loadComboClip(-1).catch(error => console.warn('[GameFlow] 错误音效预加载失败', error));
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.SHOW_ALL);
    }

    protected start(): void {
        this._ensureCollectScreen();
        void this._bootstrap();
    }

    /**
     * 收藏界面组件运行时挂载到 Screens/Collect：
     * 组件类在编辑器外新增、场景未引用，这里按命名查找兜底，
     * 避免要求手动拖组件；场景中已拖挂时不会重复添加。
     */
    private _ensureCollectScreen(): void {
        if (this.collect?.isValid) return;
        const screens = this.node.parent?.getChildByName('Screens');
        const target = screens?.getChildByName('Collect');
        if (target && !target.getComponent(CollectScreen)) {
            this.collect = target.addComponent(CollectScreen);
        }
    }

    protected update(dt: number): void {
        if (this.platform.interstitialBusy || this._levelLoading || this._levelRetry) return;
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
        return this._isPaused || this._levelLoading || !!this._levelRetry;
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
            this._playPageMusic('voice/BGmusic/Game_music01');
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
        this._switchTo(this.rank);
        void this.platform.showInterstitial(() => this.isValid && !!this.rank?.node.activeInHierarchy, true);
    }

    private _openingNativeRank = false;

    private async _showNativeRank(): Promise<void> {
        if (this._openingNativeRank) return;
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
        if (food) this.showCatalogFood(food, unlocked);
        else this._foodTips?.present(level, unlocked);
    }

    public showCollect(): void {
        this._switchTo(this.collect);
        void this.platform.showInterstitial(() => this.isValid && !!this.collect?.node.activeInHierarchy, true);
    }

    /** 城市列表页。 */
    public showCitySelect(): void {
        this._switchTo(this.citySelect);
    }

    /** 城市内关卡页。city 缺省时用当前城市（或第一城）。 */
    public async showLevelSelect(city?: CityConfig): Promise<void> {
        const target = city ?? this._currentCity ?? this._cities[0] ?? null;
        if (!target) return;
        this._currentCity = target;
        try {
            await this.ensureCity(target);
        } catch (error) {
            console.error(`[GameFlow] 城市关卡加载失败: ${target.key}`, error);
            this.toast('关卡加载失败，请稍后重试');
            return;
        }
        this._switchTo(this.levelSelect);
    }

    /** 从城市页进入城市：设置当前城市并打开关卡页。 */
    public async enterCity(city: CityConfig): Promise<void> {
        await this.showLevelSelect(city);
    }

    /** 开始挑战目标：第一个未通关的关（全部通关返回 null）。 */
    public async findContinueTarget(): Promise<{ city: CityConfig; levelIndex: number; level: LevelConfig } | null> {
        for (let ci = 0; ci < this._cities.length; ci++) {
            if (!this.isCityUnlocked(ci)) break;
            const city = this._cities[ci];
            for (let li = 0; li < city.levels.length; li++) {
                const key = `${city.key}/${city.levels[li]}`;
                if (this.isLevelUnlocked(ci, li) && !this.save.isCompleted(key)) {
                    await this.ensureCity(city);
                    return { city, levelIndex: li, level: city.levelConfigs[li] };
                }
            }
        }
        return null;
    }

    /** 开始挑战：第一个未通关的关（全部通关则重玩第一关）。 */
    public async startContinue(): Promise<void> {
        const target = await this.findContinueTarget();
        if (target) {
            await this.startLevel(target.city, target.levelIndex);
        } else if (this._cities.length > 0) {
            await this.startLevel(this._cities[0], 0);
        }
    }

    private _levelLoading = false;
    private _tutorial: GameTips | null = null;
    @property({ tooltip: '仅编辑器预览：首关强制展示引导，不清除存档，不影响发布版本' })
    public previewTutorial = false;
    private _levelRetry: (() => void) | null = null;
    private _loadingBack: Node | null = null;
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

    public async startLevel(city: CityConfig, levelIndex: number, musicSource: 'select' | 'streak' | 'retry' = 'select'): Promise<void> {
        if (this._levelLoading) return;
        this._updateGameMusic(city, levelIndex, musicSource);
        if (musicSource !== 'retry') this._updateComboGroup(city, levelIndex);
        const version = ++this._levelLoadVersion;
        const active = () => this.isValid && version === this._levelLoadVersion;
        this._levelLoading = true;
        this._levelRetry = null;
        this._isPaused = true;
        this.resultModal?.close();
        if (this._loadingNode) {
            this._loadingNode.active = true;
            const footer = this._loadingNode.getChildByName('FooterEnv');
            if (footer) footer.active = false;
            this._ensureLoadingBack();
            this._loadingNode.setSiblingIndex(this._loadingNode.parent!.children.length - 1);
        }
        this._setLoadingProgress(0);
        try {
            await this._drawLoadingFrame();
            if (!active()) return;
            this.game?.clearLevel();
            await this.ensureCity(city);
            if (!active()) return;
            const level = city.levelConfigs[levelIndex];
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
            this._switchTo(this.game);
            this._setLoadingProgress(0.2);
            await this.game.setupLevel(level, value => {
                if (active()) this._setLoadingProgress(0.2 + value * 0.8);
            });
            if (!active()) return;
            await this._drawLoadingFrame();
            if (!active()) return;
            const dailyFirst = this.save.beginDailyFirstRound(sidebarDay());
            this._roundInterstitialProtected = dailyFirst || this.save.totalScore < 2;
            this._isPaused = false;
            if (this._loadingNode) this._loadingNode.active = false;
            this._showFirstLevelTutorial(level);
            void this.preloadNextLevel(level);
        } catch (error) {
            if (!active()) return;
            this.game?.clearLevel();
            this._levelRetry = () => { void this.startLevel(city, levelIndex, 'retry'); };
            if (this._loadingLabel) this._loadingLabel.string = '关卡加载失败，点击进度条重试';
            this.toast('关卡加载失败，请重试');
            console.error('[GameFlow] 关卡加载失败', error);
        } finally {
            if (active()) this._levelLoading = false;
        }
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
        const text = kind === 'hint' ? '找不到？点击提示，免费指出一处不同'
            : kind === 'zoom' ? '点击放大镜查看细节，可拖动，再点一次还原'
            : '时间不足！点击加时，免费增加30秒';
        this._isPaused = true;
        this._tutorial.present(focus.node, focus.local, focus.radius, hit => {
            if (!this.isValid || this._currentLevel !== level || !this.game?.node.activeInHierarchy) return;
            this.save.markAssistTutorialShown(kind);
            this._isPaused = this._isGameOver;
            if (!hit) return;
            // 点击高亮即赠送一次真实体验，与原开局教学一致
            if (kind === 'hint') { this.playHintSound(); this.useHint(); }
            else if (kind === 'zoom') this.game.tutorialZoom();
            else { this.playAddTimeSound(); this.addTime(30); }
        }, text, '知道了');
    }

    private _ensureLoadingBack(): void {
        if (this._loadingBack || !this._loadingNode) return;
        const button = new Node('LoadingBack');
        button.layer = this._loadingNode.layer;
        button.parent = this._loadingNode;
        button.setPosition(0, -470);
        button.addComponent(UITransform).setContentSize(240, 70);
        const label = button.addComponent(Label);
        label.string = '返回首页';
        label.fontSize = 28;
        button.on(Node.EventType.TOUCH_END, () => this.showLobby(), this);
        this._loadingBack = button;
    }

    private _switchTo(screen: LobbyScreen | CitySelectScreen | LevelSelectScreen | GameScreen | RankScreen | CollectScreen | null): void {
        this._tutorial?.dismiss();
        if (screen !== this.game) {
            ++this._levelLoadVersion;
            this._finishLoadingFrame?.();
            this._levelLoading = false;
            this._levelRetry = null;
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
                this._playPageMusic('voice/BGmusic/Game_music01');
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
            void this._loadCityBundle()
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
            : { path: 'voice/BGmusic/Main_music01', fromBundle: false };
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
        if (GameFlow._instance === this) GameFlow._instance = null;
    }

    // ------------------------------------------------------------------
    // 解锁判定（积分制：通关集合驱动）
    // ------------------------------------------------------------------

    /** 城市解锁：第一城始终解锁，其余需前一城全部通关。 */
    public isCityUnlocked(cityIndex: number): boolean {
        if (cityIndex <= 0) return true;
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
        if (city) {
            const index = city.levelConfigs.findIndex(level => level.key === after.key);
            if (index >= 0 && index + 1 < city.levelConfigs.length) {
                return { city, levelIndex: index + 1 };
            }
        }
        const cityIndex = this._cities.findIndex(item => item.key === city?.key);
        if (cityIndex >= 0 && cityIndex + 1 < this._cities.length && this.isCityUnlocked(cityIndex + 1)) {
            return { city: this._cities[cityIndex + 1], levelIndex: 0 };
        }
        return null;
    }

    // ------------------------------------------------------------------
    // 对局逻辑
    // ------------------------------------------------------------------

    /** 连击窗口：两次找对间隔在此时间内连击 +1，否则重新计数。 */
    public static readonly COMBO_WINDOW_MS = 3000;

    public onDifferenceFound(difference: DifferenceConfig): void {
        if (this._isGameOver || this._isPaused || !this._currentLevel || this._foundIds.has(difference.id)) return;
        this._foundIds.add(difference.id);
        this._lastFoundElapsed = this._elapsedTime;

        // 连击：窗口内连续找对升级，点错/超时清零
        const now = Date.now();
        this._combo = now - this._lastFoundAt <= GameFlow.COMBO_WINDOW_MS ? this._combo + 1 : 1;
        this._lastFoundAt = now;

        this.game?.drawFoundMarker(difference);
        this.game?.showSuccessFx(this._combo);
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
            else void this._loadCityBundle()
                .then(bundle => bundle.load(ref.path, AudioClip, done))
                .catch(error => done(error instanceof Error ? error : new Error(String(error))));
        });
        this._comboClips.set(ref.path, pending);
        return pending;
    }

    /** 0 号点击音与 voice_wrong 固定默认组；1-5 号连击音跟随本关随机的音效组。 */
    private _comboClipRef(stage: number): { path: string; fromBundle: boolean } {
        if (stage === -1) return { path: `voice/ComboSound/${GameFlow.DEFAULT_COMBO_GROUP}/voice_wrong`, fromBundle: false };
        if (stage === 0) return { path: `voice/ComboSound/${GameFlow.DEFAULT_COMBO_GROUP}/voice_Combo _F_type01_00`, fromBundle: false };
        const group = this._discoverComboGroups().get(this._activeComboGroup);
        const discovered = group?.stages.get(stage);
        if (discovered) return { path: discovered, fromBundle: group!.fromBundle };
        // 发现结果缺少该档位时按命名约定回退：文件名 = voice_ + 组目录名 + _0N
        const suffix = String(stage).padStart(2, '0');
        if (group?.fromBundle) {
            return { path: `${GameFlow.BUNDLE_COMBO_ROOT}/${this._activeComboGroup}/voice_${this._activeComboGroup}_${suffix}`, fromBundle: true };
        }
        const base = this._activeComboGroup.replace(/_\d+$/, '');
        return { path: `voice/ComboSound/${this._activeComboGroup}/voice_${base}_${suffix}`, fromBundle: false };
    }

    /** 枚举默认目录（resources/ComboSound）与 Bundle 新组目录下的 1-5 号资源路径；枚举失败时至少保留默认组。 */
    private _discoverComboGroups(): Map<string, { stages: Map<number, string>; fromBundle: boolean }> {
        if (this._comboGroups && (this._comboGroupsScannedBundle || !this._cityBundle)) return this._comboGroups;
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
        for (const info of resources.getDirWithPath('voice/ComboSound', AudioClip)) add(info.path, false);
        if (this._cityBundle) {
            for (const info of this._cityBundle.getDirWithPath(GameFlow.BUNDLE_COMBO_ROOT, AudioClip)) add(info.path, true);
        }
        if (!groups.has(GameFlow.DEFAULT_COMBO_GROUP)) {
            groups.set(GameFlow.DEFAULT_COMBO_GROUP, { stages: new Map(), fromBundle: false });
        }
        this._comboGroups = groups;
        this._comboGroupsScannedBundle = !!this._cityBundle;
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
            resources.load(`voice/ComboSound/Combo _F_type01_01/${name}`, AudioClip, (error, clip) => {
                if (error) {
                    this._tapClips.delete(name);
                    reject(error);
                } else {
                    resolve(clip);
                }
            });
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
        this._isPaused = true;
        this._tutorial.present(target.node, target.local, target.radius, hit => {
            if (!this.isValid || this._currentLevel !== level || !this.game?.node.activeInHierarchy) return;
            this._isPaused = this._isGameOver;
            if (hit && !this._isGameOver) this.onDifferenceFound(difference);
            this.game.refreshHud();
            onDismiss?.();
        }, '不同就在圈内，点击确认', '关闭提示');
    }

    private _assistRoundVersion = 0;
    private _hintAdsUsed = 0;
    private _addTimeAdsUsed = 0;

    @property({ tooltip: '每关提示广告次数上限' })
    public hintAdsPerLevel = 2;

    @property({ tooltip: '每关加时广告次数上限' })
    public addTimeAdsPerLevel = 1;

    public get canWatchHintAd(): boolean {
        return this._hintAdsUsed < this.hintAdsPerLevel;
    }

    public get canWatchAddTimeAd(): boolean {
        return this._addTimeAdsUsed < this.addTimeAdsPerLevel;
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
            resources.load(path, AudioClip, (error, clip) => {
                if (error) {
                    this._resultClips.delete(win);
                    reject(error);
                } else resolve(clip);
            });
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
            void this.startLevel(next.city, next.levelIndex, 'streak');
        } else if (this._currentCity) {
            void this.startLevel(this._currentCity, Math.max(0, this._currentCity.levelConfigs.findIndex(item => item.key === level.key)), 'streak');
        }
    }

    // ------------------------------------------------------------------
    // 平台能力
    // ------------------------------------------------------------------

    public async requestReward(placement: RewardPlacement, onReward: () => void): Promise<void> {
        if (this._isPaused && !this._isGameOver) return;
        this._isPaused = true;
        const result: RewardResult = this.platform.kind === 'h5'
            ? await this._showSimulatedAd()
            : await this.platform.showRewardedAd(placement);
        this._isPaused = this._isGameOver;
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
                const info = bundle.getInfoWithPath(path, SpriteFrame);
                if (!info) continue;
                await new Promise<void>((resolve, reject) => {
                    assetManager.preloadAny({ uuid: info.uuid, bundle: bundle.name }, { priority: -1, maxConcurrency: 1 },
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
        const bundle = path.startsWith('levels/') ? await this._loadCityBundle() : resources;
        return new Promise((resolve, reject) => {
            bundle.load(path, SpriteFrame, (error, frame) => {
                if (error) reject(error);
                else { frame.addRef(); resolve(frame); }
            });
        });
    }

    public loadSpriteFrame(path: string): Promise<SpriteFrame> {
        const cached = this._spriteFrameCache.get(path);
        if (cached && cached.isValid) return Promise.resolve(cached);
        // levels/ 前缀的关卡资源已移入 city Bundle，其余 UI 资源仍在主包 resources 中
        const source = path.startsWith('levels/')
            ? this._loadCityBundle()
            : Promise.resolve(resources);
        return source.then(bundle => this._loadSpriteFrom(bundle, path));
    }

    private _loadSpriteFrom(source: AssetManager.Bundle, path: string): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            source.load(path, SpriteFrame, (error, asset) => {
                if (error) {
                    // 部分资源（如 webp 单图）在 bundle 中仅登记 spriteFrame 子资源，自动补后缀重试
                    source.load(`${path}/spriteFrame`, SpriteFrame, (retryError, retryAsset) => {
                        if (retryError) {
                            reject(retryError);
                            return;
                        }
                        this._spriteFrameCache.set(path, retryAsset);
                        resolve(retryAsset);
                    });
                    return;
                }
                this._spriteFrameCache.set(path, asset);
                resolve(asset);
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

    private _showSimulatedAd(): Promise<RewardResult> {
        return new Promise(resolve => {
            this._closeOverlay();
            const parent = this.node.parent ?? this.node;
            const modal = new Node('SimulatedAd');
            modal.parent = parent;
            const modalUi = modal.addComponent(UITransform);
            modalUi.setContentSize(750, 1334);
            const modalGraphics = modal.addComponent(Graphics);
            modalGraphics.fillColor = new Color(4, 16, 34, 220);
            modalGraphics.rect(-375, -667, 750, 1334);
            modalGraphics.fill();
            this._overlay = modal;

            const card = new Node('AdCard');
            card.parent = modal;
            const cardUi = card.addComponent(UITransform);
            cardUi.setContentSize(610, 620);
            const cardGraphics = card.addComponent(Graphics);
            cardGraphics.fillColor = new Color(12, 43, 84, 255);
            cardGraphics.roundRect(-305, -310, 610, 620, 30);
            cardGraphics.fill();

            const addLabel = (name: string, text: string, y: number, fontSize: number, color: Color): Label => {
                const node = new Node(name);
                node.parent = card;
                node.setPosition(0, y);
                const nodeUi = node.addComponent(UITransform);
                nodeUi.setContentSize(520, fontSize * 1.6);
                const label = node.addComponent(Label);
                label.string = text;
                label.fontSize = fontSize;
                label.color = color;
                label.horizontalAlign = Label.HorizontalAlign.CENTER;
                label.verticalAlign = Label.VerticalAlign.CENTER;
                label.overflow = Label.Overflow.SHRINK;
                return label;
            };

            addLabel('AdTitle', '广告演示', 210, 46, Color.WHITE);
            addLabel('AdNote', 'H5 开发环境模拟激励视频', 145, 25, new Color(150, 178, 207, 255));
            const timerLabel = addLabel('AdTimer', '5', 20, 110, new Color(249, 177, 34, 255));
            const statusLabel = addLabel('AdStatus', '广告播放中，请稍候…', -90, 27, Color.WHITE);

            const makeButton = (name: string, text: string, x: number, callback: () => void): void => {
                const button = new Node(name);
                button.parent = card;
                button.setPosition(x, -205);
                const buttonUi = button.addComponent(UITransform);
                buttonUi.setContentSize(220, 74);
                const graphics = button.addComponent(Graphics);
                graphics.fillColor = new Color(42, 137, 225, 255);
                graphics.roundRect(-110, -37, 220, 74, 18);
                graphics.fill();
                const labelNode = new Node('Label');
                labelNode.parent = button;
                const labelUi = labelNode.addComponent(UITransform);
                labelUi.setContentSize(200, 64);
                const label = labelNode.addComponent(Label);
                label.string = text;
                label.fontSize = 27;
                label.color = Color.WHITE;
                label.horizontalAlign = Label.HorizontalAlign.CENTER;
                label.verticalAlign = Label.VerticalAlign.CENTER;
                label.overflow = Label.Overflow.SHRINK;
                button.on(Node.EventType.TOUCH_END, callback, this);
            };

            let seconds = 5;
            const tick = () => {
                seconds -= 1;
                timerLabel.string = String(Math.max(0, seconds));
                if (seconds > 0) return;
                this.unschedule(tick);
                statusLabel.string = '观看完成，可关闭或返回';
                let resolved = false;
                const finish = () => {
                    if (resolved) return;
                    resolved = true;
                    this._closeOverlay();
                    resolve({ success: true, completed: true, simulated: true });
                };
                makeButton('CloseAd', '关闭广告', -125, finish);
                makeButton('ReturnAd', '返回游戏', 125, finish);
            };
            this.schedule(tick, 1);
        });
    }

    private _closeOverlay(): void {
        this._overlay?.destroy();
        this._overlay = null;
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

            const cityIndexAsset = await this._loadBundleJson(cityBundle, 'levels/cities');
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
            let audioDone = 0;
            const musicPath = 'voice/BGmusic/Game_music01';
            const music = new Promise<void>((resolve, reject) => {
                resources.load(musicPath, AudioClip, (error, clip) => {
                    if (error) { reject(error); return; }
                    this._musicClips.set(musicPath, clip);
                    resolve();
                });
            });
            await Promise.all([music, ...[1, 2, 3, 4, 5].map(stage => this._loadComboClip(stage))].map(async task => {
                await task;
                report(0.75 + ++audioDone / 6 * 0.24);
            }));

            // v2 旧档迁移：按城市顺序展开全部关卡 key 供映射
            const allKeys: string[] = [];
            for (const city of this._cities) {
                for (const dir of city.levels) {
                    allKeys.push(`${city.key}/${dir}`);
                }
            }
            this.save.migrateLegacy(allKeys);

            if (!this.isValid) return;
            report(1);
            // 留出一帧显示100%，随后只在首次启动完成时关闭Loading。
            this.scheduleOnce(() => {
                if (this._loadingNode) this._loadingNode.active = false;
                this.showLobby();
            }, 0);
        } catch (error) {
            active = false;
            this._bootFailed = true;
            // 失败的音效Promise不能留在缓存中，否则重试仍会立即失败。
            this._comboClips.clear();
            console.error('[GameFlow] 资源加载失败', error);
            if (this._loadingLabel) this._loadingLabel.string = '加载失败，点击进度条重试';
            else this.toast('资源加载失败，请重新打开游戏');
        } finally {
            active = false;
            this._booting = false;
        }
    }

    private async _loadCityMeta(bundle: AssetManager.Bundle, key: string): Promise<CityConfig> {
        const asset = await this._loadBundleJson(bundle, `levels/${key}/city`);
        const meta = asset.json as { name?: string; banner?: string; levels?: string[] };
        return {
            key,
            name: meta.name ?? key,
            banner: meta.banner ?? '',
            levels: meta.levels ?? [],
            levelsLoaded: false,
            levelConfigs: [],
        };
    }

    /** 懒加载城市内全部关卡配置（幂等）。 */
    public async ensureCity(city: CityConfig): Promise<void> {
        if (city.levelsLoaded) return;
        const bundle = await this._loadCityBundle();
        const configs: LevelConfig[] = [];
        for (const dir of city.levels) {
            configs.push(await this._loadLevel(bundle, city.key, dir));
        }
        city.levelConfigs = configs;
        city.levelsLoaded = true;
    }

    private async _loadLevel(bundle: AssetManager.Bundle, cityKey: string, levelDir: string): Promise<LevelConfig> {
        const key = `${cityKey}/${levelDir}`;
        const asset = await this._loadBundleJson(bundle, `levels/${key}/differences`);
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
            icon: file.icon || (bundle.getInfoWithPath(`levels/${key}/icon/spriteFrame`, SpriteFrame)
                ? `levels/${key}/icon/spriteFrame` : topImage),
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

    /** 加载并缓存关卡资源所在 Bundle（assets/Bundle，bundleName: city）。 */
    private _loadCityBundle(): Promise<AssetManager.Bundle> {
        if (this._cityBundle) return Promise.resolve(this._cityBundle);
        return new Promise((resolve, reject) => {
            assetManager.loadBundle('city', (error: Error | null, bundle: AssetManager.Bundle) => {
                if (error || !bundle) {
                    reject(error ?? new Error('[GameFlow] city Bundle 加载失败'));
                    return;
                }
                this._cityBundle = bundle;
                resolve(bundle);
            });
        });
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
