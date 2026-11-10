import {
    _decorator,
    Color,
    Graphics,
    Input,
    Label,
    Layout,
    Node,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    instantiate,
} from 'cc';
import { CollectCategory, CollectItem } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/** 每页格数：3 列 × 3 行（列数由场景里 List 的 Layout 预设与容器宽度决定） */
const PAGE_SIZE = 9;
type CollectFilter = 'all' | CollectCategory;

/**
 * 收藏界面：总进度、分类筛选、3×3 分页、视频领取与可见收藏已读标记。
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
 * - haveCollected_sliderBG/haveCollected_slider  全部收藏进度条
 * - Togle  全部、美食、瓷器三个页签，复用预制体背景和点击动画
 * - LockIcon / TipsIcon  视频领取入口 / 获得但尚未查看的标记
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

    @property({ type: Node, tooltip: '总收藏进度条底槽 haveCollected_sliderBG' })
    public collectionBar: Node | null = null;
    @property({ type: Node }) public tabAll: Node | null = null;
    @property({ type: Node }) public tabFood: Node | null = null;
    @property({ type: Node }) public tabPorcelain: Node | null = null;
    @property({ type: SpriteFrame, tooltip: '选中页签背景，默认取全部页签的初始图片' })
    public selectedTabFrame: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: '未选中页签背景，默认取美食页签的初始图片' })
    public normalTabFrame: SpriteFrame | null = null;

    /** 藏品数据，默认使用内置清单；后续可改为远端配置。 */
    public items: CollectItem[] = [];

    private _cards: Node[] = [];
    private _builtModal: Node | null = null;
    private _page = 0;
    private _btnPrev: Node | null = null;
    private _btnNext: Node | null = null;
    private _statsLabel: Label | null = null;
    private _pageLabel: Label | null = null;
    private _filter: CollectFilter = 'all';
    private _renderVersion = 0;
    private _openVersion = 0;
    private _unlockPending = false;
    private _barFill: Node | null = null;
    private _barWidth = 0;
    private _barLeft = 0;
    private readonly _seenReady = new Map<string, Node>();
    private _seenScheduled = false;

    protected onLoad(): void {
        this._ensureBackButton();
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.returnToLobby());
        this._ensureList();
        this._btnPrev = this.resolveNode(null, 'btnback');
        this._btnNext = this.resolveNode(null, 'btnnext');
        if (this._btnPrev) this.wireButton(this._btnPrev, '', () => this._turnPage(-1));
        if (this._btnNext) this.wireButton(this._btnNext, '', () => this._turnPage(1));
        this._setupTabs();
        this.collectionBar ??= this.findChildDeep(this.node, 'haveCollected_sliderBG');
        this._barFill = this.collectionBar?.getChildByName('haveCollected_slider') ?? null;
        const fillUi = this._barFill?.getComponent(UITransform);
        if (fillUi && this._barFill) {
            this._barWidth = fillUi.width;
            this._barLeft = this._barFill.position.x - fillUi.width * fillUi.anchorX;
        }
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
        this._openVersion++;
        this._filter = 'all';
        this._page = 0;
        this._loadFoods();
    }

    protected onClose(): void {
        this._openVersion++;
        this._clearCards();
    }

    protected onDisable(): void {
        this._openVersion++;
        this._clearCards();
        super.onDisable();
    }

    public rebuild(): void {
        this._clearCards();
        const root = (this.listRoot?.isValid ? this.listRoot : null) ?? this.node;
        // 模板：优先 Inspector 绑定，其次 List 下的 Item / Card1（关卡卡结构同套命名）
        const template = this.itemTemplate ?? root.getChildByName('Item') ?? root.getChildByName('Card1');

        const pages = this._pages();
        const pageCount = pages.length;
        this._page = Math.max(0, Math.min(this._page, pageCount - 1));
        for (const child of root.children) {
            if (/^(Item|Card\d*)$/.test(child.name)) child.active = false;
        }
        (pages[this._page] ?? []).forEach((item, index) => {
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

        root.getComponent(Layout)?.updateLayout();
        this._updatePager();
        this._updateTabs();
    }

    // ------------------------------------------------------------------
    // 翻页
    // ------------------------------------------------------------------

    private _pageCount(): number {
        return this._pages().length;
    }

    /** 先筛选再统一分页；保留收藏优先级与 ID 顺序，不按类别拆页。 */
    private _pages(): CollectItem[][] {
        const items = this._filteredItems();
        const pages: CollectItem[][] = [];
        for (let start = 0; start < items.length; start += PAGE_SIZE) pages.push(items.slice(start, start + PAGE_SIZE));
        return pages;
    }

    private _filteredItems(): CollectItem[] {
        return this._filter === 'all' ? this.items : this.items.filter(item => item.category === this._filter);
    }

    private _setupTabs(): void {
        const group = this.findChildDeep(this.node, 'Togle');
        this.tabAll ??= group?.getChildByName('Btn_All') ?? null;
        this.tabFood ??= group?.getChildByName('Btn_All-001') ?? null;
        this.tabPorcelain ??= group?.getChildByName('Btn_All-002') ?? null;
        this.selectedTabFrame ??= this.tabAll?.getChildByName('button_primary')?.getComponent(Sprite)?.spriteFrame ?? null;
        this.normalTabFrame ??= this.tabFood?.getChildByName('button_primary')?.getComponent(Sprite)?.spriteFrame ?? null;
        for (const [button, filter] of [[this.tabAll, 'all'], [this.tabFood, 'food'], [this.tabPorcelain, 'porcelain']] as const) {
            // 点击动画沿用 Canvas 的 UIAnimationBinding 和预制体上已绑定的片段。
            if (button) this.wireButton(button, '', () => this._setFilter(filter));
        }
    }

    private _setFilter(filter: CollectFilter): void {
        if (this._filter === filter) return;
        this._filter = filter;
        this._page = 0;
        this.rebuild();
    }

    private _updateTabs(): void {
        for (const [button, filter] of [[this.tabAll, 'all'], [this.tabFood, 'food'], [this.tabPorcelain, 'porcelain']] as const) {
            const sprite = button?.getChildByName('button_primary')?.getComponent(Sprite);
            const frame = filter === this._filter ? this.selectedTabFrame : this.normalTabFrame;
            if (sprite && frame) sprite.spriteFrame = frame;
        }
    }

    private _turnPage(delta: number): void {
        const next = this._page + delta;
        if (next < 0 || next >= this._pageCount()) return;
        this._page = next;
        this.rebuild();
    }

    private _updatePager(): void {
        const pageCount = this._pageCount();
        if (this._pageLabel) this._pageLabel.string = `${pageCount > 0 ? this._page + 1 : 0}/${pageCount}`;
        const obtained = this.items.filter(item => item.obtained).length;
        if (this._statsLabel) {
            this._statsLabel.string = `已收藏：${obtained}/${this.items.length}`;
        }
        const fillUi = this._barFill?.getComponent(UITransform);
        if (fillUi && this._barFill) {
            const ratio = this.items.length > 0 ? obtained / this.items.length : 0;
            fillUi.width = this._barWidth * Math.max(0, Math.min(1, ratio));
            this._barFill.setPosition(this._barLeft + fillUi.width * fillUi.anchorX, this._barFill.position.y, this._barFill.position.z);
            this._barFill.active = ratio > 0;
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

        // 副标题沿用模板的城市与获得状态文本区。
        const subLabel = card.getChildByName('CardName')?.getComponent(Label);
        if (subLabel) subLabel.string = `${item.ext?.cityName ?? ''}\n${obtained ? '已获得' : item.ext?.levelKey ? '暂未获得' : '待开放'}`;

        // 未获得时显示模板提供的视频激励入口。
        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = !obtained;
        const tips = card.getChildByName('TipsIcon');
        if (tips) tips.active = obtained && !this.flow.save.hasViewedCollectible(item.id);

        // 图标：ItemIcon 或关卡卡结构的 Mask/Thumbnail，按 Thumbnail 节点尺寸显示；未获得置灰
        const iconNode = card.getChildByName('ItemIcon') ?? this.findChildDeep(card, 'Thumbnail');
        if (iconNode) {
            const sprite = iconNode.getComponent(Sprite);
            if (sprite) sprite.grayscale = !obtained;
            void this._loadIcon(iconNode, item.icon, item, card);
        }

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, this.buttonTouchHandler(card, () => { void this._onItemClick(item); }), this);
    }

    private async _loadIcon(icon: Node, path: string, item: CollectItem, card: Node): Promise<void> {
        const version = this._renderVersion;
        try {
            const frame = await this.flow.loadPageSpriteFrame(path, this.node);
            if (version !== this._renderVersion || !frame?.isValid || !this.node.activeInHierarchy || !icon.isValid) return;
            let sprite = icon.getComponent(Sprite);
            if (!sprite) sprite = icon.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            if (icon.isValid) sprite.spriteFrame = frame;
            if (item.obtained && !this.flow.save.hasViewedCollectible(item.id)) this._queueSeen(item.id, card);
        } catch {
            // 图标缺失时保持模板原样
        }
    }

    private _queueSeen(id: string, card: Node): void {
        this._seenReady.set(id, card);
        if (this._seenScheduled) return;
        this._seenScheduled = true;
        // 图片显示后的下一帧才清除标记，当前会话不按已读状态重新排序。
        this.scheduleOnce(this._flushSeen, 0);
    }

    private _flushSeen(): void {
        this._seenScheduled = false;
        if (!this.node.activeInHierarchy) { this._seenReady.clear(); return; }
        const viewport = this.listRoot?.getComponent(UITransform)?.getBoundingBoxToWorld();
        const visible = Array.from(this._seenReady).filter(([, card]) => {
            if (!card.isValid || !card.activeInHierarchy) return false;
            const bounds = card.getComponent(UITransform)?.getBoundingBoxToWorld();
            return !viewport || (!!bounds && viewport.intersects(bounds));
        });
        this._seenReady.clear();
        if (!this.flow.save.markCollectiblesViewed(visible.map(([id]) => id))) return;
        for (const [, card] of visible) {
            const tips = card.getChildByName('TipsIcon');
            if (tips) tips.active = false;
        }
    }

    private async _onItemClick(item: CollectItem): Promise<void> {
        if (this.flow.save.isCollectibleObtained(item.id, String(item.ext?.levelKey ?? ''))) {
            this._openModal(item);
            return;
        }
        if (this._unlockPending) return;
        const version = this._openVersion;
        this._unlockPending = true;
        try {
            const unlocked = await this.flow.requestCollectibleUnlock(item.id);
            if (!unlocked || !this.isValid || !this.node.activeInHierarchy || version !== this._openVersion) return;
            this._page = 0;
            this._loadFoods();
        } finally { this._unlockPending = false; }
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
        this._renderVersion++;
        this.unschedule(this._flushSeen);
        this._seenScheduled = false;
        this._seenReady.clear();
        this.flow.releasePageSpriteFrames(this.node);
        for (const card of this._cards) { card.active = false; card.removeFromParent(); card.destroy(); }
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

    private _loadFoods(): void {
        this.items = this.flow.foods.map((food, index) => {
            const obtained = this.flow.save.isCollectibleObtained(food.id, food.levelKey);
            return {
                id: food.id, name: food.name, desc: food.desc, icon: food.icon,
                category: food.category ?? 'food',
                obtained, newlyObtained: obtained && !this.flow.save.hasViewedCollectible(food.id),
                ext: { cityName: food.cityName, levelKey: food.levelKey },
                catalogOrder: index,
            };
        }).sort((a, b) => Number(b.newlyObtained) - Number(a.newlyObtained)
            || Number(b.obtained) - Number(a.obtained)
            || a.id.localeCompare(b.id, 'en', { numeric: true }) || a.catalogOrder - b.catalogOrder);
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
