import {
    _decorator,
    Color,
    Component,
    Graphics,
    JsonAsset,
    Label,
    Node,
    ResolutionPolicy,
    SpriteFrame,
    UITransform,
    UIOpacity,
    Vec3,
    resources,
    tween,
    view,
} from 'cc';
import {
    CityConfig,
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
import { registerGameFlow } from './ui/UIScreen';
import { CitySelectScreen } from './ui/CitySelectScreen';
import { GameScreen } from './ui/GameScreen';
import { LevelSelectScreen } from './ui/LevelSelectScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { RankScreen } from './ui/RankScreen';
import { ResultModal } from './ui/ResultModal';

const { ccclass, property } = _decorator;

/**
 * 全局流程状态机：持有存档、平台服务、城市/关卡配置与对局状态，
 * 负责界面切换、倒计时、激励视频与结算。
 * 场景中唯一实例，界面组件通过 GameFlow.instance 访问。
 *
 * 关卡组织：levels/ 下按 city-* 目录分组，cities.json 为城市索引，
 * 每城 city.json 列关卡清单（tools/build-manifest.py 生成），
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

    @property({ type: ResultModal, tooltip: '结算弹窗组件（ResultModal）' })
    public resultModal: ResultModal | null = null;

    public readonly save = new SaveService();
    public readonly platform = new PlatformService();

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
    private _toneContext: { currentTime: number; destination: unknown; state?: string; resume?: () => void } | null = null;
    private readonly _spriteFrameCache = new Map<string, SpriteFrame>();
    private _overlay: Node | null = null;

    protected onLoad(): void {
        GameFlow._instance = this;
        registerGameFlow(this);
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.SHOW_ALL);
    }

    protected start(): void {
        void this._bootstrap();
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

    public showRank(): void {
        this._switchTo(this.rank);
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
        this._isPaused = false;
        this._isGameOver = false;
        this._reviveUsed = false;
        this.resultModal?.close();
        this._switchTo(this.game);
        void this.game?.setupLevel(level);
    }

    private _switchTo(screen: LobbyScreen | CitySelectScreen | LevelSelectScreen | GameScreen | RankScreen | null): void {
        // 任何界面切换都先关闭结算弹窗，避免弹窗残留在新界面上层
        this.resultModal?.close();
        for (const item of [this.lobby, this.citySelect, this.levelSelect, this.game, this.rank]) {
            if (item && item !== screen) item.close();
        }
        if (screen) {
            screen.open();
        } else {
            console.warn('[GameFlow] 目标界面未在场景中配置');
        }
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
    public static readonly COMBO_WINDOW_MS = 2000;

    public onDifferenceFound(difference: DifferenceConfig): void {
        if (this._isGameOver || !this._currentLevel || this._foundIds.has(difference.id)) return;
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

    /** 找对音效：程序合成双音和弦，连击越高音调越高。正式音效资源接入后替换此方法。 */
    public playSuccessTone(combo: number): void {
        try {
            if (!this._toneContext) {
                const host = globalThis as any;
                if (this.platform.kind === 'wechat' && host.wx?.createWebAudioContext) {
                    this._toneContext = host.wx.createWebAudioContext();
                } else if (typeof host.AudioContext === 'function') {
                    this._toneContext = new host.AudioContext();
                }
            }
            const ctx = this._toneContext as any;
            if (!ctx) return;
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                void ctx.resume();
            }
            const now = ctx.currentTime;
            const base = 523.25 * Math.pow(1.12, Math.min(combo - 1, 8));
            for (const [delay, ratio] of [[0, 1], [0.07, 1.25]] as Array<[number, number]>) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = base * ratio;
                gain.gain.setValueAtTime(0.15, now + delay);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.18);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + delay);
                osc.stop(now + delay + 0.2);
            }
        } catch {
            // 音频环境不可用时静默
        }
    }

    public useHint(): void {
        const target = this._currentLevel?.differences.find(item => !this._foundIds.has(item.id));
        if (target) this.onDifferenceFound(target);
    }

    public addTime(seconds: number): void {
        this._remainingTime += seconds;
        this.game?.refreshHud();
    }

    public finishLevel(win: boolean): void {
        if (this._isGameOver || !this._currentLevel) return;
        this._isGameOver = true;

        const level = this._currentLevel;
        let stars = 0;
        if (win) {
            const ratio = this._remainingTime / level.timeLimit;
            stars = ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1;
            this.save.completeLevel(level.key, stars, Math.max(1, Math.round(this._elapsedTime)));
        }

        this.resultModal?.present({
            win,
            stars,
            elapsedSeconds: Math.max(1, Math.round(this._elapsedTime)),
            level,
            canRevive: !win && !this._reviveUsed,
            hasNext: win && this.findNextLevel(level) !== null,
        });
    }

    public revive(): void {
        if (!this._isGameOver) return;
        this._reviveUsed = true;
        this._lives = 1;
        this._remainingTime = Math.max(this._remainingTime, 30);
        this._isGameOver = false;
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
        return new Promise((resolve, reject) => {
            resources.load(path, SpriteFrame, (error, asset) => {
                if (error) {
                    reject(error);
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
        try {
            const [gradesAsset, platformAsset, cityIndexAsset] = await Promise.all([
                this._loadJson('configs/levels'),
                this._loadJson('configs/platform-config'),
                this._loadJson('levels/cities'),
            ]);
            this._grades = gradesAsset.json as GradeConfig;
            this.platform.configure(platformAsset.json as PlatformConfig);

            const index = cityIndexAsset.json as CityIndex;
            this._cities = await Promise.all(index.cities.map(key => this._loadCityMeta(key)));

            // v2 旧档迁移：按城市顺序展开全部关卡 key 供映射
            const allKeys: string[] = [];
            for (const city of this._cities) {
                for (const dir of city.levels) {
                    allKeys.push(`${city.key}/${dir}`);
                }
            }
            this.save.migrateLegacy(allKeys);

            this.showLobby();
        } catch (error) {
            console.error('[GameFlow] 资源加载失败', error);
            this.toast('资源加载失败，请重新打开游戏');
        }
    }

    private async _loadCityMeta(key: string): Promise<CityConfig> {
        const asset = await this._loadJson(`levels/${key}/city`);
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
        const configs: LevelConfig[] = [];
        for (const dir of city.levels) {
            configs.push(await this._loadLevel(city.key, dir));
        }
        city.levelConfigs = configs;
        city.levelsLoaded = true;
    }

    private async _loadLevel(cityKey: string, levelDir: string): Promise<LevelConfig> {
        const key = `${cityKey}/${levelDir}`;
        const asset = await this._loadJson(`levels/${key}/differences`);
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

    private _loadJson(path: string): Promise<JsonAsset> {
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (error, asset) => (error ? reject(error) : resolve(asset)));
        });
    }
}
