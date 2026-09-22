import { _decorator, Color, Graphics, Input, Label, Node, Sprite, UITransform, instantiate } from 'cc';
import { LevelConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 选关界面（Screens/LevelSelect）。
 *
 * 卡片动态生成：以 Card1（或 cardTemplate 绑定节点）为模板，
 * 按关卡配置实例化任意数量，进入界面时刷新数据，离开时销毁。
 *
 * 模板结构约定（Card1）：
 * - CardNumber          Label，「第N关」
 * - CardName            Label，关卡名
 * - CardDetail          星级区域容器（不解锁时整体隐藏）
 *   - CardDetail_star1BG / star2BG / star3BG   灰色星星底
 *     - CardDetail_star                        金星，默认隐藏，按完成星级逐颗点亮
 * - LockIcon            锁图标（仅未解锁时显示，与 CardDetail 互斥）
 * - Thumbnail           关卡缩略图（可选：关卡配置含 thumbnail 路径时按关加载）
 */
@ccclass('LevelSelectScreen')
export class LevelSelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '关卡卡片容器（命名 List，可选）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 Card1 作为模板' })
    public cardTemplate: Node | null = null;

    private _runtimeCards: Node[] = [];

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
    }

    protected onOpen(): void {
        this.rebuild();
    }

    protected onClose(): void {
        this._clearRuntimeCards();
    }

    /** 动态生成全部关卡卡片：按模板实例化 → 填充数据 → 隐藏场景里手动拼的参考卡。 */
    public rebuild(): void {
        this._clearRuntimeCards();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const template = this._resolveTemplate(root);

        for (const level of this.flow.levels) {
            let card: Node;
            if (template) {
                card = instantiate(template);
                card.name = `LevelCard-${level.id}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._runtimeCards.push(card);
            card.parent = root;
            card.active = true;
            this._fillCard(card, level);
        }

        this._hideManualCards(root);
    }

    /** 模板来源：优先 cardTemplate 绑定，其次 List 下的 Card1。 */
    private _resolveTemplate(root: Node): Node | null {
        if (this.cardTemplate && this.cardTemplate.isValid) return this.cardTemplate;
        return root.getChildByName('Card1');
    }

    /** 隐藏场景里手动拼装的 Card1..CardN（它们只是模板参考，不参与显示）。 */
    private _hideManualCards(root: Node): void {
        for (const child of root.children) {
            if (/^Card\d+$/.test(child.name)) child.active = false;
        }
    }

    private _fillCard(card: Node, level: LevelConfig): void {
        const unlocked = this.flow.save.isUnlocked(level.id);
        const progress = this.flow.save.data.levels[String(level.id)];

        this._setCardLabel(card, 'CardNumber', `第${level.id}关`);
        this._setCardLabel(card, 'CardName', level.name);

        // LockIcon 与 CardDetail 互斥：未解锁显示锁，解锁显示星级区域
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = !unlocked;

        const detail = card.getChildByName('CardDetail');
        if (detail) {
            detail.active = unlocked;
            if (unlocked) {
                // 星级用图片显示：清空文字，按完成星级逐颗点亮金星
                const label = detail.getComponent(Label);
                if (label) label.string = '';
                const stars = progress?.stars ?? 0;
                for (let i = 1; i <= 3; i++) {
                    const bg = detail.getChildByName(`CardDetail_star${i}BG`);
                    const star = bg?.getChildByName('CardDetail_star');
                    if (star) star.active = i <= stars;
                }
            }
        }

        void this._loadThumbnail(card, level);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => this._selectLevel(level.id), this);
    }

    /** 可选：关卡配置含 thumbnail 路径时按关加载缩略图，缺失则保留模板原图。 */
    private async _loadThumbnail(card: Node, level: LevelConfig): Promise<void> {
        const thumbnail = card.getChildByName('Thumbnail');
        if (!thumbnail || !level.thumbnail) return;
        try {
            const frame = await this.flow.loadSpriteFrame(level.thumbnail);
            const sprite = thumbnail.getComponent(Sprite);
            if (sprite && thumbnail.isValid) sprite.spriteFrame = frame;
        } catch {
            // 缩略图缺失时保留模板自带贴图
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

    private _clearRuntimeCards(): void {
        for (const card of this._runtimeCards) card.destroy();
        this._runtimeCards = [];
    }

    /** 无模板时的内置简易卡，保证流程可运行。 */
    private _buildFallbackCard(): Node {
        const card = new Node('LevelCard');
        const ui = card.addComponent(UITransform);
        ui.setContentSize(650, 150);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = UIColors.panel;
        graphics.roundRect(-325, -75, 650, 150, 28);
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = UIColors.gold;
        graphics.roundRect(-325, -75, 650, 150, 28);
        graphics.stroke();

        const labelNode = new Node('CardLabel');
        labelNode.parent = card;
        const labelUi = labelNode.addComponent(UITransform);
        labelUi.setContentSize(600, 130);
        const label = labelNode.addComponent(Label);
        label.fontSize = 26;
        label.lineHeight = 36;
        label.color = Color.WHITE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return card;
    }
}
