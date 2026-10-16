import { _decorator, Component, Node, UITransform, Mask, Graphics, Color, Label, Sprite, EventTouch, Vec3, input, Input } from 'cc';
const { ccclass } = _decorator;

/** Reuses the scene-authored TipsBox and upward-facing TipsAimBox. */
@ccclass('GameTips')
export class GameTips extends Component {
    private _target: Node | null = null;
    private _local = new Vec3();
    private _radius = 0;
    private _hole: Node | null = null;
    private _shade: Graphics | null = null;
    private _outline: Graphics | null = null;
    private _center = new Vec3();
    private _screenRadius = 0;
    private _done: ((hit: boolean) => void) | null = null;
    private _skip: Node | null = null;
    private _textLayoutKey = '';
    private _boxWidth = 300;
    private _boxHeight = 120;
    private _boxLeft = -150;
    private _boxRight = 150;
    private _hintDone: (() => void) | null = null;
    private _hintInputRoot: Node | null = null;
    private _geometryDirty = true;
    private _drawWidth = 0;
    private _drawHeight = 0;
    private readonly _nextCenter = new Vec3();
    private readonly _edge = new Vec3();
    private readonly _world = new Vec3();
    private readonly _localEdge = new Vec3();

    protected onLoad(): void {
        const hole = new Node('FocusHole');
        hole.layer = this.node.layer;
        hole.parent = this.node;
        hole.addComponent(UITransform);
        const mask = hole.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_ELLIPSE;
        mask.inverted = true;
        hole.setSiblingIndex(0);
        const shade = new Node('FocusShade');
        shade.layer = this.node.layer;
        shade.parent = hole;
        shade.addComponent(UITransform);
        this._shade = shade.addComponent(Graphics);
        this._hole = hole;
        const outline = new Node('FocusOutline');
        outline.layer = this.node.layer;
        outline.parent = this.node;
        outline.addComponent(UITransform);
        this._outline = outline.addComponent(Graphics);
        outline.setSiblingIndex(1);
        const skip = new Node('SkipTutorial');
        skip.layer = this.node.layer;
        skip.parent = this.node;
        skip.addComponent(UITransform).setContentSize(150, 64);
        const label = skip.addComponent(Label);
        label.string = '跳过引导'; label.fontSize = 26;
        this._skip = skip;
        this._setBlockingInput(true);
    }
    private _setBlockingInput(block: boolean): void {
        this.node.off(Node.EventType.TOUCH_START, this._block, this, true);
        this.node.off(Node.EventType.TOUCH_MOVE, this._block, this, true);
        this.node.off(Node.EventType.TOUCH_END, this._tap, this, true);
        if (!block) return;
        this.node.on(Node.EventType.TOUCH_START, this._block, this, true);
        this.node.on(Node.EventType.TOUCH_MOVE, this._block, this, true);
        this.node.on(Node.EventType.TOUCH_END, this._tap, this, true);
    }
    public present(target: Node, local: Vec3, radius: number, done: (hit: boolean) => void, message = '点击亮处，找出不同', closeText = '跳过引导'): void {
        this._clearHint();
        this._setBlockingInput(true);
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this._target = target; this._local.set(local); this._radius = radius; this._done = done;
        const closeLabel = this._skip?.getComponent(Label);
        if (this._skip) this._skip.active = closeText.length > 0;
        if (closeLabel) closeLabel.string = closeText;
        const text = this.node.getChildByPath('TipsBox/TipsText')?.getComponent(Label);
        if (text) text.string = message;
        this._textLayoutKey = '';
        this._geometryDirty = true;
        this._layoutText();
        this.lateUpdate();
    }
    /** 提示只显示高亮，整个节点树不注册触摸命中，不遮挡正常玩法。 */
    public presentHint(target: Node, local: Vec3, radius: number, onDismiss?: () => void): void {
        this.present(target, local, radius, () => {}, '不同就在圈内', '');
        this._done = null;
        this._setBlockingInput(false);
        this._hintDone = onDismiss ?? null;
        // 按钮在 TOUCH_END 打开提示；监听下一次 TOUCH_START，避免同次点击立刻关闭。
        input.on(Input.EventType.TOUCH_START, this._finishHint, this);
        // Cocos 的 UI 会吞掉全局触摸；从共同父节点捕获 UI 点击，且不停止传播。
        // Screens 是没有 UITransform 的分组节点，注册触摸会使 3.8.8 的
        // PointerEventDispatcher 在读取 cameraPriority 时崩溃。
        let root = this.node.parent;
        while (root && !root.getComponent(UITransform)) root = root.parent;
        this._hintInputRoot = root;
        this._hintInputRoot?.on(Node.EventType.TOUCH_START, this._finishHint, this, true);
        this.scheduleOnce(this._finishHint, 2);
    }
    private _clearHint(): void {
        input.off(Input.EventType.TOUCH_START, this._finishHint, this);
        this._hintInputRoot?.off(Node.EventType.TOUCH_START, this._finishHint, this, true);
        this._hintInputRoot = null;
        this.unschedule(this._finishHint);
        this._hintDone = null;
    }
    private _finishHint(): void {
        const done = this._hintDone;
        this.dismiss();
        done?.();
    }
    protected onDisable(): void { this._clearHint(); }
    protected onDestroy(): void {
        this._clearHint();
        this._setBlockingInput(false);
    }
    /** 文字按固定字号测量，背景适应文字，不通过缩放容纳内容。 */
    private _layoutText(): void {
        const box = this.node.getChildByName('TipsBox');
        const text = box?.getChildByName('TipsText')?.getComponent(Label);
        if (!box || !text) return;
        const key = `${text.string}|${text.fontSize}|${text.overflow}`;
        if (this._textLayoutKey === key) return;
        box.setScale(1, 1, 1);
        text.node.setScale(1, 1, 1);
        text.fontSize = 20;
        text.lineHeight = 26;
        text.enableWrapText = false;
        text.overflow = Label.Overflow.NONE;
        text.updateRenderData(true);
        const textUi = text.node.getComponent(UITransform)!;
        const bg = box.getChildByName('TipsBG_02');
        const bgUi = bg?.getComponent(UITransform);
        const sprite = bg?.getComponent(Sprite);
        if (sprite) sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 保留场景制作的左锚点、猫咪偏移和背景高度，只向右扩展背景。
        const textLeft = text.node.position.x - textUi.width * textUi.anchorX;
        if (bgUi && bg) {
            const bgLeft = bg.position.x - bgUi.width * bgUi.anchorX;
            const padding = Math.max(16, textLeft - bgLeft);
            bgUi.setContentSize(textLeft + textUi.width + padding - bgLeft, bgUi.height);
        }
        const children = box.children.filter(child => child.active && child.getComponent(UITransform));
        this._boxLeft = Math.min(...children.map(child => {
            const ui = child.getComponent(UITransform)!;
            return child.position.x - ui.width * ui.anchorX * Math.abs(child.scale.x);
        }));
        this._boxRight = Math.max(...children.map(child => {
            const ui = child.getComponent(UITransform)!;
            return child.position.x + ui.width * (1 - ui.anchorX) * Math.abs(child.scale.x);
        }));
        const bottom = Math.min(...children.map(child => {
            const ui = child.getComponent(UITransform)!;
            return child.position.y - ui.height * ui.anchorY * Math.abs(child.scale.y);
        }));
        const top = Math.max(...children.map(child => {
            const ui = child.getComponent(UITransform)!;
            return child.position.y + ui.height * (1 - ui.anchorY) * Math.abs(child.scale.y);
        }));
        this._boxWidth = this._boxRight - this._boxLeft;
        this._boxHeight = top - bottom;
        box.getComponent(UITransform)?.setContentSize(this._boxWidth, this._boxHeight);
        this._textLayoutKey = `${text.string}|${text.fontSize}|${text.overflow}`;
        this._geometryDirty = true;
    }
    public dismiss(): void {
        this._clearHint();
        this._done = null; this._target = null; this.node.active = false;
    }
    private _block(event: EventTouch): void { event.propagationStopped = true; }
    private _tap(event: EventTouch): void {
        event.propagationStopped = true;
        if (!this._done) return;
        const pos = event.getUILocation();
        const p = this.node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(pos.x, pos.y));
        const skip = this._skip!;
        const skipped = skip.active && Math.abs(p.x - skip.position.x) <= 75 && Math.abs(p.y - skip.position.y) <= 32;
        const hit = (p.x-this._center.x)**2 + (p.y-this._center.y)**2 <= this._screenRadius**2;
        if (!hit && !skipped) return;
        const done = this._done; this.dismiss(); done(!skipped);
    }
    protected lateUpdate(): void {
        if (!this._target?.isValid || !this._hole || !this._shade) return;
        this._layoutText();
        const ui = this.node.getComponent(UITransform)!;
        const canvas = this.node.parent?.parent?.getComponent(UITransform);
        const width = canvas?.width || 750, height = canvas?.height || 1334;
        const maskHeight = Math.max(2000, height);
        if (ui.width !== width || ui.height !== maskHeight) ui.setContentSize(width, maskHeight);
        const targetUi = this._target.getComponent(UITransform)!;
        // 保留每帧坐标检测以跟随目标及祖先的缩放/移动，静止时不重建图形。
        targetUi.convertToWorldSpaceAR(this._local, this._world);
        ui.convertToNodeSpaceAR(this._world, this._nextCenter);
        this._localEdge.set(this._local.x + this._radius, this._local.y, this._local.z);
        targetUi.convertToWorldSpaceAR(this._localEdge, this._world);
        ui.convertToNodeSpaceAR(this._world, this._edge);
        const radius = Vec3.distance(this._edge, this._nextCenter);
        if (!this._geometryDirty && width === this._drawWidth && height === this._drawHeight
            && this._center.x === this._nextCenter.x && this._center.y === this._nextCenter.y
            && this._screenRadius === radius) return;
        this._geometryDirty = false;
        this._drawWidth = width; this._drawHeight = height;
        this._center.set(this._nextCenter);
        this._screenRadius = radius;
        this._hole.setPosition(this._center);
        if (this._outline) {
            this._outline.clear();
            this._outline.strokeColor = new Color(255, 210, 65, 255);
            this._outline.lineWidth = 3;
            this._outline.circle(this._center.x, this._center.y, this._screenRadius);
            this._outline.stroke();
        }
        this._hole.getComponent(UITransform)!.setContentSize(this._screenRadius*2,this._screenRadius*2);
        this._shade.clear(); this._shade.fillColor = new Color(0,0,0,128);
        this._shade.rect(-width/2-this._center.x,-maskHeight/2-this._center.y,width,maskHeight); this._shade.fill();
        const offset = this._boxHeight / 2 + 55;
        const below = this._center.y-this._screenRadius-offset-this._boxHeight/2 > -height/2+20;
        const direction = below ? -1 : 1;
        const aim = this.node.getChildByName('TipsAimBox');
        aim?.setPosition(this._center.x,this._center.y+direction*(this._screenRadius+22));
        aim?.setRotationFromEuler(0,0,below?0:180);
        const leftLimit = -width / 2 + 16 - this._boxLeft;
        const rightLimit = width / 2 - 16 - this._boxRight;
        this.node.getChildByName('TipsBox')?.setPosition(Math.max(leftLimit, Math.min(rightLimit, this._center.x - (this._boxLeft + this._boxRight) / 2)),this._center.y+direction*(this._screenRadius+offset));
        this._skip?.setPosition(width/2-100,height/2-75);
    }
}
