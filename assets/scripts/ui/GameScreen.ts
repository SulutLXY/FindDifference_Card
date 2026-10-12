import {
    _decorator,
    Animation,
    AnimationClip,
    Color,
    EventTouch,
    Graphics,
    Input,
    Label,
    Layout,
    instantiate,
    Node,
    Size,
    Sprite,
    SpriteFrame,
    UITransform,
    UIOpacity,
    Vec2,
    Vec3,
    tween,
    Tween,
} from 'cc';
import { DifferenceConfig, LevelConfig } from '../core/GameTypes';
import { DifferenceController } from '../gameplay/DifferenceController';
import { ProgressView } from './ProgressView';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 对局界面（Screens/Game）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack       返回选关按钮（Node）
 * - BtnHint       提示按钮（Node）
 * - BtnAddTime    加时按钮（Node）
 * - BtnShare      分享按钮（Node）
 * - BtnZoom       图片放大/还原按钮（Node）
 * - TopImage      上图节点（需有 UITransform 决定显示尺寸，Sprite 可缺省自动补）
 * - BottomImage   下图节点（同上）
 * - LevelTitle    顶部「第N关」标题（Label）
 * - LevelName     关卡名标牌（Label）
 * - Lives         爱心容器（原 Label 隐藏），子节点 LivesItem 作为爱心模板
 * - Timer         倒计时（Label）
 * - Progress      差异进度（Label）
 * - ProgressNumber 已找到数量（Label，独立于圆点进度）
 *
 * 命中判定使用节点 UITransform 的实际显示尺寸与关卡配置中的
 * 0–1 归一化坐标，与美术拼接时的缩放无关。
 */
