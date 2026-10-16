import { _decorator, Animation, AnimationClip, AssetManager, assetManager, Label, Node, Sprite, SpriteFrame } from 'cc';
import { UIScreen } from './UIScreen';
import { LobbyEntries } from './LobbyEntries';
import { FavoriteGift } from './FavoriteGift';
import { APP_VERSION } from '../core/AppVersion';

const { ccclass, property } = _decorator;

const HERO_BUNDLE = 'MainGameAimation';
const HERO_CLIP = 'N_Cat_01/An_MainGame_N_Cat_01';
const HERO_FRAME = 'N_Cat_01/N_Cat_01_ (1)/spriteFrame';

/**
 * 大厅界面（Screens/Lobby）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnStart   开始挑战按钮（Node，其下 currentLevel 单行显示关卡名）
 * - BtnLevels  选择关卡按钮（Node）
 * - BtnRank    排行榜按钮（Node，占位）
 * - BtnCollect 收藏按钮（Node）
 * - Title      游戏标题（Label，可选）
 * - Subtitle   副标题（Label，可选）
 * - FooterEnv  底部环境信息（Label，运行时刷新）
 */
@ccclass('LobbyScreen')
export class LobbyScreen extends UIScreen {
    @property({ type: Node, displayName: 'Setting', tooltip: '主页设置按钮，由场景设计并绑定' })
    public setting: Node | null = null;

    @property({ type: Node, tooltip: '开始挑战按钮（命名 BtnStart）' })
    public btnStart: Node | null = null;

    @property({ type: Node, tooltip: '选择关卡按钮（命名 BtnLevels）' })
    public btnLevels: Node | null = null;

    @property({ type: Node, tooltip: '排行榜按钮（命名 BtnRank，占位）' })
    public btnRank: Node | null = null;

    @property({ type: Node, tooltip: '收藏按钮（命名 BtnCollect）' })
    public btnCollect: Node | null = null;

    @property({ type: Label, tooltip: '当前关卡提示（BtnStart 下的 currentLevel，单行显示关卡名）' })
    public currentLevel: Label | null = null;

    @property({ type: Label, tooltip: '底部环境信息（命名 FooterEnv）' })
    public footerEnv: Label | null = null;

    private _heroAnimation: Animation | null = null;
    private _heroSprite: Sprite | null = null;
    private _heroAssets: { clip: AnimationClip; frame: SpriteFrame } | null = null;
    private _heroPending: Promise<void> | null = null;
    private _heroRequest = 0;

    protected onLoad(): void {
        const hero = this.node.getChildByName('bg_showIcon');
        this._heroAnimation = hero?.getComponent(Animation) ?? null;
        this._heroSprite = hero?.getComponent(Sprite) ?? null;
        if (this._heroAnimation) this._heroAnimation.playOnLoad = false;
        // 编辑器绑定的静态首帧在动画下载期间保持可见。
        if (this._heroSprite) this._heroSprite.enabled = !!this._heroSprite.spriteFrame;
        const entryHost = this.flow.node.parent ?? this.node;
        if (!entryHost.getComponent(LobbyEntries)) entryHost.addComponent(LobbyEntries);
        if (!entryHost.getComponent(FavoriteGift)) entryHost.addComponent(FavoriteGift);
        this.wireButton(this.setting, 'Setting', () => this.flow.showSettings(false));
        this.wireButton(this.btnStart, 'BtnStart', () => this.flow.startContinue());
        this.wireButton(this.btnLevels, 'BtnLevels', () => this.flow.showCitySelect());
        this.wireButton(this.btnRank, 'BtnRank', () => this.flow.showRank());
        // 场景按钮名为 Btncollect（小写 c），命名查找与实际节点保持一致
        this.wireButton(this.btnCollect, 'Btncollect', () => this.flow.showCollect());
    }

    protected onOpen(): void {
        const rankButton = this.resolveNode(this.btnRank, 'BtnRank');
        if (rankButton) rankButton.active = !this.flow.platform.isHarmony;
        void this._refreshRankVisibility();
        this.setLabel(this.footerEnv, 'FooterEnv', `当前环境：${this.flow.platform.kind.toUpperCase()}  |  版本号：${APP_VERSION}`);
        // 只显示开始挑战实际进入的关卡名。
        void this._refreshContinueLabel();
        void this._showHero();
    }

    protected onDisable(): void {
        ++this._heroRequest;
        if (this._heroAnimation?.isValid) this._heroAnimation.stop();
    }

