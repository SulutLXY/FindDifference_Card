import { _decorator, Component, instantiate, Node, Prefab } from 'cc';

const { ccclass, property } = _decorator;

/** Progress 节点唯一的列表控制器；视觉单元来自独立的 Progress_BG 预设体。 */
@ccclass('ProgressView')
export class ProgressView extends Component {
    @property({ type: Prefab, tooltip: 'Progress_BG 预设体（包含默认隐藏的 Progress_GET）' })
    public slotPrefab: Prefab | null = null;

    private readonly _slots: Node[] = [];
    private _foundCount = 0;

    public configure(total: number): void {
        this._slots.forEach(slot => slot.destroy());
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
            const filled = slot.getChildByName('Progress_GET');
            if (filled) filled.active = false;
            this._slots.push(slot);
        }
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
