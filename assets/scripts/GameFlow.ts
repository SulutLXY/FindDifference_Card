import { FoodTips } from './ui/FoodTips';
import {
    _decorator,
    assetManager,
    AssetManager,
    AudioClip,
    AudioSource,
    Color,
    Component,
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

    private _grades: GradeConfig = { maxLives: 3, timeTiers: [{ maxDifferences: 10, timeLimit: 150 }] };
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
    private _comboSource: AudioSource | null = null;
    private _clickSource: AudioSource | null = null;
    private _resultSource: AudioSource | null = null;
    private readonly _resultClips = new Map<boolean, Promise<AudioClip>>();
    private _resultSoundRequest = 0;
    private _musicVolumeBeforeResult: number | null = null;
    private readonly _comboClips = new Map<number, Promise<AudioClip>>();
    private _comboSoundRequest = 0;
    private readonly _spriteFrameCache = new Map<string, SpriteFrame>();
    /** 关卡资源所在 Asset Bundle（assets/Bundle，bundleName: city），首次使用时加载并缓存。 */
    private _cityBundle: AssetManager.Bundle | null = null;
    private _overlay: Node | null = null;
    private _musicSource: AudioSource | null = null;
    private _musicPath = '';
    private readonly _musicClips = new Map<string, AudioClip>();
    private _musicRequest = 0;
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
            touchPoint.playClickSound = () => this.playClickSound();
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
        if (this._isGameOver || this._isPaused || !this._currentLevel) return;
        if (!this.game || !this.game.node.active) return;
        this._remainingTime = Math.max(0, this._remainingTime - dt);
        this._elapsedTime += dt;
        this.game.refreshHud();
        if (this._remainingTime <= 0) this.finishLevel(false);
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
        return this._isPaused;
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
        this._playPageMusic(this.game?.node.active ? 'voice/BGmusic/Main_music01' : 'voice/BGmusic/Game_music01');
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

    public async startLevel(city: CityConfig, levelIndex: number): Promise<void> {
        try {
            await this.ensureCity(city);
        } catch (error) {
            console.error(`[GameFlow] 城市关卡加载失败: ${city.key}`, error);
            this.toast('关卡加载失败，请稍后重试');
            return;
        }
        const level = city.levelConfigs[levelIndex] ?? null;
        if (!level) return;

        this._currentCity = city;
        this._currentLevel = level;
        this._remainingTime = level.timeLimit;
        this._elapsedTime = 0;
        this._lives = level.maxLives;
        this._foundIds.clear();
        this._combo = 0;
        this._lastFoundAt = 0;
        this._isPaused = false;
        this._isGameOver = false;
        this._reviveUsed = false;
        this._assistRoundVersion++;
        this._hintAdsUsed = 0;
        this._addTimeAdsUsed = 0;
        this.resultModal?.close();
        this._switchTo(this.game);
        void this.game?.setupLevel(level);
    }

    private _switchTo(screen: LobbyScreen | CitySelectScreen | LevelSelectScreen | GameScreen | RankScreen | CollectScreen | null): void {
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
            this._playPageMusic(screen === this.game ? 'voice/BGmusic/Main_music01' : 'voice/BGmusic/Game_music01');
        } else {
            console.warn('[GameFlow] 目标界面未在场景中配置');
        }
    }

    /** 同类页面延续播放；异步加载完成后只允许当前页面的音乐开始播放。 */
    private _playPageMusic(path: string): void {
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
        resources.load(path, AudioClip, (error, clip) => {
            if (!this.isValid) return;
            if (error) {
                if (request === this._musicRequest) this._musicPath = '';
                console.warn(`[GameFlow] 背景音乐加载失败: ${path}`, error);
                return;
            }
            this._musicClips.set(path, clip);
            play(clip);
        });
    }

    protected onDestroy(): void {
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

        // 连击：窗口内连续找对升级，点错/超时清零
        const now = Date.now();
        this._combo = now - this._lastFoundAt <= GameFlow.COMBO_WINDOW_MS ? this._combo + 1 : 1;
        this._lastFoundAt = now;

        this.game?.drawFoundMarker(difference);
        this.game?.showSuccessFx(this._combo);
        this.playSuccessTone(this._combo);
        this.game?.refreshHud();
        if (this._foundIds.size >= this._currentLevel.differences.length) {
            this.finishLevel(true);
        }
    }

    public onWrongTap(localPosition: Vec3, imageNode: Node): void {
        if (this._isGameOver || this._isPaused) return;
        this._combo = 0;
        this._lives = Math.max(0, this._lives - 1);
        this.game?.drawWrongMarker(localPosition, imageNode);
        this.game?.refreshHud();
        if (this._lives <= 0) this.finishLevel(false);
    }

    private _loadComboClip(stage: number): Promise<AudioClip> {
        const cached = this._comboClips.get(stage);
        if (cached) return cached;
        const path = `voice/ComboSound/Combo _F_type01_01/voice_Combo _F_type01_${String(stage).padStart(2, '0')}`;
        const pending = new Promise<AudioClip>((resolve, reject) => {
            resources.load(path, AudioClip, (error, clip) => {
                if (error) {
                    this._comboClips.delete(stage);
                    reject(error);
                } else {
                    resolve(clip);
                }
            });
        });
        this._comboClips.set(stage, pending);
        return pending;
    }

    /** 每次按下独立播放，连续点击不会截断上一声或影响连击音效。 */
    public playClickSound(): void {
        if (!this.save.data.soundEnabled) return;
        void this._loadComboClip(0).then(clip => {
            const source = this._clickSource;
            if (!this.isValid || !this.enabledInHierarchy || !source?.isValid || !this.save.data.soundEnabled) return;
            source.playOneShot(clip);
        }).catch(error => console.warn('[GameFlow] 点击音效播放失败', error));
    }

    /** 连击音效逐级递增，超过现有五档后保持最高档。 */
    public playSuccessTone(combo: number): void {
        const request = ++this._comboSoundRequest;
        if (!this.save.data.soundEnabled) return;
        const stage = Math.max(1, Math.min(5, Math.floor(combo)));
        void this._loadComboClip(stage).then(clip => {
            const source = this._comboSource;
            if (!this.isValid || !source?.isValid || request !== this._comboSoundRequest) return;
            source.stop();
            source.clip = clip;
            source.play();
        }).catch(error => console.warn('[GameFlow] 连击音效播放失败', error));
    }

    public useHint(): void {
        if (this._isGameOver) return;
        const target = this._currentLevel?.differences.find(item => !this._foundIds.has(item.id));
        if (target) {
            this.onDifferenceFound(target);
            this.game?.refreshHud();
        }
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

    private _playResultTone(win: boolean): void {
        this._stopResultTone();
        this._comboSoundRequest++;
        this._comboSource?.stop();
        if (!this.save.data.soundEnabled) return;
        const request = this._resultSoundRequest;
        void this._loadResultClip(win).then(clip => {
            const source = this._resultSource;
            if (!this.isValid || !this.enabledInHierarchy || !source?.isValid
                || request !== this._resultSoundRequest || !this.save.data.soundEnabled) return;
            source.clip = clip;
            source.play();
        }).catch(error => console.warn('[GameFlow] 结算音效播放失败', error));
    }

    public finishLevel(win: boolean): void {
        if (this._isGameOver || !this._currentLevel) return;
        this._isGameOver = true;
        this._playResultTone(win);

        const level = this._currentLevel;
        let stars = 0;
        if (win) {
            const ratio = this._remainingTime / level.timeLimit;
            stars = ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1;
            this.save.completeLevel(level.key, stars, Math.max(1, Math.round(this._elapsedTime)));
            // 上报平台排行榜（抖音 setImRankData 等；非平台环境为空实现）
            this.rankProvider.submitScore(this.save.totalScore, stars, Math.max(1, Math.round(this._elapsedTime)));
        }

        this.resultModal?.present({
            win,
            stars,
            elapsedSeconds: Math.max(1, Math.round(this._elapsedTime)),
            level,
            canRevive: !win && !this._reviveUsed,
            hasNext: win && this.findNextLevel(level) !== null,
        });
        if (win && (level.type === 'food' || this._foods.some(food => food.levelKey === level.key))) this.showFoodTips(level, true);
        void this.platform.onRoundFinished(() => this.isValid && this._isGameOver && !this._isPaused
            && this._currentLevel === level && !!this.resultModal?.node.activeInHierarchy);
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
            void this.startLevel(next.city, next.levelIndex);
        } else if (this._currentCity) {
            void this.startLevel(this._currentCity, Math.max(0, this._currentCity.levelConfigs.findIndex(item => item.key === level.key)));
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

    /** 时限分档：差异数 ≤ maxDifferences 取该档，取第一个满足档。 */
    private _timeFor(differenceCount: number): number {
        for (const tier of this._grades.timeTiers) {
            if (differenceCount <= tier.maxDifferences) return tier.timeLimit;
        }
        const last = this._grades.timeTiers[this._grades.timeTiers.length - 1];
        return last ? last.timeLimit : 120;
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