    protected onDestroy(): void {
        ++this._heroRequest;
        if (this._heroAnimation?.isValid) {
            this._heroAnimation.stop();
            this._heroAnimation.defaultClip = null;
            this._heroAnimation.clips = [];
        }
        if (this._heroSprite?.isValid) this._heroSprite.spriteFrame = null;
        this._heroAssets?.clip.decRef();
        this._heroAssets?.frame.decRef();
        this._heroAssets = null;
    }

    /** 选关页提前加载，只准备资源，不激活主页或播放动画。 */
    public async preloadHero(): Promise<void> {
        try {
            await this._loadHeroAssets();
        } catch (error) {
            if (this.isValid) console.warn('[LobbyScreen] 首页动画预加载失败，打开时重试', error);
        }
    }

    /** 下载期间保留首帧；离开页面后的异步回调不能重新开始播放。 */
    private async _showHero(): Promise<void> {
        const animation = this._heroAnimation;
        const sprite = this._heroSprite;
        if (!animation || !sprite) return;
        const request = ++this._heroRequest;
        try {
            await this._loadHeroAssets();
            if (!this.isValid || request !== this._heroRequest || !this.enabledInHierarchy
                || !animation.isValid || !sprite.isValid || !this._heroAssets) return;
            const { clip, frame } = this._heroAssets;
            if (animation.defaultClip !== clip) {
                animation.clips = [clip];
                animation.defaultClip = clip;
            }
            sprite.spriteFrame = frame;
            sprite.enabled = true;
            animation.play(clip.name);
        } catch (error) {
            // 首页装饰加载失败不影响按钮使用；下一次打开首页重新尝试。
            if (this.isValid && request === this._heroRequest) {
                console.warn('[LobbyScreen] 首页动画加载失败', error);
            }
        }
    }

    /** 合并并发请求，持有资源引用直到界面销毁，返回首页时复用。 */
    private _loadHeroAssets(): Promise<void> {
        if (this._heroAssets) return Promise.resolve();
        if (this._heroPending) return this._heroPending;
        const pending = (async () => {
            const bundle = assetManager.getBundle(HERO_BUNDLE) ?? await new Promise<AssetManager.Bundle>((resolve, reject) => {
                assetManager.loadBundle(HERO_BUNDLE, (error, loaded) => {
                    if (error || !loaded) reject(error ?? new Error('首页动画资源包加载失败'));
                    else resolve(loaded);
                });
            });
            if (!this.isValid) return;
            const [clip, frame] = await Promise.all([
                new Promise<AnimationClip>((resolve, reject) => {
                    bundle.load(HERO_CLIP, AnimationClip, (error, loaded) => {
                        if (error || !loaded) reject(error ?? new Error('首页动画加载失败'));
                        else resolve(loaded);
                    });
                }),
                new Promise<SpriteFrame>((resolve, reject) => {
                    bundle.load(HERO_FRAME, SpriteFrame, (error, loaded) => {
                        if (error || !loaded) reject(error ?? new Error('首页动画首帧加载失败'));
                        else resolve(loaded);
                    });
                }),
            ]);
            if (!this.isValid) return;
            clip.addRef();
            frame.addRef();
            this._heroAssets = { clip, frame };
        })().finally(() => { this._heroPending = null; });
        this._heroPending = pending;
        return pending;
    }

    private async _refreshContinueLabel(): Promise<void> {
        const label = this.resolveLabel(this.currentLevel, 'BtnStart/currentLevel');
        if (!label) return;
        label.enableWrapText = false;
        label.overflow = Label.Overflow.SHRINK;
        try {
            const target = await this.flow.findContinueTarget();
            if (!this.isValid || !label.isValid) return;
            let name = target?.level.name ?? (this.flow.cities.length ? '全部通关，恭喜！' : '点击开始重试');
            if (target) {
                const prefix = `${target.city.name}-`;
                if (name.startsWith(prefix)) name = name.slice(prefix.length);
            }
            label.string = name.replace(/[\r\n]+/g, ' ').trim();
        } catch (error) {
            if (this.isValid && label.isValid) label.string = '点击开始重试';
            console.warn('[LobbyScreen] 当前关卡信息加载失败', error);
        }
    }

    private async _refreshRankVisibility(): Promise<void> {
        const harmony = await this.flow.platform.detectHarmony();
        if (!this.isValid) return;
        const button = this.resolveNode(this.btnRank, 'BtnRank');
        if (button) button.active = !harmony;
    }
}
