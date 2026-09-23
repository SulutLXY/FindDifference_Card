import {
    _decorator,
    Color,
    Graphics,
    Input,
    Label,
    Layout,
    Mask,
    Node,
    ScrollView,
    Size,
    Sprite,
    UITransform,
    instantiate,
} from 'cc';
import { CityConfig } from '../core/GameTypes';
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 城市选择界面（Screens/CitySelect）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack     返回大厅按钮（Node）
 * - PageTitle   页面标题（Label，可选）
 * - List        城市卡片窗口：代码自动补 Mask 遮罩 + ScrollView 竖向滑动
 *
 * 城市卡片：优先实例化 List 下的 CityCard1 模板，结构约定：
 * - CityName      Label，城市名
 * - CityProgress  Label，进度「X/Y」
 * - CityBanner    Sprite，城市横幅图（可选，city.json 配 banner 时加载）
 * - LockIcon      锁图标（未解锁时显示，与 CityProgress 互斥）
 * 无模板时使用内置简易卡片。
 *
 * 解锁规则：第一城始终解锁，其余需前一城全部关卡通关。
 */
@ccclass('CitySelectScreen')
export class CitySelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Label, tooltip: '页面标题（命名 PageTitle，可选）' })
    public pageTitle: Label | null = null;

    @property({ type: Node, tooltip: '城市卡片窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 CityCard1' })
    public cardTemplate: Node | null = null;

    private _cards: Node[] = [];
    private _content: Node | null = null;

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this.setLabel(this.pageTitle, 'PageTitle', '选择城市');
        this.rebuild();
    }

    protected onClose(): void {
        this._clearCards();
    }

    public rebuild(): void {
        this._clearCards();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = this.cardTemplate ?? root.getChildByName('CityCard1');

        this.flow.cities.forEach((city, index) => {
            let card: Node;
            if (template) {
                card = instantiate(template);
                card.name = `CityCard-${city.key}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._cards.push(card);
            card.parent = container;
            card.active = true;
            this._fillCard(card, city, index);
        });

        // 隐藏手动参考卡
        for (const child of root.children) {
            if (/^CityCard\d+$/.test(child.name)) child.active = false;
        }
        this._scrollToTop();
    }

    private _fillCard(card: Node, city: CityConfig, cityIndex: number): void {
        const unlocked = this.flow.isCityUnlocked(cityIndex);
        const progress = this.flow.cityProgress(city);

        this._setCardLabel(card, 'CityName', city.name);
        this._setCardLabel(card, 'CityProgress', unlocked ? `${progress.done}/${progress.total}` : '');

        const lock = card.getChildByName('LockIcon');
        if (lock) lock.active = !unlocked;
        if (!unlocked) {
            const prev = this.flow.cities[cityIndex - 1];
            this._setCardLabel(card, 'CityLockTip', prev ? `通关${prev.name}后解锁` : '');
        } else {
            this._setCardLabel(card, 'CityLockTip', progress.done >= progress.total ? '已完成' : '');
        }

        // 横幅图（city.json 配了 banner 才加载）
        if (city.banner) {
            void this._loadBanner(card, city.banner);
        }

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => {
            if (!this.flow.isCityUnlocked(cityIndex)) {
                const prev = this.flow.cities[cityIndex - 1];
                this.flow.toast(prev ? `通关${prev.name}后解锁` : '尚未解锁');
                return;
            }
            void this.flow.enterCity(city);
        }, this);
    }

    private async _loadBanner(card: Node, path: string): Promise<void> {
        const banner = card.getChildByName('CityBanner');
        if (!banner) return;
        try {
            const frame = await this.flow.loadSpriteFrame(path);
            let sprite = banner.getComponent(Sprite);
            if (!sprite) sprite = banner.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            if (banner.isValid) sprite.spriteFrame = frame;
        } catch {
            // 横幅缺失时保持模板原样
        }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = card.getChildByName(name)?.getComponent(Label);
        if (label) label.string = text;
    }

    /** 同选关：List 改造为 Mask + ScrollView，Content 竖向排列。 */
    private _setupScrollContainer(): void {
        const root = this.resolveNode(this.listRoot, 'List');
        if (!root) return;
        const rootUi = root.getComponent(UITransform);

        if (!root.getComponent(Mask)) {
            const mask = root.addComponent(Mask);
            mask.type = Mask.Type.GRAPHICS_RECT;
        }

        const scrollView = root.getComponent(ScrollView) ?? root.addComponent(ScrollView);
        scrollView.horizontal = false;
        scrollView.vertical = true;
        scrollView.inertia = true;

        this._content = root.getChildByName('Content');
        if (!this._content) {
            this._content = new Node('Content');
            this._content.parent = root;
            const ui = this._content.addComponent(UITransform);
            const size = rootUi?.contentSize ?? new Size(750, 1334);
            ui.setContentSize(size.width, size.height);
            const layout = this._content.addComponent(Layout);
            layout.type = Layout.Type.VERTICAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
            layout.spacingY = 16;
            layout.paddingTop = 10;
            layout.paddingBottom = 10;
        }

        scrollView.content = this._content;
        scrollView.scrollToTop(0);
    }

    private _scrollToTop(): void {
        this.resolveNode(this.listRoot, 'List')?.getComponent(ScrollView)?.scrollToTop(0.1);
    }

    private _clearCards(): void {
        for (const card of this._cards) card.destroy();
        this._cards = [];
    }

    /** 无模板时的内置简易城市卡。 */
    private _buildFallbackCard(): Node {
        const card = new Node('CityCard');
        const ui = card.addComponent(UITransform);
        ui.setContentSize(660, 220);
        const graphics = card.addComponent(Graphics);
        graphics.fillColor = UIColors.panel;
        graphics.roundRect(-330, -110, 660, 220, 24);
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = UIColors.gold;
        graphics.roundRect(-330, -110, 660, 220, 24);
        graphics.stroke();

        const addLabel = (name: string, x: number, y: number, w: number, h: number, size: number): Label => {
            const node = new Node(name);
            node.parent = card;
            node.setPosition(x, y);
            const nodeUi = node.addComponent(UITransform);
            nodeUi.setContentSize(w, h);
            const label = node.addComponent(Label);
            label.fontSize = size;
            label.color = Color.WHITE;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            return label;
        };

        addLabel('CityName', -180, 30, 280, 70, 40);
        addLabel('CityProgress', 200, 30, 200, 60, 30);
        addLabel('CityLockTip', 0, -60, 560, 50, 24);
        return card;
    }
}
