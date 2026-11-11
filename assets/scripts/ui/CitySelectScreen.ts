import {
    _decorator,
    Color,
    Graphics,
    EventTouch,
    Input,
    Label,
    Layout,
    Mask,
    Node,
    Prefab,
    ScrollView,
    Size,
    Sprite,
    SpriteFrame,
    UITransform,
    instantiate,
} from 'cc';
import { ChapterSelection } from '../core/GameTypes';
import { EnergyDisplay } from './EnergyDisplay';
import { UIColors, UIScreen } from './UIScreen';
import { formatPlayCount } from '../core/PlayStats';

const { ccclass, property } = _decorator;

/**
 * 城市选择界面（Screens/CitySelect）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack     返回大厅按钮（Node）
 * - PageTitle   页面标题（Label，可选）
 * - List        城市卡片窗口：代码自动补 Mask 遮罩 + ScrollView 竖向滑动
 *
 * 城市卡片：按以下优先级实例化，填充结构约定：
 * 1. Inspector 绑定 cardPrefab（Prefab 预制体，推荐，素材做好后直接拖入）
 * 2. Inspector 绑定 cardTemplate 或 List 下的 CityCard（旧名 CityCard1）节点
 * 3. 无模板时使用内置简易卡片
 * - CityName      Label，城市名
 * - CityProgress  Label，进度「X/Y」，前方固定文本（如「已完成：」）由模板自带 Label 承担
 * - Levelnumber   Label，关卡范围（按本章编号）
 * - rank_row      进度条底槽 + 子节点 rank_row-001 填充条（锚点靠左，代码按进度改宽度）
 * - CityBanner    Sprite，章节封面包中的 banner，由首包章节索引指定
 * - LockIcon      旧模板锁图标，运行时隐藏
 * - icon_treasure_chest  宝箱图标（可选），当前章节或分组包含藏品时显示
 *
 * 顶层专题直接进入；分组内的城市按默认开放/永久视频解锁规则显示入口。
 */
