import { _decorator, Component, Node, UITransform, Mask, Graphics, Color, Label, Sprite, EventTouch, Vec3 } from 'cc';
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
        this.node.on(Node.EventType.TOUCH_START, this._block, this, true);
        this.node.on(Node.EventType.TOUCH_MOVE, this._block, this, true);
        this.node.on(Node.EventType.TOUCH_END, this._tap, this, true);
    }
    public present(target: Node, local: Vec3, radius: number, done: (hit: boolean) => void, message = '点击亮处，找出不同', closeText = '跳过引导'): void {
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        this._target = target; this._local.set(local); this._radius = radius; this._done = done;
        const closeLabel = this._skip?.getComponent(Label);
        if (closeLabel) closeLabel.string = closeText;
        const text = this.node.getChildByPath('TipsBox/TipsText')?.getComponent(Label);
        if (text) text.string = message;
        this._textLayoutKey = '';
        this._layoutText();
        this.lateUpdate();
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
    }
    public dismiss(): void { this._done = null; this._target = null; this.node.active = false; }
    private _block(event: EventTouch): void { event.propagationStopped = true; }
    private _tap(event: EventTouch): void {
        event.propagationStopped = true;
        if (!this._done) return;
        const pos = event.getUILocation();
        const p = this.node.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(pos.x, pos.y));
        const skip = this._skip!;
        const skipped = Math.abs(p.x - skip.position.x) <= 75 && Math.abs(p.y - skip.position.y) <= 32;
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
        ui.setContentSize(width, maskHeight);
        const targetUi = this._target.getComponent(UITransform)!;
        this._center = ui.convertToNodeSpaceAR(targetUi.convertToWorldSpaceAR(this._local));
        const edge = ui.convertToNodeSpaceAR(targetUi.convertToWorldSpaceAR(new Vec3(this._local.x+this._radius,this._local.y)));
        this._screenRadius = Vec3.distance(edge,this._center);
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
