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
    DifferenceCollection,
    DifferenceConfig,
    LevelCollection,
    LevelConfig,
    LevelMeta,
    PlatformConfig,
    RewardPlacement,
    RewardResult,
} from './core/GameTypes';
import { PlatformService } from './services/PlatformService';
import { SaveService } from './services/SaveService';
import { registerGameFlow } from './ui/UIScreen';
import { GameScreen } from './ui/GameScreen';
import { LevelSelectScreen } from './ui/LevelSelectScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { ResultModal } from './ui/ResultModal';
import { RankScreen } from './ui/RankScreen';

const { ccclass, property } = _decorator;

/**
 * 全局流程状态机：持有存档、平台服务、关卡配置与对局状态，
 * 负责界面切换、倒计时、激励视频与结算。
 * 场景中唯一实例，界面组件通过 GameFlow.instance 访问。
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

    private _levels: LevelConfig[] = [];
    private _currentLevel: LevelConfig | null = null;
    private _remainingTime = 0;
    private _elapsedTime = 0;
    private _lives = 0;
    private readonly _foundIds = new Set<string>();
    private _isPaused = false;
    private _isGameOver = false;
    private _reviveUsed = false;
    private readonly _spriteFrameCache = new Map<string, SpriteFrame>();

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

    public get levels(): readonly LevelConfig[] {
        return this._levels;
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

    public findLevel(id: number): LevelConfig | null {
        return this._levels.find(item => item.id === id) ?? null;
    }

    // ------------------------------------------------------------------
    // 界面切换
    // ------------------------------------------------------------------

    public showLobby(): void {
        this.resultModal?.close();
        this._switchTo(this.lobby);
    }

    public showLevelSelect(): void {
        this.resultModal?.close();
        this._switchTo(this.levelSelect);
    }

    public showRank(): void {
        this._switchTo(this.rank);
    }

    public startContinue(): void {
        const continueId = Math.min(this.save.data.unlockedLevel, this._levels.length);
        const level = this.findLevel(continueId) ?? this._levels[0];
        if (level) this.startLevel(level);
    }

    public startLevel(level: LevelConfig): void {
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

    private _switchTo(screen: LobbyScreen | LevelSelectScreen | GameScreen | RankScreen | null): void {
        for (const item of [this.lobby, this.levelSelect, this.game, this.rank]) {
            if (item && item !== screen) item.close();
        }
        if (screen) {
            screen.open();
        } else {
            console.warn('[GameFlow] 目标界面未在场景中配置');
        }
    }

    // ------------------------------------------------------------------
    // 对局逻辑
    // ------------------------------------------------------------------

    public onDifferenceFound(difference: DifferenceConfig): void {
        if (this._isGameOver || !this._currentLevel || this._foundIds.has(difference.id)) return;
        this._foundIds.add(difference.id);
        this.game?.drawFoundMarker(difference);
        this.game?.refreshHud();
        if (this._foundIds.size >= this._currentLevel.differences.length) {
            this.finishLevel(true);
        }
    }

    public onWrongTap(localPosition: Vec3, imageNode: Node): void {
        if (this._isGameOver || this._isPaused) return;
        this._lives = Math.max(0, this._lives - 1);
        this.game?.drawWrongMarker(localPosition, imageNode);
        this.game?.refreshHud();
        if (this._lives <= 0) this.finishLevel(false);
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
            this.save.completeLevel(level.id, stars, Math.max(1, Math.round(this._elapsedTime)));
        }

        this.resultModal?.present({
            win,
            stars,
            elapsedSeconds: Math.max(1, Math.round(this._elapsedTime)),
            level,
            canRevive: !win && !this._reviveUsed,
            hasNext: level.id < this._levels.length,
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
        const next = win && level.id < this._levels.length ? this.findLevel(level.id + 1) : null;
        this.resultModal?.close();
        this.startLevel(next ?? level);
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

    public share(levelId?: number): void {
        this.platform.share(levelId ?? this._currentLevel?.id ?? 1);
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
    // 运行时动态元素（Toast / 模拟广告 / 致命错误遮罩）
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
            const modal = this.node.parent?.getChildByName('AdModal');
            const card = modal?.getChildByName('AdCard');
            const timerLabel = card?.getChildByName('AdTimer')?.getComponent(Label);
            const statusLabel = card?.getChildByName('AdStatus')?.getComponent(Label);
            const closeButton = card?.getChildByName('CloseAd');
            const returnButton = card?.getChildByName('ReturnAd');
            if (!modal || !timerLabel || !statusLabel || !closeButton || !returnButton) {
                resolve({ success: false, completed: false, simulated: true, reason: '广告弹窗节点缺失' });
                return;
            }
            modal.active = true;
            closeButton.active = false;
            returnButton.active = false;
            let seconds = 5;
            timerLabel.string = '5';
            statusLabel.string = '广告播放中，请稍候…';
            const tick = () => {
                seconds -= 1;
                timerLabel.string = String(Math.max(0, seconds));
                if (seconds > 0) return;
                this.unschedule(tick);
                statusLabel.string = '观看完成，可关闭或返回';
                closeButton.active = true;
                returnButton.active = true;
                let resolved = false;
                const finish = () => {
                    if (resolved) return;
                    resolved = true;
                    closeButton.off(Node.EventType.TOUCH_END, finish, this);
                    returnButton.off(Node.EventType.TOUCH_END, finish, this);
                    modal.active = false;
                    resolve({ success: true, completed: true, simulated: true });
                };
                closeButton.on(Node.EventType.TOUCH_END, finish, this);
                returnButton.on(Node.EventType.TOUCH_END, finish, this);
            };
            this.schedule(tick, 1);
        });
    }

    // ------------------------------------------------------------------

    private async _bootstrap(): Promise<void> {
        try {
            const [levelsAsset, platformAsset] = await Promise.all([
                this._loadJson('configs/levels'),
                this._loadJson('configs/platform-config'),
            ]);
            this.platform.configure(platformAsset.json as PlatformConfig);
            const metas = (levelsAsset.json as LevelCollection).levels;
            this._levels = [];
            for (const meta of metas) {
                this._levels.push(await this._loadLevel(meta));
            }
            this.showLobby();
        } catch (error) {
            console.error('[GameFlow] 资源加载失败', error);
            this.toast('资源加载失败，请重新打开游戏');
        }
    }

    /** 组装关卡：差异点从关卡目录内的 differences.json 读取，图片路径按目录约定推导。 */
    private async _loadLevel(meta: LevelMeta): Promise<LevelConfig> {
        const diffAsset = await this._loadJson(`${meta.directory}/differences`);
        const differences = (diffAsset.json as DifferenceCollection).differences;
        return {
            id: meta.id,
            name: meta.name,
            timeLimit: meta.timeLimit,
            maxLives: meta.maxLives,
            bundle: '',
            topImage: `${meta.directory}/scene-a/spriteFrame`,
            bottomImage: `${meta.directory}/scene-b/spriteFrame`,
            differences,
            thumbnail: meta.thumbnail ?? '',
        };
    }

    private _loadJson(path: string): Promise<JsonAsset> {
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (error, asset) => (error ? reject(error) : resolve(asset)));
        });
    }
}