@ccclass('GameScreen')
export class GameScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回选关按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '提示按钮（命名 BtnHint）' })
    public btnHint: Node | null = null;

    @property({ type: Node, tooltip: '加时按钮（命名 BtnAddTime）' })
    public btnAddTime: Node | null = null;

    @property({ type: Node, tooltip: '图片放大/还原按钮（命名 BtnZoom）' })
    public btnZoom: Node | null = null;

    @property({ type: Node, tooltip: '上图节点（命名 TopImage，需 UITransform）' })
    public topImage: Node | null = null;

    @property({ type: Node, tooltip: '下图节点（命名 BottomImage，需 UITransform）' })
    public bottomImage: Node | null = null;

    @property({ type: Label, tooltip: '顶部关卡标题（命名 LevelTitle）' })
    public levelTitle: Label | null = null;

    @property({ type: Label, tooltip: '旧生命文本（保留绑定但隐藏，LivesItem 显示爱心）' })
    public livesLabel: Label | null = null;

    @property({ type: Label, tooltip: '倒计时（命名 Timer）' })
    public timerLabel: Label | null = null;

    @property({ type: Label, tooltip: '差异进度（命名 Progress）' })
    public progressLabel: Label | null = null;

    @property({ type: Label, tooltip: '已找到数量（命名 ProgressNumber，显示 已找到/总数）' })
    public foundCountLabel: Label | null = null;

    private _level: LevelConfig | null = null;
    private _reminderFound = 0;
    private _lastFoundElapsed = 0;
    private _hintReminder = false;
    private _timeReminder = false;

    protected update(): void {
        if (!this._level) return;
        const flow = this.flow;
        const found = flow.foundIds.size;
        if (found !== this._reminderFound) {
            this._reminderFound = found;
            this._lastFoundElapsed = flow.elapsedTime;
        }
        const playing = !flow.isPaused && !flow.isGameOver && !flow.platform.interstitialBusy;
        const hint = playing && flow.elapsedTime - this._lastFoundElapsed >= 20;
        const time = playing && flow.remainingTime < 30;
        if (hint !== this._hintReminder) {
            this._hintReminder = hint;
            this._setReminderAnimation(this.resolveNode(this.btnHint, 'BtnHint'), hint);
        }
        if (time !== this._timeReminder) {
            this._timeReminder = time;
            this._setReminderAnimation(this.resolveNode(this.btnAddTime, 'BtnAddTime'), time);
        }
    }

    private _setReminderAnimation(node: Node | null, play: boolean): void {
        const animation = node?.getComponent(Animation);
        const clip = animation?.clips[1];
        if (!animation || !clip) return;
        if (play) animation.play(clip.name);
        else {
            const state = animation.getState(clip.name);
            if (state) { state.stop(); state.time = 0; state.sample(); }
        }
    }
    private _lastLives: number | null = null;
    private _livesTween: Tween<Node> | null = null;
    private _livesNode: Node | null = null;
    private _livesBaseScale: Vec3 | null = null;
    private readonly _lifeItems: Node[] = [];

    private _refreshLifeItems(count: number): void {
        const legacy = this.livesLabel ?? this.findChildDeep(this.node, 'Lives')?.getComponent(Label);
        // LivesItem 位于旧文本节点下，只禁用 Label，不能隐藏整个父节点。
        if (legacy) legacy.enabled = false;
        if (!this._lifeItems.length) {
            const template = this.findChildDeep(this.node, 'LivesItem');
            if (!template?.parent) return;
            this._lifeItems.push(template);
            const layout = template.parent.getComponent(Layout) ?? template.parent.addComponent(Layout);
            layout.type = Layout.Type.HORIZONTAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
        }
        const template = this._lifeItems[0];
        while (this._lifeItems.length < count) {
            const item = instantiate(template);
            item.name = `LivesItem-${this._lifeItems.length + 1}`;
            item.parent = template.parent;
            this._lifeItems.push(item);
        }
        this._lifeItems.forEach((item, index) => { item.active = index < count; });
        template.parent?.getComponent(Layout)?.updateLayout();
    }

    private _resetLivesAnimation(): void {
        this._livesTween?.stop();
        this._livesTween = null;
        if (this._livesNode?.isValid && this._livesBaseScale) this._livesNode.setScale(this._livesBaseScale);
    }

    protected onDisable(): void {
        this.clearLevel();
        this._resetLivesAnimation();
        this._clearWrongMarkers();
    }
    private _progressConfigured = false;
    private _progressTotal = 0;
    private readonly _markers: Node[] = [];
    private readonly _wrongMarkers = new Set<Node>();
    private _wrongFrame: Promise<SpriteFrame> | null = null;

    private _loadWrongFrame(): Promise<SpriteFrame> {
        if (!this._wrongFrame) {
            this._wrongFrame = this.flow.loadSpriteFrame('textures/UI_Sprite/V3/icons/icon_Erro/spriteFrame')
                .catch(error => { this._wrongFrame = null; throw error; });
        }
        return this._wrongFrame;
    }
    private _setupToken = 0;
    private _levelFrames: SpriteFrame[] = [];

    public clearLevel(): void {
        this._hideComboTips();
        this._clearSuccessText();
        if (this._hintReminder) this._setReminderAnimation(this.resolveNode(this.btnHint, 'BtnHint'), false);
        if (this._timeReminder) this._setReminderAnimation(this.resolveNode(this.btnAddTime, 'BtnAddTime'), false);
        this._hintReminder = false;
        this._timeReminder = false;
        this._reminderFound = 0;
        this._lastFoundElapsed = 0;
        ++this._setupToken;
        this._level = null;
        this._resetGesture();
        this._ignoreTapUntilRelease = false;
        this._clearMarkers();
        this._clearWrongMarkers();
        for (const name of ['TopImage', 'BottomImage']) {
            const sprite = this._image(name)?.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = null;
        }
        for (const frame of this._levelFrames) frame.decRef();
        this._levelFrames = [];
    }
    private _zoomScale = 1;
    private _pinchStartDistance = 0;
    private _pinchStartScale = 1;
    private _gestureMoved = false;
    private _ignoreTapUntilRelease = false;
    private readonly _lastTouch = new Vec2();
    private readonly _touchStart = new Vec2();
    /** 触摸位移超过该 UI 像素值即视为滑动，不再触发点击判定。 */
    private static readonly TAP_SLOP = 12;

    protected onLoad(): void {
        this._comboBox = this.findChildDeep(this.node, 'ComboTipsBox');
        this._hideComboTips();
        void this._loadComboFrames().catch(error => console.warn('[GameScreen] 连击图片预加载失败', error));
        void this._loadWrongFrame().catch(error => console.warn('[GameScreen] 错误图标预加载失败', error));
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showSettings(true));
        this.wireButton(this.btnHint, 'BtnHint', () => {
            void this.flow.requestHint();
        });
        this.wireButton(this.btnAddTime, 'BtnAddTime', () => {
            void this.flow.requestAddTime();
        });
        this.wireButton(this.btnZoom, 'BtnZoom', () => this._toggleZoom());

        const top = this.resolveNode(this.topImage, 'TopImage');
        const bottom = this.resolveNode(this.bottomImage, 'BottomImage');
        this._bindImageInput(top);
        this._bindImageInput(bottom);
    }

    /** 进入关卡：设置图片与文字，清理旧标记。由 GameFlow.startLevel 调用。 */
    public async setupLevel(level: LevelConfig, progress: (value: number) => void = () => {}): Promise<void> {
        this.clearLevel();
        this._resetLivesAnimation();
        this._lastLives = null;
        this._level = level;
        const token = ++this._setupToken;
        this._clearMarkers();
        this._clearWrongMarkers();
        this._setZoom(1);
        this._progressConfigured = false;
        this._progressTotal = 0;

        this.setLabel(this.levelTitle, 'LevelTitle', level.name);
        this.refreshHud();

        const frames: SpriteFrame[] = [];
        try {
            for (const path of [level.topImage, level.bottomImage]) {
                frames.push(await this.flow.acquireLevelFrame(path));
                if (!this.isValid || token !== this._setupToken) throw new Error('关卡加载已取消');
                progress(frames.length / 2);
            }
            const [topFrame, bottomFrame] = frames;
            const top = this.resolveNode(this.topImage, 'TopImage');
            const bottom = this.resolveNode(this.bottomImage, 'BottomImage');
            this._applySpriteFrame(top, topFrame);
            this._applySpriteFrame(bottom, bottomFrame);
            this._levelFrames = frames;
        } catch (error) {
            for (const frame of frames) frame.decRef();
            console.error(`[GameScreen] 关卡图片加载失败: ${level.topImage} / ${level.bottomImage}`, error);
            throw error;
        }
        this.refreshHud();
    }

    /** 刷新顶部信息栏。由 GameFlow 在倒计时与状态变化时调用。 */
    public refreshHud(): void {
        const flow = this.flow;
        const unlimited = flow.unlimitedAssists;
        for (const [button, name, count, canWatchAd] of [
            [this.btnHint, 'BtnHint', flow.save.freeHints, flow.canWatchHintAd],
            [this.btnAddTime, 'BtnAddTime', flow.save.freeAddTimes, flow.canWatchAddTimeAd],
        ] as const) {
            const root = this.resolveNode(button, name);
            if (!root) continue;
            const tipsIcon = this.findChildDeep(root, 'icon_Tips01');
            const videoIcon = this.findChildDeep(root, 'icon_videoplay');
            if (tipsIcon) tipsIcon.active = unlimited || count > 0;
            if (videoIcon) videoIcon.active = !unlimited && count === 0 && canWatchAd;
            const sprite = root.getComponent(Sprite);
            if (sprite) sprite.grayscale = !unlimited && count === 0 && !canWatchAd;
            const timesNode = root ? this.findChildDeep(root, 'Times') : null;
            if (timesNode) timesNode.active = !unlimited && count > 0;
            const times = timesNode?.getComponent(Label) ?? timesNode?.getComponentInChildren(Label);
            if (times) times.string = !unlimited && count > 0 ? String(count) : '';
        }

        const timer = this.resolveLabel(this.timerLabel, 'Timer');
        if (timer) {
            const seconds = Math.max(0, Math.ceil(flow.remainingTime));
            const minutes = Math.floor(seconds / 60);
            const rem = seconds % 60;
            const remainder = rem < 10 ? `0${rem}` : String(rem);
            timer.string = `${minutes}:${remainder}`;
            timer.color = seconds <= 10 ? UIColors.red : new Color(65, 72, 95, 255);
        }

        const count = Number.isFinite(flow.lives) ? Math.max(0, Math.floor(flow.lives)) : 0;
        this._refreshLifeItems(count);
        const lives = this.resolveLabel(this.livesLabel, 'Lives');
        if (lives) {
            if (this._livesNode !== lives.node) {
                this._resetLivesAnimation();
                this._livesNode = lives.node;
                this._livesBaseScale = lives.node.scale.clone();
                this._lastLives = null;
            }
            if (this._lastLives !== null && this._lastLives !== count && this._livesBaseScale) {
                this._resetLivesAnimation();
                const base = this._livesBaseScale;
                this._livesTween = tween(lives.node)
                    .to(0.15, { scale: new Vec3(base.x * 1.5, base.y * 1.5, base.z) }, { easing: 'quadOut' })
                    .to(0.35, { scale: base.clone() }, { easing: 'quadInOut' })
                    .start();
            }
            this._lastLives = count;
        }

        const level = this._level;
        const total = level?.differences.length ?? 0;
        const found = flow.foundIds.size;

        // 数字计数和图片槽位同时刷新，不能被下方 ProgressView 分支提前返回跳过。
        const foundCount = this.resolveLabel(this.foundCountLabel, 'ProgressNumber');
        if (foundCount) foundCount.string = `${found}/${total}`;

        // 优先使用 ProgressView（图片槽位）：按差异点数实例化 Progress_BG，完成一个点亮一个 Progress_GET
        const progressView = this.resolveNode(null, 'Progress')?.getComponent(ProgressView);
        if (progressView) {
            if (!this._progressConfigured || this._progressTotal !== total) {
                progressView.configure(total);
                this._progressConfigured = true;
                this._progressTotal = total;
            }
            progressView.setFoundCount(found);
            return;
        }

        // 后备：文字进度
        const progress = this.resolveLabel(this.progressLabel, 'Progress');
        if (progress && level) {
            progress.string = `${'●'.repeat(found)}${'○'.repeat(total - found)}  ${found}/${total}`;
            progress.color = new Color(147, 100, 57, 255);
        }
    }

    /** 在上下两张图上同步绘制命中标记。 */
    public drawFoundMarker(difference: DifferenceConfig): void {
        for (const image of [this._image('TopImage'), this._image('BottomImage')]) {
            if (!image) continue;
            const size = this._imageSize(image);
            if (!size) continue;
            const position = DifferenceController.normalizedToLocal(difference, size.width, size.height);
            const marker = new Node(`FoundMarker-${difference.id}`);
            marker.setPosition(position.x, position.y);
            marker.parent = image;
            const graphics = marker.addComponent(Graphics);
            graphics.lineWidth = 7;
            graphics.strokeColor = UIColors.red;
            graphics.circle(0, 0, DifferenceController.radiusToLocal(difference, size.width, size.height));
            graphics.stroke();
            this._markers.push(marker);
        }
    }

    /**
     * 胜利定格表现：命中标记按差异 x 坐标从左到右，依次放大 1.25 倍再缩回（单个脉冲 0.5 秒）。
     * 多个标记波浪式错开启动，相邻间隔随差异数量自适应，保证整体不超过 2 秒；完成后回调。
     */
    public playVictoryWave(onComplete: () => void): void {
        const level = this._level;
        const differences = level ? level.differences.slice().sort((a, b) => a.x - b.x) : [];
        const count = differences.length;
        let started = false;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            onComplete();
        };
        if (count === 0) { finish(); return; }
        const pulse = 0.5;
        const interval = count > 1 ? Math.min(pulse, (2 - pulse) / (count - 1)) : 0;
        const half = pulse / 2;
        for (let i = 0; i < count; i++) {
            const last = i === count - 1;
            // 同一差异在上下两张图上的标记同步脉冲
            for (const image of [this._image('TopImage'), this._image('BottomImage')]) {
                const marker = image?.getChildByName(`FoundMarker-${differences[i].id}`);
                if (!marker) continue;
                started = true;
                tween(marker)
                    .delay(i * interval)
                    .to(half, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'quadOut' })
                    .to(half, { scale: Vec3.ONE }, { easing: 'quadInOut' })
                    .call(() => { if (last) finish(); })
                    .start();
            }
        }
        // 标记可能因界面状态缺失，一个都没播就直接完成，避免结算窗永不弹出
        if (!started) finish();
    }

    private _comboBox: Node | null = null;
    private _comboAnimation: Animation | null = null;
    private _comboRequest = 0;
    private _comboFrames: Promise<SpriteFrame[]> | null = null;
    private _comboPending = false;
    private _successText: Node | null = null;
    private static readonly SUCCESS_TEXTS = [
        ['Good', '不错！', '答对了！'],
        ['有一手~', 'Great', '漂亮！', '好眼力~'],
        ['夯爆了', '这波很顶', '牛来！', '狠狠拿捏', '直接拉满！', '绝绝子~'],
    ];
    private static readonly SUCCESS_SIZES = [28, 32, 36];
    private static readonly SUCCESS_COLORS = ['ff9800', 'ff348a', 'ff0404', '2ebf01', '6c5df8', 'f358f9'];

    private _clearSuccessText(): void {
        const node = this._successText;
        this._successText = null;
        if (!node?.isValid) return;
        Tween.stopAllByTarget(node);
        const opacity = node.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
        node.active = false;
        node.destroy();
    }

    private _successTextPosition(difference: DifferenceConfig | undefined, imageNode: Node | undefined,
        width: number, height: number, angle: number): Vec3 {
        if (!difference) return new Vec3(0, 150, 0);
        const image = imageNode ?? this._image('TopImage');
        const imageUi = image?.getComponent(UITransform);
        const gameUi = this.node.getComponent(UITransform);
        const size = image && this._imageSize(image);
        if (!imageUi || !gameUi || !size) return new Vec3(0, 150, 0);
        const point = DifferenceController.normalizedToLocal(difference, size.width, size.height);
        const center = gameUi.convertToNodeSpaceAR(imageUi.convertToWorldSpaceAR(new Vec3(point.x, point.y, 0)));
        const radius = DifferenceController.radiusToLocal(difference, size.width, size.height);
        const edge = gameUi.convertToNodeSpaceAR(imageUi.convertToWorldSpaceAR(new Vec3(point.x, point.y + radius, 0)));
        const bottomLeft = gameUi.convertToNodeSpaceAR(imageUi.convertToWorldSpaceAR(new Vec3(-size.width / 2, -size.height / 2, 0)));
        const topRight = gameUi.convertToNodeSpaceAR(imageUi.convertToWorldSpaceAR(new Vec3(size.width / 2, size.height / 2, 0)));
        // 预留随机旋转、回弹放大和最后上浮的空间，避免边缘差异的文字超出图片。
        const radians = Math.abs(angle) * Math.PI / 180;
        const halfWidth = (width * Math.cos(radians) + height * Math.sin(radians)) * 0.55;
        const halfHeight = (height * Math.cos(radians) + width * Math.sin(radians)) * 0.55;
        const left = bottomLeft.x + halfWidth + 8, right = topRight.x - halfWidth - 8;
        const bottom = bottomLeft.y + halfHeight + 8, top = topRight.y - halfHeight - 53;
        const gap = Math.abs(edge.y - center.y) + halfHeight + 12;
        const y = center.y + gap <= top ? center.y + gap : center.y - gap;
        return new Vec3(left <= right ? Math.max(left, Math.min(right, center.x)) : (bottomLeft.x + topRight.x) / 2,
            bottom <= top ? Math.max(bottom, Math.min(top, y)) : (bottomLeft.y + topRight.y) / 2, 0);
    }

    private _showSuccessText(combo: number, difference?: DifferenceConfig, imageNode?: Node): void {
        this._clearSuccessText();
        const node = new Node('SuccessFx');
        this._successText = node;
        node.layer = this.node.layer;
        node.parent = this.node;
        node.addComponent(UITransform).setContentSize(620, 80);
        const label = node.addComponent(Label);
        const tier = Math.max(0, Math.min(combo, GameScreen.SUCCESS_TEXTS.length) - 1);
        const texts = GameScreen.SUCCESS_TEXTS[tier];
        label.string = texts[Math.floor(Math.random() * texts.length)] + (combo > 1 ? `  x${combo}` : '');
        label.fontSize = GameScreen.SUCCESS_SIZES[Math.floor(Math.random() * GameScreen.SUCCESS_SIZES.length)];
        label.lineHeight = label.fontSize + 4;
        label.isBold = true;
        label.color = new Color().fromHEX(GameScreen.SUCCESS_COLORS[Math.floor(Math.random() * GameScreen.SUCCESS_COLORS.length)]);
        label.enableOutline = true;
        label.outlineColor = Color.WHITE;
        label.outlineWidth = 2;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.NONE;
        label.enableWrapText = false;
        label.updateRenderData(true);
        const angle = Math.random() * 30 - 15;
        const textUi = node.getComponent(UITransform)!;
        node.setPosition(this._successTextPosition(difference, imageNode, textUi.width, textUi.height, angle));
        node.setRotationFromEuler(0, 0, angle);
        const opacity = node.addComponent(UIOpacity);
        node.setScale(0.7, 0.7, 1);
        tween(node).to(0.12, { scale: new Vec3(1.1, 1.1, 1) })
            .to(0.08, { scale: Vec3.ONE }).delay(0.35)
            .by(0.45, { position: new Vec3(0, 45, 0) }).start();
        tween(opacity).delay(0.55).to(0.45, { opacity: 0 }).call(() => {
            if (this._successText === node) this._clearSuccessText();
        }).start();
    }

    private _loadComboFrames(): Promise<SpriteFrame[]> {
        if (!this._comboFrames) {
            this._comboFrames = Promise.all([1, 2, 3].map(index =>
                this.flow.loadGameSpriteFrame(`Texture/UI_Sprite/Game/icon_ComboTips0${index}/spriteFrame`)))
                .catch(error => { this._comboFrames = null; throw error; });
        }
        return this._comboFrames;
    }

    private _hideComboTips(): void {
        ++this._comboRequest;
        this._comboPending = false;
        this.unschedule(this._hideComboTips);
        this._comboAnimation?.stop();
        if (this._comboBox?.isValid) this._comboBox.active = false;
    }

    /** 第五连击起，沿用场景位置，随机图片、单次动画及正负十度旋转。 */
    public showSuccessFx(combo: number, difference?: DifferenceConfig, imageNode?: Node): void {
        // 新命中不延长已弹出的大提示，保证每次只显示一秒。
        if (this._comboPending || this._comboBox?.active) return;
        if (combo < 5) { this._showSuccessText(combo, difference, imageNode); return; }
        const box = this.findChildDeep(this.node, 'ComboTipsBox');
        const tips = box && this.findChildDeep(box, 'ComboTips');
        const sprite = tips?.getComponent(Sprite);
        const animation = tips?.getComponent(Animation);
        if (!box || !sprite || !animation) { this._showSuccessText(combo, difference, imageNode); return; }
        this._hideComboTips();
        this._comboBox = box;
        this._comboAnimation = animation;
        const request = this._comboRequest;
        const clips = animation.clips.filter((clip): clip is AnimationClip => !!clip);
        if (!clips.length) { this._showSuccessText(combo, difference, imageNode); return; }
        this._comboPending = true;
        void this._loadComboFrames().then(frames => {
            if (!this.isValid || request !== this._comboRequest || !this.node.activeInHierarchy
                || !box.isValid || !sprite.isValid || !animation.isValid) return;
            sprite.spriteFrame = frames[Math.floor(Math.random() * frames.length)];
            this._clearSuccessText();
            this._comboPending = false;
            box.setRotationFromEuler(0, 0, Math.random() * 20 - 10);
            animation.playOnLoad = false;
            box.active = true;
            const clip = clips[Math.floor(Math.random() * clips.length)];
            animation.play(clip.name);
            const state = animation.getState(clip.name);
            if (state) { state.wrapMode = AnimationClip.WrapMode.Normal; state.repeatCount = 1; }
            this.scheduleOnce(this._hideComboTips, 1);
        }).catch(error => {
            if (request === this._comboRequest) {
                this._comboPending = false;
                if (this.isValid && this.node.activeInHierarchy) this._showSuccessText(combo, difference, imageNode);
            }
            console.warn('[GameScreen] 连击图片加载失败', error);
        });
    }

    /** 80×80错误图标：弹出、左右抖动、淡出；缩放图片时保持图标尺寸。 */
    public drawWrongMarker(localPosition: Vec3, imageNode: Node): void {
        const marker = new Node('WrongMarker');
        marker.setPosition(localPosition);
        marker.parent = imageNode;
        marker.layer = imageNode.layer;
        marker.addComponent(UITransform).setContentSize(80, 80);
        const sprite = marker.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const opacity = marker.addComponent(UIOpacity);
        this._wrongMarkers.add(marker);
        void this._loadWrongFrame().then(frame => {
            if (!marker.isValid || !this._wrongMarkers.has(marker) || !this.node.activeInHierarchy) return;
            sprite.spriteFrame = frame;
            const scale = 1 / Math.max(0.01, imageNode.scale.x);
            marker.setScale(scale * 0.7, scale * 0.7, 1);
            tween(marker)
                .to(0.1, { scale: new Vec3(scale, scale, 1) }, { easing: 'backOut' })
                .to(0.05, { angle: -12 })
                .to(0.05, { angle: 12 })
                .to(0.05, { angle: -8 })
                .to(0.05, { angle: 8 })
                .to(0.05, { angle: 0 })
                .start();
            tween(opacity).delay(0.45).to(0.25, { opacity: 0 }).call(() => {
                Tween.stopAllByTarget(marker);
                this._wrongMarkers.delete(marker);
                marker.destroy();
            }).start();
        }).catch(error => {
            this._wrongMarkers.delete(marker);
            if (marker.isValid) marker.destroy();
            console.warn('[GameScreen] 错误图标加载失败', error);
        });
    }

    private _clearWrongMarkers(): void {
        for (const marker of this._wrongMarkers) {
            if (!marker.isValid) continue;
            Tween.stopAllByTarget(marker);
            const opacity = marker.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            marker.destroy();
        }
        this._wrongMarkers.clear();
    }

    /** 图片手势由命中判定播放音效，跳过全局按下音效。 */
    public isImageTouchTarget(target: Node | null): boolean {
        if (!this.node.activeInHierarchy) return false;
        for (let node = target; node; node = node.parent) {
            if (node === this.topImage || node === this.bottomImage) return true;
        }
        return false;
    }

    private _onImageTouch(event: EventTouch, imageNode: Node): void {
        const level = this._level;
        if (!level || this.flow.isGameOver || this.flow.isPaused) return;
        const ui = imageNode.getComponent(UITransform);
        const size = this._imageSize(imageNode);
        if (!ui || !size) return;

        const uiLocation = event.getUILocation();
        const local = ui.convertToNodeSpaceAR(new Vec3(uiLocation.x, uiLocation.y, 0));
        const normalized = DifferenceController.localToNormalized(local, size.width, size.height);
        const hit = DifferenceController.hitTest(normalized, level.differences, this.flow.foundIds, size.width, size.height);
        if (hit) {
            this.flow.onDifferenceFound(hit, imageNode);
            return;
        }
        // 重复点击已找到的位置：静默忽略，不扣生命
        const alreadyFound = DifferenceController.hitTest(normalized, level.differences, this.flow.foundIds, size.width, size.height, true);
        if (!alreadyFound) {
            this.flow.onWrongTap(local, imageNode);
        }
    }

    private _bindImageInput(imageNode: Node | null): void {
        if (!imageNode) return;
        imageNode.on(Input.EventType.TOUCH_START, (event: EventTouch) => this._onGestureStart(event), this);
        imageNode.on(Input.EventType.TOUCH_MOVE, (event: EventTouch) => this._onGestureMove(event), this);
        imageNode.on(Input.EventType.TOUCH_END, (event: EventTouch) => this._onGestureEnd(event, imageNode), this);
        imageNode.on(Input.EventType.TOUCH_CANCEL, () => this._resetGesture(), this);
    }

    private _onGestureStart(event: EventTouch): void {
        const touches = event.getAllTouches();
        this._gestureMoved = false;
        if (touches.length >= 2) {
            this._pinchStartDistance = this._touchDistance(touches[0].getUILocation(), touches[1].getUILocation());
            this._pinchStartScale = this._zoomScale;
            return;
        }
        const location = event.getUILocation();
        this._lastTouch.set(location.x, location.y);
        this._touchStart.set(location.x, location.y);
    }

    private _onGestureMove(event: EventTouch): void {
        const touches = event.getAllTouches();
        if (touches.length >= 2) {
            const distance = this._touchDistance(touches[0].getUILocation(), touches[1].getUILocation());
            if (this._pinchStartDistance > 0) {
                this._setZoom(this._pinchStartScale * distance / this._pinchStartDistance);
                this._gestureMoved = true;
                this._ignoreTapUntilRelease = true;
            }
            return;
        }

        const location = event.getUILocation();
        const dx = location.x - this._lastTouch.x;
        const dy = location.y - this._lastTouch.y;
        this._lastTouch.set(location.x, location.y);
        // 从按下点起累计位移超阈值即视为滑动，即使未缩放也不触发点击
        const totalDx = location.x - this._touchStart.x;
        const totalDy = location.y - this._touchStart.y;
        if (totalDx * totalDx + totalDy * totalDy >= GameScreen.TAP_SLOP * GameScreen.TAP_SLOP) {
            this._gestureMoved = true;
        }
        if (this._zoomScale <= 1 || dx * dx + dy * dy < 1) return;

        const top = this._image('TopImage');
        const current = top?.position ?? Vec3.ZERO;
        // 屏幕像素位移换算成本地设计单位，保证不同窗口尺寸下拖动跟手
        const local = this._screenDeltaToLocal(new Vec2(dx, dy));
        this._setPan(current.x + local.x, current.y + local.y);
        this._gestureMoved = true;
        this._ignoreTapUntilRelease = true;
    }

    /** 把屏幕（UI）坐标系下的位移换算到本节点本地坐标系，除以画布实际缩放。 */
    private _screenDeltaToLocal(delta: Vec2): Vec2 {
        const ui = this.node.getComponent(UITransform);
        if (!ui) return delta;
        const origin = ui.convertToNodeSpaceAR(new Vec3(0, 0, 0));
        const moved = ui.convertToNodeSpaceAR(new Vec3(delta.x, delta.y, 0));
        return new Vec2(moved.x - origin.x, moved.y - origin.y);
    }

    private _onGestureEnd(event: EventTouch, imageNode: Node): void {
        const suppressTap = this._gestureMoved || this._ignoreTapUntilRelease;
        const remainingTouches = event.getAllTouches().length;
        this._resetGesture();
        if (suppressTap) {
            if (remainingTouches === 0) this._ignoreTapUntilRelease = false;
            return;
        }
        this._onImageTouch(event, imageNode);
    }

    private _resetGesture(): void {
        this._pinchStartDistance = 0;
        this._pinchStartScale = this._zoomScale;
        this._gestureMoved = false;
    }

    private _toggleZoom(): void {
        this._setZoom(this._zoomScale > 1 ? 1 : 1.8);
        this.flow.playZoomSound();
    }

    private _setZoom(value: number): void {
        this._zoomScale = Math.max(1, Math.min(2.5, value));
        for (const image of [this._image('TopImage'), this._image('BottomImage')]) {
            image?.setScale(this._zoomScale, this._zoomScale, 1);
        }
        const top = this._image('TopImage');
        const current = top?.position ?? Vec3.ZERO;
        this._setPan(current.x, current.y);

        const zoomButton = this.resolveNode(this.btnZoom, 'BtnZoom');
        const label = zoomButton?.getComponentInChildren(Label);
        if (label) label.string = this._zoomScale > 1 ? '还原' : '放大';
    }

    private _setPan(x: number, y: number): void {
        const image = this._image('TopImage');
        const size = image ? this._imageSize(image) : null;
        if (!size || this._zoomScale <= 1) {
            x = 0;
            y = 0;
        } else {
            const maxX = size.width * (this._zoomScale - 1) * 0.5;
            const maxY = size.height * (this._zoomScale - 1) * 0.5;
            x = Math.max(-maxX, Math.min(maxX, x));
            y = Math.max(-maxY, Math.min(maxY, y));
        }
        for (const target of [this._image('TopImage'), this._image('BottomImage')]) {
            target?.setPosition(x, y, 0);
        }
    }

    private _touchDistance(a: Vec2, b: Vec2): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private _applySpriteFrame(node: Node | null, frame: SpriteFrame): void {
        if (!node) return;
        let sprite = node.getComponent(Sprite);
        if (!sprite) sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
    }

    private _image(path: string): Node | null {
        if (path === 'TopImage' && this.topImage && this.topImage.isValid) return this.topImage;
        if (path === 'BottomImage' && this.bottomImage && this.bottomImage.isValid) return this.bottomImage;
        return this.resolveNode(null, path);
    }

    public tutorialControl(kind: 'zoom' | 'hint' | 'time' | 'lives' | 'add-time'): { node: Node; local: Vec3; radius: number } | null {
        const node = kind === 'zoom' ? this.resolveNode(this.btnZoom, 'BtnZoom')
            : kind === 'hint' ? this.resolveNode(this.btnHint, 'BtnHint')
            : kind === 'add-time' ? this.resolveNode(this.btnAddTime, 'BtnAddTime')
            : kind === 'time' ? this.resolveLabel(this.timerLabel, 'Timer')?.node
            : this.resolveLabel(this.livesLabel, 'Lives')?.node;
        const ui = node?.getComponent(UITransform);
        if (!node || !ui) return null;
        return { node, local: new Vec3((0.5-ui.anchorX)*ui.width, (0.5-ui.anchorY)*ui.height), radius: Math.max(36, Math.hypot(ui.width, ui.height)/2 + 8) };
    }

    public tutorialZoom(): void { this._toggleZoom(); }

    public tutorialResetZoom(): void { this._setZoom(1); }

    public tutorialTarget(difference: DifferenceConfig): { node: Node; local: Vec3; radius: number } | null {
        const node = this._image('TopImage');
        const size = node && this._imageSize(node);
        if (!node || !size) return null;
        const point = DifferenceController.normalizedToLocal(difference, size.width, size.height);
        return { node, local: new Vec3(point.x, point.y), radius: DifferenceController.radiusToLocal(difference, size.width, size.height) };
    }

    private _imageSize(node: Node): Size | null {
        return node.getComponent(UITransform)?.contentSize ?? null;
    }

    private _clearMarkers(): void {
        for (const marker of this._markers) marker.destroy();
        this._markers.length = 0;
    }
}
