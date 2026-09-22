import {
    _decorator,
    Color,
    EventTouch,
    Graphics,
    Input,
    Label,
    Node,
    Size,
    Sprite,
    SpriteFrame,
    UITransform,
    UIOpacity,
    Vec2,
    Vec3,
    tween,
} from 'cc';
import { DifferenceConfig, LevelConfig } from '../core/GameTypes';
import { DifferenceController } from '../gameplay/DifferenceController';
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
 * - Lives         生命显示（Label）
 * - Timer         倒计时（Label）
 * - Progress      差异进度（Label）
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

    @property({ type: Node, tooltip: '分享按钮（命名 BtnShare）' })
    public btnShare: Node | null = null;

    @property({ type: Node, tooltip: '图片放大/还原按钮（命名 BtnZoom）' })
    public btnZoom: Node | null = null;

    @property({ type: Node, tooltip: '上图节点（命名 TopImage，需 UITransform）' })
    public topImage: Node | null = null;

    @property({ type: Node, tooltip: '下图节点（命名 BottomImage，需 UITransform）' })
    public bottomImage: Node | null = null;

    @property({ type: Label, tooltip: '顶部关卡标题（命名 LevelTitle）' })
    public levelTitle: Label | null = null;

    @property({ type: Label, tooltip: '关卡名标牌（命名 LevelName）' })
    public levelName: Label | null = null;

    @property({ type: Label, tooltip: '生命显示（命名 Lives）' })
    public livesLabel: Label | null = null;

    @property({ type: Label, tooltip: '倒计时（命名 Timer）' })
    public timerLabel: Label | null = null;

    @property({ type: Label, tooltip: '差异进度（命名 Progress）' })
    public progressLabel: Label | null = null;

    private _level: LevelConfig | null = null;
    private readonly _markers: Node[] = [];
    private _setupToken = 0;
    private _zoomScale = 1;
    private _pinchStartDistance = 0;
    private _pinchStartScale = 1;
    private _gestureMoved = false;
    private _ignoreTapUntilRelease = false;
    private readonly _lastTouch = new Vec2();

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLevelSelect());
        this.wireButton(this.btnHint, 'BtnHint', () => {
            void this.flow.requestReward('hint', () => this.flow.useHint());
        });
        this.wireButton(this.btnAddTime, 'BtnAddTime', () => {
            void this.flow.requestReward('add-time', () => this.flow.addTime(30));
        });
        this.wireButton(this.btnShare, 'BtnShare', () => this.flow.share());
        this.wireButton(this.btnZoom, 'BtnZoom', () => this._toggleZoom());

        const top = this.resolveNode(this.topImage, 'TopImage');
        const bottom = this.resolveNode(this.bottomImage, 'BottomImage');
        this._bindImageInput(top);
        this._bindImageInput(bottom);
    }

    /** 进入关卡：设置图片与文字，清理旧标记。由 GameFlow.startLevel 调用。 */
    public async setupLevel(level: LevelConfig): Promise<void> {
        this._level = level;
        const token = ++this._setupToken;
        this._clearMarkers();
        this._setZoom(1);

        this.setLabel(this.levelTitle, 'LevelTitle', `第${level.id}关`);
        this.setLabel(this.levelName, 'LevelName', level.name);

        try {
            const [topFrame, bottomFrame] = await Promise.all([
                this.flow.loadSpriteFrame(level.topImage),
                this.flow.loadSpriteFrame(level.bottomImage),
            ]);
            if (token !== this._setupToken) return;
            const top = this.resolveNode(this.topImage, 'TopImage');
            const bottom = this.resolveNode(this.bottomImage, 'BottomImage');
            this._applySpriteFrame(top, topFrame);
            this._applySpriteFrame(bottom, bottomFrame);
        } catch (error) {
            console.error(`[GameScreen] 关卡图片加载失败: ${level.topImage} / ${level.bottomImage}`, error);
        }
        this.refreshHud();
    }

    /** 刷新顶部信息栏。由 GameFlow 在倒计时与状态变化时调用。 */
    public refreshHud(): void {
        const flow = this.flow;

        const timer = this.resolveLabel(this.timerLabel, 'Timer');
        if (timer) {
            const seconds = Math.max(0, Math.ceil(flow.remainingTime));
            const minutes = Math.floor(seconds / 60);
            const remainder = String(seconds % 60).padStart(2, '0');
            timer.string = `${minutes}:${remainder}`;
            timer.color = seconds <= 10 ? UIColors.red : new Color(65, 72, 95, 255);
        }

        const lives = this.resolveLabel(this.livesLabel, 'Lives');
        if (lives) {
            lives.string = `${'♥'.repeat(flow.lives)}${'♡'.repeat(Math.max(0, 3 - flow.lives))}`;
            lives.color = new Color(202, 78, 79, 255);
        }

        const level = this._level;
        const progress = this.resolveLabel(this.progressLabel, 'Progress');
        if (progress && level) {
            const total = level.differences.length;
            const found = flow.foundIds.size;
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
            graphics.strokeColor = UIColors.gold;
            graphics.circle(0, 0, difference.radius * size.width);
            graphics.stroke();
            this._markers.push(marker);
        }
    }

    /** 在点错位置绘制短暂的红叉。 */
    public drawWrongMarker(localPosition: Vec3, imageNode: Node): void {
        const marker = new Node('WrongMarker');
        marker.setPosition(localPosition);
        marker.parent = imageNode;
        const graphics = marker.addComponent(Graphics);
        graphics.lineWidth = 7;
        graphics.strokeColor = UIColors.red;
        graphics.moveTo(-18, -18);
        graphics.lineTo(18, 18);
        graphics.moveTo(-18, 18);
        graphics.lineTo(18, -18);
        graphics.stroke();
        const opacity = marker.addComponent(UIOpacity);
        tween(opacity).delay(0.3).to(0.35, { opacity: 0 }).call(() => marker.destroy()).start();
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
            this.flow.onDifferenceFound(hit);
        } else {
            this.flow.onWrongTap(local, imageNode);
        }
    }

    private _bindImageInput(imageNode: Node | null): void {
        if (!imageNode) return;
        imageNode.on(Input.EventType.TOUCH_START, event => this._onGestureStart(event), this);
        imageNode.on(Input.EventType.TOUCH_MOVE, event => this._onGestureMove(event), this);
        imageNode.on(Input.EventType.TOUCH_END, event => this._onGestureEnd(event, imageNode), this);
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
        if (label) label.string = this._zoomScale > 1 ? '还原' : '×2';
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

    private _imageSize(node: Node): Size | null {
        return node.getComponent(UITransform)?.contentSize ?? null;
    }

    private _clearMarkers(): void {
        for (const marker of this._markers) marker.destroy();
        this._markers.length = 0;
    }
}
