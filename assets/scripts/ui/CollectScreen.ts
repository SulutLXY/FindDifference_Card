import {
    _decorator,
    Color,
    Graphics,
    Input,
    Label,
    Layout,
    Node,
    Sprite,
    UITransform,
    Vec3,
    instantiate,
} from 'cc';
import { CollectItem } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 每行列数 */
const GRID_COLUMNS = 4;

/** 默认藏品数据：使用 resources/textures/UI_Sprite/V3/icons 下的现成素材（临时图，待美食资源）。 */
const DEFAULT_COLLECTS: CollectItem[] = [
    { id: 'magnifier', name: '放大镜', desc: '找茬旅行的老伙计，轻轻一按就能看得更清楚。', icon: 'textures/UI_Sprite/V3/icons/icon_fangda', obtained: true, unlockTime: '2026.09.25' },
    { id: 'star', name: '金星', desc: '完美通关的证明，三颗齐全可不容易。', icon: 'textures/UI_Sprite/V3/icons/icon_starW', obtained: true, unlockTime: '2026.09.25' },
    { id: 'clock', name: '闹钟', desc: '滴答滴答，时间永远不够用。', icon: 'textures/UI_Sprite/V3/icons/icon_Time', obtained: true, unlockTime: '2026.09.25' },
    { id: 'heart', name: '爱心', desc: '每一次失误都会失去一颗心，且玩且珍惜。', icon: 'textures/UI_Sprite/V3/icons/icon_heart_filled', obtained: true, unlockTime: '2026.09.25' },
    { id: 'hint', name: '提示', desc: '卡壳时的好帮手，指哪儿打哪儿。', icon: 'textures/UI_Sprite/V3/icons/icon_hint', obtained: false },
    { id: 'album', name: '相册', desc: '每一张对比图都是一段旅行记忆。', icon: 'textures/UI_Sprite/V3/icons/icon_album', obtained: false },
    { id: 'calendar', name: '日历', desc: '每日一签，今天是找茬的好日子。', icon: 'textures/UI_Sprite/V3/icons/icon_Time02', obtained: false },
    { id: 'idea', name: '灵感', desc: '灵光一闪，五处不同尽收眼底。', icon: 'textures/UI_Sprite/V3/icons/icon_Idea', obtained: false },
];

/**
 * 收藏界面（Screens/Collect）：藏品网格展示 + 点击弹窗详情。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack   返回大厅按钮（Node）
 * - List      藏品格子窗口（Node），代码补 Grid Layout，一排 4 个
 * - Item      藏品格子模板（Node，List 下），结构约定：
 *   - ItemIcon  Sprite，藏品图标
 *   - ItemName  Label，藏品名（可选）
 *   无模板时使用内置简易格子。
 * - Modal     详情弹窗（Node，可选），结构约定：
 *   - ModalIcon  Sprite，大图
 *   - ModalName  Label，名称
 *   - ModalDesc  Label，描述
 *   - BtnClose   关闭按钮（Node）
 *   场景未摆放时由代码自动构建同款弹窗。
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
    public items: CollectItem[] = DEFAULT_COLLECTS;

    private _cards: Node[] = [];
    private _builtModal: Node | null = null;

    protected onLoad(): void {
        this._ensureBackButton();
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this._setupGrid();
        this._ensureModal();
    }

    protected onOpen(): void {
        this.rebuild();
    }

    protected onClose(): void {
        this._closeModal();
        this._clearCards();
    }

    public rebuild(): void {
        this._clearCards();
        const root = (this.listRoot?.isValid ? this.listRoot : null) ?? this.node;
        // 模板：优先 Inspector 绑定，其次 List 下的 Item / Card1（关卡卡结构同套命名）
        const template = this.itemTemplate ?? root.getChildByName('Item') ?? root.getChildByName('Card1');

        this.items.forEach((item, index) => {
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
        if (subLabel) subLabel.string = obtained ? `获得时间\n${item.unlockTime ?? ''}` : '暂未获得';

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
            let sprite = icon.getComponent(Sprite);
            if (!sprite) sprite = icon.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            if (icon.isValid) sprite.spriteFrame = frame;
        } catch {
            // 图标缺失时保持模板原样
        }
    }

    /** List 改造为 Grid Layout：固定一排 4 个。
     *  resizeMode 用 NONE（不改变容器大小），List 的位置/尺寸完全以场景面板设置为准。 */
    private _setupGrid(): void {
        let root = this.listRoot?.isValid ? this.listRoot : this.node.getChildByName('List');
        if (!root) {
            root = new Node('List');
            root.parent = this.node;
            const ui = root.addComponent(UITransform);
            ui.setContentSize(750, 1000);
        }
        this.listRoot = root;
        const layout = root.getComponent(Layout) ?? root.addComponent(Layout);
        layout.type = Layout.Type.GRID;
        layout.constraint = Layout.Constraint.FIXED_COL;
        layout.constraintNum = GRID_COLUMNS;
        layout.resizeMode = Layout.ResizeMode.NONE;
        layout.spacingX = 6;
        layout.spacingY = 10;
        layout.paddingLeft = 0;
        layout.paddingRight = 0;
        layout.paddingTop = 0;
        layout.paddingBottom = 0;
        layout.horizontalDirection = Layout.HorizontalDirection.LEFT_TO_RIGHT;
        layout.verticalDirection = Layout.VerticalDirection.TOP_TO_BOTTOM;
        layout.enabled = true;
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
        for (const card of this._cards) card.destroy();
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

    private _openModal(item: CollectItem): void {
        this._ensureModal();
        const modal = this.modal;
        if (!modal) return;

        const icon = modal.getChildByName('ModalIcon');
        if (icon) void this._loadIcon(icon, item.icon);
        const name = modal.getChildByName('ModalName')?.getComponent(Label);
        if (name) name.string = item.name;
        const desc = modal.getChildByName('ModalDesc')?.getComponent(Label);
        if (desc) desc.string = item.desc;

        modal.active = true;
        modal.setPosition(Vec3.ZERO);
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
