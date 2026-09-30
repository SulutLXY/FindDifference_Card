import {
    _decorator,
    Color,
    Graphics,
    Input,
    Label,
    Node,
    Sprite,
    UITransform,
    Vec3,
    instantiate,
} from 'cc';
import { CollectItem } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 每页格数：3 列 × 3 行（列数由场景里 List 的 Layout 预设与容器宽度决定） */
const PAGE_SIZE = 9;

/**
 * 收藏界面（Screens/Collect）：3×3 翻页藏品网格 + 点击弹窗详情。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack   返回大厅按钮（Node）
 * - List      藏品格子窗口（Node），Grid 布局/间距以场景预设为准，每页 9 个
 * - Item      藏品格子模板（Node，List 下，也可用 Card1），结构约定：
 *   - ItemIcon  Sprite，藏品图标
 *   - ItemName  Label，藏品名（可选）
 *   无模板时使用内置简易格子。
 * - btnback / btnnext  上/下翻页按钮，到边界时自动隐藏
 * - haveCollected      同名节点两个：左上方为「已收藏：x/y」统计，底部为「当前页/总页数」
 */
@ccclass('CollectScreen')
export class CollectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '藏品格子窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '藏品格子模板（命名 Item，可选）' })
    public itemTemplate: Node | null = null;

    @property({ type: Node, tooltip: '详情弹窗（命名 Modal，可选，缺失时代码构建）' })
    public modal: Node | null = null;

    /** 藏品数据，默认使用内置清单；后续可改为远端配置。 */
    public items: CollectItem[] = [];

    private _cards: Node[] = [];
    private _builtModal: Node | null = null;
    private _page = 0;
    private _btnPrev: Node | null = null;
    private _btnNext: Node | null = null;
    private _statsLabel: Label | null = null;
    private _pageLabel: Label | null = null;

    protected onLoad(): void {
        this._ensureBackButton();
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this._ensureList();
        this._btnPrev = this.resolveNode(null, 'btnback');
        this._btnNext = this.resolveNode(null, 'btnnext');
        this._btnPrev?.on(Input.EventType.TOUCH_END, () => this._turnPage(-1), this);
        this._btnNext?.on(Input.EventType.TOUCH_END, () => this._turnPage(1), this);
        // 场景里有两个同名 haveCollected：左上是收藏统计，底部是页码，按位置区分。
        for (const child of this.node.children) {
            if (child.name !== 'haveCollected') continue;
            const label = child.getComponent(Label);
            if (!label) continue;
            if (child.position.y < 0) this._pageLabel = label;
            else this._statsLabel = label;
        }
    }

    protected onOpen(): void {
        this._page = 0;
        void this._loadFoods();
    }

    protected onClose(): void {
        this._clearCards();
    }

    public rebuild(): void {
        this._clearCards();
        const root = (this.listRoot?.isValid ? this.listRoot : null) ?? this.node;
        // 模板：优先 Inspector 绑定，其次 List 下的 Item / Card1（关卡卡结构同套命名）
        const template = this.itemTemplate ?? root.getChildByName('Item') ?? root.getChildByName('Card1');

        const pageCount = this._pageCount();
        if (this._page >= pageCount) this._page = pageCount - 1;
        const start = this._page * PAGE_SIZE;
        this.items.slice(start, start + PAGE_SIZE).forEach((item, index) => {
            let card: Node;
            if (template) {
                card = instantiate(template);
                card.name = `CollectItem-${item.id}`;
            } else {
                card = this._buildFallbackItem();
            }
            this._cards.push(card);
            card.parent = root;
            card.active = true;
            this._fillItem(card, item, index);
        });

        // 隐藏手动参考卡（Item 或 Card1 命名）
        for (const child of root.children) {
            if (/^(Item|Card\d*)$/.test(child.name)) child.active = false;
        }
        this._updatePager();
    }

    // ------------------------------------------------------------------
    // 翻页
    // ------------------------------------------------------------------

    private _pageCount(): number {
        return Math.max(1, Math.ceil(this.items.length / PAGE_SIZE));
    }

    private _turnPage(delta: number): void {
        const next = this._page + delta;
        if (next < 0 || next >= this._pageCount()) return;
        this._page = next;
        this.rebuild();
    }

    private _updatePager(): void {
        const pageCount = this._pageCount();
        if (this._pageLabel) this._pageLabel.string = `${this._page + 1}/${pageCount}`;
        if (this._statsLabel) {
            const obtained = this.items.filter(item => item.obtained).length;
            this._statsLabel.string = `已收藏：${obtained}/${this.items.length}`;
        }
        if (this._btnPrev?.isValid) this._btnPrev.active = this._page > 0;
        if (this._btnNext?.isValid) this._btnNext.active = this._page < pageCount - 1;
    }

    // ------------------------------------------------------------------
    // 格子
    // ------------------------------------------------------------------

    private _fillItem(card: Node, item: CollectItem, index: number): void {
        const obtained = item.obtained === true;

        // 名称：CardNumber（关卡卡模板的主名区）或 ItemName
        const nameLabel = card.getChildByName('CardNumber')?.getComponent(Label)
            ?? card.getChildByName('ItemName')?.getComponent(Label);
        if (nameLabel) nameLabel.string = item.name;

        // 获得时间：已获得显示解锁时间，未获得标记「暂未获得」
        const subLabel = card.getChildByName('CardName')?.getComponent(Label);
        if (subLabel) subLabel.string = `${item.ext?.cityName ?? ''}\n${obtained ? '已获得' : item.ext?.levelKey ? '暂未获得' : '待开放'}`;

        // 锁图标：隐藏（置灰已表达未获得状态）
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = false;

        // 图标：ItemIcon 或关卡卡结构的 Mask/Thumbnail，按 Thumbnail 节点尺寸显示；未获得置灰
        const iconNode = card.getChildByName('ItemIcon') ?? this.findChildDeep(card, 'Thumbnail');
        if (iconNode) {
            const sprite = iconNode.getComponent(Sprite);
            if (sprite) sprite.grayscale = !obtained;
            void this._loadIcon(iconNode, item.icon);
        }

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => this._openModal(item), this);
    }

    private async _loadIcon(icon: Node, path: string): Promise<void> {
        try {
            const frame = await this.flow.loadSpriteFrame(path);
            if (!icon.isValid) return;
            let sprite = icon.getComponent(Sprite);
            if (!sprite) sprite = icon.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            if (icon.isValid) sprite.spriteFrame = frame;
        } catch {
            // 图标缺失时保持模板原样
        }
    }

    /** 兜底创建 List；场景已摆放时完全沿用场景里的 Layout 预设，不做任何改动。 */
    private _ensureList(): void {
        if (this.listRoot?.isValid) return;
        const found = this.node.getChildByName('List');
        if (found) {
            this.listRoot = found;
            return;
        }
        const root = new Node('List');
        root.parent = this.node;
        const ui = root.addComponent(UITransform);
        ui.setContentSize(750, 1000);
        this.listRoot = root;
    }

    /** 场景未摆放 BtnBack 时自动创建左上角圆形返回键。 */
    private _ensureBackButton(): void {
        if (this.btnBack?.isValid) return;
        const found = this.node.getChildByName('BtnBack');
        if (found) {
            this.btnBack = found;
            return;
        }
        const button = new Node('BtnBack');
        button.parent = this.node;
        button.setPosition(-310, 580);
        const ui = button.addComponent(UITransform);
        ui.setContentSize(88, 88);
        const graphics = button.addComponent(Graphics);
        graphics.fillColor = UIColors.blue;
        graphics.circle(0, 0, 44);
        graphics.fill();
        graphics.lineWidth = 4;
        graphics.strokeColor = UIColors.white;
        graphics.circle(0, 0, 44);
        graphics.stroke();
        const labelNode = new Node('Label');
        labelNode.parent = button;
        const labelUi = labelNode.addComponent(UITransform);
        labelUi.setContentSize(88, 88);
        const label = labelNode.addComponent(Label);
        label.string = '←';
        label.fontSize = 44;
        label.color = UIColors.white;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.btnBack = button;
    }

    private _clearCards(): void {
        for (const card of this._cards) { card.removeFromParent(); card.destroy(); }
        this._cards = [];
    }

    /** 无模板时的内置简易格子。 */
    private _buildFallbackItem(): Node {
        const card = new Node('CollectItem');
        const ui = card.addComponent(UITransform);
        ui.setContentSize(160, 190);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = UIColors.panel;
        graphics.roundRect(-80, -95, 160, 190, 16);
        graphics.fill();
        graphics.lineWidth = 4;
        graphics.strokeColor = UIColors.gold;
        graphics.roundRect(-80, -95, 160, 190, 16);
        graphics.stroke();

        const icon = new Node('ItemIcon');
        icon.parent = card;
        icon.setPosition(0, 24);
        const iconUi = icon.addComponent(UITransform);
        iconUi.setContentSize(110, 110);

        const name = new Node('ItemName');
        name.parent = card;
        name.setPosition(0, -68);
        const nameUi = name.addComponent(UITransform);
        nameUi.setContentSize(140, 36);
        const label = name.addComponent(Label);
        label.fontSize = 24;
        label.color = UIColors.white;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return card;
    }

    // ------------------------------------------------------------------
    // 详情弹窗
    // ------------------------------------------------------------------

    private _ensureModal(): void {
        if (this.modal?.isValid) return;
        const found = this.node.getChildByName('Modal');
        if (found) {
            this.modal = found;
            return;
        }
        this.modal = this._buildModal();
    }

    private async _loadFoods(): Promise<void> {
        this.items = this.flow.foods.map(food => ({
            id: food.id, name: food.name, desc: food.desc, icon: food.icon,
            obtained: !!food.levelKey && this.flow.save.isCompleted(food.levelKey),
            ext: { cityName: food.cityName, levelKey: food.levelKey },
        }));
        this.rebuild();
    }
    private _openModal(item: CollectItem): void {
        const food = this.flow.foods.find(food => food.id === item.id);
        if (food) this.flow.showCatalogFood(food);
    }

    private _closeModal(): void {
        if (this.modal?.isValid) this.modal.active = false;
    }

    /** 场景未摆放 Modal 时自动构建：全屏遮罩 + 居中面板 + 大图/名称/描述/关闭。 */
    private _buildModal(): Node {
        const modal = new Node('Modal');
        modal.parent = this.node;
        modal.setPosition(Vec3.ZERO);
        modal.active = false;
        const modalUi = modal.addComponent(UITransform);
        modalUi.setContentSize(750, 1334);

        // 全屏半透明遮罩（点击空白处也可关闭）
        const maskNode = new Node('Mask');
        maskNode.parent = modal;
        maskNode.setPosition(Vec3.ZERO);
        const maskUi = maskNode.addComponent(UITransform);
        maskUi.setContentSize(750, 1334);
        const maskG = maskNode.addComponent(Graphics);
        maskG.fillColor = UIColors.overlay;
        maskG.rect(-375, -667, 750, 1334);
        maskG.fill();
        maskNode.on(Input.EventType.TOUCH_END, () => this._closeModal(), this);

        // 居中面板
        const panel = new Node('ModalPanel');
        panel.parent = modal;
        panel.setPosition(Vec3.ZERO);
        const panelUi = panel.addComponent(UITransform);
        panelUi.setContentSize(560, 720);
        const panelG = panel.addComponent(Graphics);
        panelG.fillColor = UIColors.white;
        panelG.roundRect(-280, -360, 560, 720, 28);
        panelG.fill();
        panelG.lineWidth = 6;
        panelG.strokeColor = UIColors.gold;
        panelG.roundRect(-280, -360, 560, 720, 28);
        panelG.stroke();

        const addLabel = (name: string, y: number, w: number, h: number, size: number, color: Color): Label => {
            const n = new Node(name);
            n.parent = panel;
            n.setPosition(0, y);
            const nUi = n.addComponent(UITransform);
            nUi.setContentSize(w, h);
            const l = n.addComponent(Label);
            l.fontSize = size;
            l.color = color;
            l.horizontalAlign = Label.HorizontalAlign.CENTER;
            l.verticalAlign = Label.VerticalAlign.CENTER;
            l.overflow = Label.Overflow.SHRINK;
            return l;
        };

        const icon = new Node('ModalIcon');
        icon.parent = panel;
        icon.setPosition(0, 130);
        const iconUi = icon.addComponent(UITransform);
        iconUi.setContentSize(300, 300);

        addLabel('ModalName', -110, 460, 60, 44, new Color(0x79, 0x4b, 0x26, 255));
        addLabel('ModalDesc', -220, 460, 120, 26, UIColors.panelDark);
        addLabel('BtnClose', -310, 200, 64, 36, UIColors.red);

        panel.getChildByName('BtnClose')?.on(Input.EventType.TOUCH_END, () => this._closeModal(), this);

        this._builtModal = modal;
        return modal;
    }
}