@ccclass('CitySelectScreen')
export class CitySelectScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Label, tooltip: '页面标题（命名 PageTitle，可选）' })
    public pageTitle: Label | null = null;

    @property({ type: Node, tooltip: '城市卡片窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Node, tooltip: '卡片模板（可选）。不绑定时自动使用 List 下的 CityCard' })
    public cardTemplate: Node | null = null;

    @property({ type: Prefab, tooltip: '城市卡片预制体（可选）。绑定后优先使用，无需在场景 List 下摆放 CityCard1' })
    public cardPrefab: Prefab | null = null;
    @property({ type: SpriteFrame, tooltip: '最新章节的叶子图标' }) public newChapterIcon: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: '最新章节的绿色文字背景' }) public newChapterBackground: SpriteFrame | null = null;

    private _cards: Node[] = [];
    private _content: Node | null = null;
    private _heatVersion = 0;

    protected onLoad(): void {
        void EnergyDisplay.attach(this.node);
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.backFromCitySelection());
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this.rebuild();
    }

    protected onClose(): void {
        this._clearCards();
    }

    public rebuild(): void {
        this.setLabel(this.pageTitle, 'PageTitle', this.flow.chapterSelectionTitle);
        this._clearCards();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = this.cardTemplate
            ?? root.getChildByName('CityCard')
            ?? root.getChildByName('CityCard1');

        this.flow.chapterSelections.forEach(city => {
            let card: Node;
            if (this.cardPrefab) {
                card = instantiate(this.cardPrefab);
                card.name = `CityCard-${city.key}`;
            } else if (template) {
                card = instantiate(template);
                card.name = `CityCard-${city.key}`;
            } else {
                card = this._buildFallbackCard();
            }
            this._cards.push(card);
            card.parent = container;
            card.active = true;
            this._fillCard(card, city);
        });

        // 隐藏手动参考卡
        for (const child of root.children) {
            if (/^CityCard\d*$/.test(child.name)) child.active = false;
        }
        this._scrollToTop();
        void this._refreshHeat();
    }

    private _fillCard(card: Node, city: ChapterSelection): void {
        const group = 'chapters' in city;
        const unlocked = group || this.flow.isCityUnlocked(this.flow.cities.indexOf(city));
        const progress = this.flow.selectionProgress(city);
        const treasure = this.findChildDeep(card, 'icon_treasure_chest');
        if (treasure) treasure.active = this.flow.selectionHasCollectibles(city);
        this._setHeatBadge(card, city.key, this.flow.playStats?.initialCount(city.key) ?? null);
        const progressPoint = this.findChildDeep(card, 'ProgressPoint');
        const unlockButton = this.findChildDeep(card, 'BtnUnlock');
        if (progressPoint) progressPoint.active = unlocked;
        if (unlockButton) {
            unlockButton.active = !unlocked;
            unlockButton.off(Input.EventType.TOUCH_END, undefined, this);
            if (!unlocked) unlockButton.on(Input.EventType.TOUCH_END, (event?: EventTouch) => {
                if (event) event.propagationStopped = true;
                void this.flow.enterChapterSelection(city);
            }, this);
            const label = unlockButton.getComponentInChildren(Label);
            if (label) label.string = '看视频解锁';
        }

        this._setCardLabel(card, 'CityName', city.name);
        this._setCardLabel(card, 'CityProgress', `${progress.done}/${progress.total}`);
        this._setCardLabel(card, 'Levelnumber', group ? `${city.chapters.length}个城市 · ${progress.total}关`
            : !unlocked ? '观看1个视频永久解锁' : progress.total > 0 ? `${city.name}1-${progress.total}关` : '');
        const rangeLabel = this.findChildDeep(card, 'Levelnumber')?.getComponent(Label);
        if (rangeLabel) {
            rangeLabel.enableWrapText = false;
            rangeLabel.overflow = Label.Overflow.SHRINK;
        }
        const cityAim = this.findChildDeep(card, 'Cityaim')?.getComponent(Sprite);
        if (cityAim) cityAim.grayscale = !unlocked;

        // 进度条保留10%起始填充，实际完成比例映射到其余90%；数字仍显示真实进度。
        const barRoot = this.findChildDeep(card, 'rank_row');
        const barRootUi = barRoot?.getComponent(UITransform);
        const fillUi = barRoot?.getChildByName('rank_row-001')?.getComponent(UITransform);
        if (barRootUi && fillUi) {
            const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.done / progress.total)) : 0;
            fillUi.width = barRootUi.width * (0.1 + ratio * 0.9);
        }

        // 顶层专题不锁定，城市子章节显示真实资格。
        for (const name of ['LockIcon', 'CityLockTip']) {
            const lock = this.findChildDeep(card, name);
            if (lock) lock.active = !unlocked;
        }
        this._setCardLabel(card, 'CityLockTip', unlocked ? '' : '看视频解锁该城市');
        const bannerSprite = this.findChildDeep(card, 'CityBanner')?.getComponent(Sprite);
        if (bannerSprite) bannerSprite.grayscale = !unlocked;
        void this._loadBanner(card, city.banner || `chapter-covers/${city.key}-icon/spriteFrame`, !unlocked);

        card.off(Input.EventType.TOUCH_END);
        card.on(Input.EventType.TOUCH_END, () => {
            void this.flow.enterChapterSelection(city);
        }, this);
    }

    private async _loadBanner(card: Node, path: string, grayscale = false): Promise<void> {
        const banner = this.findChildDeep(card, 'CityBanner');
        if (!banner) return;
        try {
            const frame = await this.flow.loadPageSpriteFrame(path, this.node);
            if (!frame?.isValid || !this.node.activeInHierarchy || !banner.isValid) return;
            let sprite = banner.getComponent(Sprite);
            if (!sprite) sprite = banner.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.grayscale = grayscale;
            if (banner.isValid) {
                sprite.spriteFrame = frame;
                console.log(`[CitySelect] banner-loaded path=${path}`);
            }
        } catch {
            // 横幅缺失时保持模板原样
        }
    }

    private _setHeatBadge(card: Node, key: string, count: number | null): void {
        const badge = this.findChildDeep(card, 'HotNumber');
        const label = badge && this.findChildDeep(badge, 'HotNumber_laber')?.getComponent(Label);
        if (!badge || !label) return;
        label.enableWrapText = false;
        label.overflow = Label.Overflow.SHRINK;
        if (this.flow.playStats?.isNewChapter(key)) {
            label.string = '最新章节';
            const icon = this.findChildDeep(badge, 'icon_fire')?.getComponent(Sprite);
            const background = badge.getComponent(Sprite);
            if (icon && this.newChapterIcon) { icon.sizeMode = Sprite.SizeMode.CUSTOM; icon.spriteFrame = this.newChapterIcon; }
            if (background && this.newChapterBackground) { background.sizeMode = Sprite.SizeMode.CUSTOM; background.spriteFrame = this.newChapterBackground; }
            badge.active = true;
        } else {
            label.string = count == null ? '' : formatPlayCount(count);
            badge.active = label.string.length > 0;
        }
    }

    private async _refreshHeat(): Promise<void> {
        const version = ++this._heatVersion;
        const selections = [...this.flow.chapterSelections], cards = [...this._cards];
        const keys = selections.filter(city => !this.flow.playStats?.isNewChapter(city.key)).map(city => city.key);
        if (!this.flow.playStats || !keys.length) return;
        try {
            const counts = await this.flow.playStats.getCounts(keys);
            if (!this.isValid || !this.node.activeInHierarchy || version !== this._heatVersion) return;
            selections.forEach((city, index) => {
                if (cards[index]?.isValid) this._setHeatBadge(cards[index], city.key, counts[city.key] ?? null);
            });
        } catch (error) { console.warn('[CitySelect] 热度刷新失败', error); }
    }

    private _setCardLabel(card: Node, name: string, text: string): void {
        const label = this.findChildDeep(card, name)?.getComponent(Label);
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
        this._heatVersion++;
        this.flow.releasePageSpriteFrames(this.node);
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
