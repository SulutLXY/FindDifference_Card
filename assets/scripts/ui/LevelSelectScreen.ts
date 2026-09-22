import { _decorator, Color, Input, Label, Node, Sprite } from 'cc';
import { UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 选关界面（Screens/LevelSelect）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack      返回大厅按钮（Node）
 * - List         场景中预拼装的五关卡片容器
 * - Card1–Card5 真实场景卡片，脚本只刷新文本和解锁状态。
 */
@ccclass('LevelSelectScreen')
export class LevelSelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '关卡卡片容器（命名 List，可选）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '可选卡片模板，需含 CardNumber/CardName/CardDetail 三个 Label 子节点' })
    public cardTemplate: Node | null = null;

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        const list = this.resolveNode(this.listRoot, 'List');
        for (let id = 1; id <= 5; id++) {
            const card = list?.getChildByName(`Card${id}`);
            card?.on(Input.EventType.TOUCH_END, () => this._selectLevel(id), this);
        }
    }

    protected onOpen(): void {
        this.rebuild();
    }

    public rebuild(): void {
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        for (const level of this.flow.levels) {
            const card = root.getChildByName(`Card${level.id}`);
            if (!card) continue;
            const unlocked = this.flow.save.isUnlocked(level.id);
            const progress = this.flow.save.data.levels[String(level.id)];
            this._setCardLabel(card, 'CardNumber', `第${level.id}关`);
            this._setCardLabel(card, 'CardName', level.name);
            this._setCardLabel(card, 'CardDetail', unlocked
                ? `${progress ? '★'.repeat(progress.stars) + '☆'.repeat(3 - progress.stars) : '☆☆☆'}  ${level.differences.length}处差异`
                : '通关上一关后解锁');
            const lock = card.getChildByName('LockIcon');
            if (lock) lock.active = !unlocked;
            const image = card.getChildByName('Thumbnail');
            if (image) image.getComponent(Sprite)!.color = unlocked
                ? new Color(255, 255, 255, 255)
                : new Color(135, 145, 160, 255);
        }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = card.getChildByName(name)?.getComponent(Label);
        if (label) label.string = text;
    }

    private _selectLevel(id: number): void {
        const level = this.flow.findLevel(id);
        if (!level) return;
        if (!this.flow.save.isUnlocked(id)) {
            this.flow.toast(`通关第${id - 1}关后解锁`);
            return;
        }
        this.flow.startLevel(level);
    }
}
