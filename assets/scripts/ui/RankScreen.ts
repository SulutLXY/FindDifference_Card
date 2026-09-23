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
import { UIColors, UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

interface RankRow {
    name: string;
    /** 通关关卡数 */
    passed: number;
    /** 总星数（排序用） */
    stars: number;
    /** 通关总用时，秒（排序用） */
    time: number;
    isSelf?: boolean;
}

/** 假数据：好友榜（阶段 D 替换为平台真实数据） */
const FRIEND_RANK: RankRow[] = [
    { name: '星河', passed: 10, stars: 28, time: 640 },
    { name: '小鹿', passed: 10, stars: 26, time: 700 },
    { name: '阿团', passed: 9, stars: 24, time: 730 },
    { name: '青禾', passed: 9, stars: 22, time: 780 },
    { name: '木木', passed: 8, stars: 20, time: 820 },
    { name: '北辰', passed: 8, stars: 18, time: 860 },
    { name: '夏雨', passed: 7, stars: 16, time: 900 },
    { name: '小满', passed: 6, stars: 13, time: 980 },
    { name: '云朵', passed: 5, stars: 10, time: 1050 },
    { name: '南风', passed: 4, stars: 8, time: 1150 },
];

/** 假数据：全服榜 */
const GLOBAL_RANK: RankRow[] = [
    { name: '王者之眼', passed: 10, stars: 30, time: 560 },
    { name: '无敌手速', passed: 10, stars: 29, time: 590 },
    { name: '找茬宗师', passed: 10, stars: 29, time: 610 },
    { name: '全服第四', passed: 10, stars: 28, time: 630 },
    { name: '夜猫子', passed: 10, stars: 27, time: 660 },
    { name: '晨光', passed: 10, stars: 26, time: 690 },
    { name: '风中追风', passed: 9, stars: 25, time: 720 },
    { name: '小火慢炖', passed: 9, stars: 24, time: 750 },
    { name: '像素骑士', passed: 9, stars: 23, time: 790 },
    { name: '路过', passed: 8, stars: 21, time: 830 },
];

/** 临时头像池（阶段 D 接入真实头像数据后移除）：UI_Sprite/V3/Texture 下六张头像 */
const AVATARS = [
    'textures/UI_Sprite/V3/Texture/Icon _head_M01/spriteFrame',
    'textures/UI_Sprite/V3/Texture/Icon _head_M02/spriteFrame',
    'textures/UI_Sprite/V3/Texture/Icon _head_M03/spriteFrame',
    'textures/UI_Sprite/V3/Texture/Icon _head_F01/spriteFrame',
    'textures/UI_Sprite/V3/Texture/Icon _head_F02/spriteFrame',
    'textures/UI_Sprite/V3/Texture/Icon _head_F03/spriteFrame',
];

/**
 * 排行榜界面（Screens/Rank）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack     返回大厅按钮（Node）
 * - TabFriend   好友榜切换按钮（Node）
 * - TabGlobal   全服榜切换按钮（Node）
 * - List        排行列表窗口：代码自动补 Mask 遮罩 + ScrollView 竖向滑动
 * - MyRank      底部「我的排名」条（其下 Label 运行时刷新）
 *
 * 列表条目：优先实例化 List 下的 RankItem1 模板，结构约定：
 * - RankBadge    Label，名次（1-3 名金/银/铜色）
 * - PlayerName   Label，玩家名
 * - Score        Label，成绩（"X关"）
 * 无模板时使用内置简易条目（同样按上述命名建 Label）。
 */
@ccclass('RankScreen')
export class RankScreen extends UIScreen {
    @property({ type: Node, tooltip: '返回大厅按钮（命名 BtnBack）' })
    public btnBack: Node | null = null;

    @property({ type: Node, tooltip: '好友榜 Tab（命名 TabFriend）' })
    public tabFriend: Node | null = null;

    @property({ type: Node, tooltip: '全服榜 Tab（命名 TabGlobal）' })
    public tabGlobal: Node | null = null;

    @property({ type: Node, tooltip: '排行列表窗口（命名 List）' })
    public listRoot: Node | null = null;

    @property({ type: Label, tooltip: '我的排名文字（命名 MyRank 下的 Label）' })
    public myRankLabel: Label | null = null;

    private _tab: 'friend' | 'global' = 'friend';
    private _items: Node[] = [];
    private _content: Node | null = null;

    protected onLoad(): void {
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this.wireButton(this.tabFriend, 'TabFriend', () => this._switchTab('friend'));
        this.wireButton(this.tabGlobal, 'TabGlobal', () => this._switchTab('global'));
        this._setupScrollContainer();
    }

    protected onOpen(): void {
        this._refreshTabStyle();
        this._refresh();
    }

    protected onClose(): void {
        this._clearItems();
    }

    private _switchTab(tab: 'friend' | 'global'): void {
        if (this._tab === tab) return;
        this._tab = tab;
        this._refreshTabStyle();
        this._refresh();
    }

    /** 重建榜单：假数据 + 自己的真实成绩混排，刷新底部我的排名。 */
    private _refresh(): void {
        this._clearItems();
        const rows = this._buildRows();
        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = root.getChildByName('RankItem1');

        rows.forEach((row, index) => {
            let item: Node;
            if (template) {
                item = instantiate(template);
                item.name = `RankItem-${index + 1}`;
            } else {
                item = this._buildFallbackItem();
            }
            this._items.push(item);
            item.parent = container;
            item.active = true;
            this._fillItem(item, row, index + 1);
        });

        const myIndex = rows.findIndex(row => row.isSelf);
        const myRow = myIndex >= 0 ? rows[myIndex] : null;
        // MyRank 结构：Label=标题（不刷新）、Rank=名次、Label-001=成绩、playerName=名字
        this.setLabel(null, 'MyRank/Rank', myRow ? String(myIndex + 1) : '--');
        this.setLabel(null, 'MyRank/Label-001', myRow ? `${myRow.passed}关` : '--');
        this._scrollToTop();
    }

    /** 榜单数据：当前 Tab 的假数据 + 自己，按 通关数 → 总星数 → 总用时 排序。 */
    private _buildRows(): RankRow[] {
        const source = this._tab === 'friend' ? FRIEND_RANK : GLOBAL_RANK;
        const rows = source.map(row => ({ ...row }));
        rows.push(this._myRow());
        rows.sort((a, b) => b.passed - a.passed || b.stars - a.stars || a.time - b.time);
        return rows;
    }

    private _myRow(): RankRow {
        const levels = this.flow.save.data.levels;
        let passed = 0;
        let stars = 0;
        let time = 0;
        for (const key of Object.keys(levels)) {
            const progress = levels[key];
            if (progress && progress.stars > 0) {
                passed += 1;
                stars += progress.stars;
                time += progress.bestTime;
            }
        }
        return { name: '我', passed, stars, time, isSelf: true };
    }

    private _fillItem(item: Node, row: RankRow, rank: number): void {
        const rankColors: Record<number, Color> = {
            1: new Color(249, 177, 34, 255),
            2: new Color(170, 185, 205, 255),
            3: new Color(214, 140, 90, 255),
        };
        const badge = item.getChildByName('RankBadge')?.getComponent(Label);
        if (badge) {
            badge.string = String(rank);
            badge.color = rankColors[rank] ?? new Color(65, 72, 95, 255);
            badge.isBold = rank <= 3;
        }

        const name = item.getChildByName('PlayerName')?.getComponent(Label);
        if (name) name.string = row.name;

        const score = item.getChildByName('Score')?.getComponent(Label);
        if (score) score.string = `${row.passed}关`;

        // 临时头像：按名字哈希从头像池分配（同一玩家头像固定）
        void this._loadAvatar(item, row.name);

        if (row.isSelf) {
            // 自己高亮（条目底色调蓝）
            const graphics = item.getComponent(Graphics);
            if (graphics) {
                graphics.clear();
                graphics.fillColor = new Color(42, 137, 225, 255);
                graphics.roundRect(-330, -46, 660, 92, 16);
                graphics.fill();
            }
            if (name) name.color = Color.WHITE;
            if (score) score.color = Color.WHITE;
        }
    }

    /** 临时头像：名字哈希取模分配，同一玩家每次进入头像一致。 */
    private _loadAvatar(item: Node, name: string): void {
        const avatar = item.getChildByName('Avatar');
        if (!avatar) return;
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
        }
        const path = AVATARS[hash % AVATARS.length];
        void this.flow.loadSpriteFrame(path).then(frame => {
            let sprite = avatar.getComponent(Sprite);
            if (!sprite) sprite = avatar.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
        }).catch(() => {
            // 头像缺失则保留空 Sprite
        });
    }

    private _refreshTabStyle(): void {
        this._styleTab(this.resolveNode(this.tabFriend, 'TabFriend'), this._tab === 'friend');
        this._styleTab(this.resolveNode(this.tabGlobal, 'TabGlobal'), this._tab === 'global');
    }

    private _styleTab(node: Node | null, selected: boolean): void {
        if (!node) return;
        // 选中显示 TabBG 底图，未选中隐藏
        const bg = node.getChildByName('TabBG');
        if (bg) bg.active = selected;
        // 选中字体白色，未选中深蓝色
        const label = node.getComponentInChildren(Label);
        if (!label) return;
        label.color = selected ? Color.WHITE : new Color(30, 60, 130, 255);
        label.isBold = selected;
    }

    /** 同选关：List 改造为 Mask + ScrollView，Content 竖向排列、高度自适应。 */
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
            layout.spacingY = 12;
            layout.paddingTop = 10;
            layout.paddingBottom = 10;
        }

        scrollView.content = this._content;
        scrollView.scrollToTop(0);
    }

    private _scrollToTop(): void {
        this.resolveNode(this.listRoot, 'List')?.getComponent(ScrollView)?.scrollToTop(0.1);
    }

    private _clearItems(): void {
        for (const item of this._items) item.destroy();
        this._items = [];
    }

    /** 无模板时的内置简易条目（白底圆角条 + 三个命名 Label）。 */
    private _buildFallbackItem(): Node {
        const item = new Node('RankItem');
        const ui = item.addComponent(UITransform);
        ui.setContentSize(660, 92);
        const graphics = item.addComponent(Graphics);
        graphics.fillColor = new Color(255, 255, 255, 235);
        graphics.roundRect(-330, -46, 660, 92, 16);
        graphics.fill();

        const addLabel = (name: string, x: number, w: number): Label => {
            const node = new Node(name);
            node.parent = item;
            node.setPosition(x, 0);
            const nodeUi = node.addComponent(UITransform);
            nodeUi.setContentSize(w, 60);
            const label = node.addComponent(Label);
            label.fontSize = 28;
            label.color = new Color(65, 72, 95, 255);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            return label;
        };

        addLabel('RankBadge', -275, 90);
        addLabel('PlayerName', -60, 300);
        addLabel('Score', 265, 120);
        return item;
    }
}
