import { _decorator, Component, instantiate, Layout, Node, Prefab, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/** Progress 节点唯一的列表控制器；视觉单元来自独立的 Progress_BG 预设体。 */
@ccclass('ProgressView')
export class ProgressView extends Component {
    @property({ type: Prefab, tooltip: 'Progress_BG 预设体（包含默认隐藏的 Progress_GET）' })
    public slotPrefab: Prefab | null = null;

    @property({ tooltip: '每行最多图标数；0 表示根据容器宽度自动计算', min: 0, step: 1 })
    public maxPerRow = 0;

    @property({ tooltip: '图标水平间距', min: 0 })
    public spacingX = 2;

    @property({ tooltip: '行间距', min: 0 })
    public spacingY = 4;

    private _slotWidth = 0;
    private _slotHeight = 0;
    private _scaleX = 1;
    private _scaleY = 1;
    private _scaleZ = 1;

    protected onEnable(): void {
        const layout = this.node.getComponent(Layout);
        if (layout) layout.enabled = false;
        this.node.on(Node.EventType.SIZE_CHANGED, this._layoutSlots, this);
        this._layoutSlots();
    }

    protected onDisable(): void {
        this.node.off(Node.EventType.SIZE_CHANGED, this._layoutSlots, this);
    }

    private readonly _slots: Node[] = [];
    private _foundCount = 0;

    public configure(total: number): void {
        this._slots.forEach(slot => { slot.removeFromParent(); slot.destroy(); });
        this._slots.length = 0;
        this._foundCount = 0;

        if (!this.slotPrefab) {
            console.error('[ProgressView] 请在 Progress 节点绑定 Progress_BG 预设体');
            return;
        }

        for (let i = 0; i < total; i++) {
            const slot = instantiate(this.slotPrefab);
            slot.name = `Progress_BG_${i + 1}`;
            slot.parent = this.node;
            if (i === 0) {
                const ui = slot.getComponent(UITransform);
                this._scaleX = slot.scale.x;
                this._scaleY = slot.scale.y;
                this._scaleZ = slot.scale.z;
                this._slotWidth = (ui?.width ?? 40) * Math.abs(this._scaleX);
                this._slotHeight = (ui?.height ?? 40) * Math.abs(this._scaleY);
            }
            const filled = slot.getChildByName('Progress_GET');
            if (filled) filled.active = false;
            this._slots.push(slot);
        }
        this._layoutSlots();
    }

    private _layoutSlots(): void {
        const ui = this.node.getComponent(UITransform);
        if (!ui || !this._slots.length || this._slotWidth <= 0 || this._slotHeight <= 0) return;
        const gapX = Math.max(0, this.spacingX);
        const gapY = Math.max(0, this.spacingY);
        const capacity = Math.max(1, Math.floor((ui.width + gapX) / (this._slotWidth + gapX)));
        const columns = Math.min(capacity, this.maxPerRow > 0 ? Math.max(1, Math.floor(this.maxPerRow)) : capacity);
        const rows = Math.ceil(this._slots.length / columns);
        const width = Math.min(columns, this._slots.length) * (this._slotWidth + gapX) - gapX;
        const height = rows * (this._slotHeight + gapY) - gapY;
        // 行数很多时整体等比缩小，避免覆盖图片区或相邻 HUD。
        const scale = Math.max(0, Math.min(1, ui.width / width, ui.height / height));
        const centerX = (0.5 - ui.anchorX) * ui.width;
        const centerY = (0.5 - ui.anchorY) * ui.height;
        this._slots.forEach((slot, index) => {
            const row = Math.floor(index / columns);
            const column = index % columns;
            const count = Math.min(columns, this._slots.length - row * columns);
            const child = slot.getComponent(UITransform);
            slot.setScale(this._scaleX * scale, this._scaleY * scale, this._scaleZ);
            slot.setPosition(
                centerX + ((column - (count - 1) / 2) * (this._slotWidth + gapX)
                    + ((child?.anchorX ?? 0.5) - 0.5) * this._slotWidth) * scale,
                centerY + (height / 2 - this._slotHeight / 2 - row * (this._slotHeight + gapY)
                    + ((child?.anchorY ?? 0.5) - 0.5) * this._slotHeight) * scale,
                slot.position.z,
            );
        });
    }

    public setFoundCount(count: number): void {
        const next = Math.max(0, Math.min(count, this._slots.length));
        if (next === this._foundCount) return;
        this._foundCount = next;
        this._slots.forEach((slot, index) => {
            const filled = slot.getChildByName('Progress_GET');
            if (filled) filled.active = index < next;
        });
    }
}
