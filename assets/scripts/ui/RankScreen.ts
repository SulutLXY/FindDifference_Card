import {
    _decorator,
    Asset,
    Color,
    Graphics,
    ImageAsset,
    Input,
    Label,
    Layout,
    Mask,
    Node,
    ScrollView,
    Size,
    Sprite,
    SpriteFrame,
    Texture2D,
    UITransform,
    assetManager,
    instantiate,
} from 'cc';
import { RankEntry, RankProvider } from '../services/rank/RankProvider';
import { UIColors, UIScreen } from './UIScreen';
import { RANK_LIMIT } from '../services/rank/NpcRankPool';

const { ccclass, property } = _decorator;

/** 本地头像池：条目无远程头像时按名字哈希兜底 */
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
 * 数据源：RankProvider 平台适配层（抖音真实榜单 / 本地兜底），本组件只认 RankEntry 结构。
 * 页签按适配层 supports 显隐：平台拿不到的数据（如受限的好友榜）自动隐藏。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnBack     返回大厅按钮（Node）
 * - TabFriend   好友榜切换按钮（Node）
 * - TabGlobal   全服榜切换按钮（Node）
 * - List        排行列表窗口：代码自动补 Mask 遮罩 + ScrollView 竖向滑动
 * - MyRank      底部「我的排名」条（其下 Label 运行时刷新）
 *
 * 列表条目：优先实例化 List 下的 RankItem1 模板，结构约定：
 * - RankItem 自身 Sprite 保留模板背景，不按名次替换
 * - RankBadge    Label，名次数字（1-3 名金/银/铜色）；其下子节点 icon_first / icon_second /
 *   icon_third 按名次只显示对应一枚，其余名次三个全隐藏
 * - Avatar       头像 Sprite（远程头像加载失败时按名字哈希用本地头像池）
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
    private _provider: RankProvider | null = null;
    private _refreshRequest = 0;
    private _status: Label | null = null;
    private _selfRank = 0;
    private _profileLoading = false;

    protected onLoad(): void {
        this._provider = this.flow.rankProvider;
        this.wireButton(this.btnBack, 'BtnBack', () => this.flow.showLobby());
        this.wireButton(this.tabFriend, 'TabFriend', () => this._switchTab('friend'));
        this.wireButton(this.tabGlobal, 'TabGlobal', () => this._switchTab('global'));
        this._setupScrollContainer();
        if (this.flow.platform.kind === 'douyin') {
            this.wireButton(null, 'MyRank', () => { void this._requestProfile(); });
        }
    }

    protected onOpen(): void {
        const provider = this._requireProvider();
        // 按平台支持度显隐页签；当前页签不可用时切换到可用页签
        const friendOk = provider.supports('friend');
        const globalOk = provider.supports('global');
        const tabFriendNode = this.resolveNode(this.tabFriend, 'TabFriend');
        const tabGlobalNode = this.resolveNode(this.tabGlobal, 'TabGlobal');
        if (tabFriendNode) tabFriendNode.active = friendOk;
        if (tabGlobalNode) tabGlobalNode.active = globalOk;
        if (!provider.supports(this._tab)) {
            this._tab = globalOk ? 'global' : 'friend';
        }
        this._refreshTabStyle();
        void this._refresh();
    }

    protected onClose(): void {
        this._refreshRequest++;
        this._clearItems();
    }

    private _requireProvider(): RankProvider {
        if (!this._provider) {
            this._provider = this.flow.rankProvider;
        }
        return this._provider;
    }

    private _switchTab(tab: 'friend' | 'global'): void {
        if (!this._requireProvider().supports(tab)) return;
        this._tab = tab;
        this._refreshTabStyle();
        void this._refresh();
    }

    /** 从适配层拉取榜单并渲染，刷新底部我的排名。 */
    private async _refresh(): Promise<void> {
        const request = ++this._refreshRequest;
        this._clearItems();
        if (this._status) this._status.node.active = true;
        const provider = this._requireProvider();
        this._selfRank = 0;
        this._refreshPlayer();
        if (this._status) this._status.string = '正在获取排行榜…';
        const result = await provider.fetch(this._tab);
        if (!this.isValid || !this.node.activeInHierarchy || request !== this._refreshRequest) return;
        if (!result.available) {
            // 数据不可用（如平台受限）：榜单留空，仅保留底部我的排名
            this.setLabel(this.myRankLabel, 'MyRank/Rank', '未上榜');
            if (this._status) this._status.string = result.message ?? '排行榜获取失败，点击页签重试';
            return;
        }

        const root = this.resolveNode(this.listRoot, 'List') ?? this.node;
        const container = this._content ?? root;
        const template = root.getChildByName('RankItem1');

        const entries = result.entries.slice(0, RANK_LIMIT);
        entries.forEach((row, index) => {
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

        const myIndex = entries.findIndex(row => row.isSelf);
        const myRow = myIndex >= 0 ? entries[myIndex] : result.self;
        // MyRank 结构：Label=标题（不刷新）、Rank=名次、Label-001=成绩、playerName=名字
        this._selfRank = myIndex >= 0 ? myIndex + 1 : 0;
        this.setLabel(this.myRankLabel, 'MyRank/Rank', this._selfRank ? String(this._selfRank) : '未上榜');
        this.setLabel(null, 'MyRank/Label-001', `${myRow?.passed ?? this.flow.save.totalScore}关`);
        if (this._status) this._status.string = result.message ?? (entries.length ? '仅展示前99位' : '暂无好友上榜');
        container.getComponent(Layout)?.updateLayout();
        this._scrollToTop();
    }

    private _refreshPlayer(): void {
        this.setLabel(this.myRankLabel, 'MyRank/Rank', this._selfRank ? String(this._selfRank) : '未上榜');
        this.setLabel(null, 'MyRank/Label-001', `${this.flow.save.totalScore}关`);
        const profile = this.flow.platform.playerInfo.profile;
        this.setLabel(null, 'MyRank/playerName', profile?.nickName ?? '点击授权昵称头像');
        const row = this.node.getChildByName('MyRank');
        const avatar = row?.getChildByName('Icon _head');
        if (avatar && profile?.avatarUrl) {
            void this._loadRemoteAvatar(profile.avatarUrl).then(frame => {
                if (avatar.isValid) {
                    const sprite = avatar.getComponent(Sprite);
                    if (sprite) sprite.spriteFrame = frame;
                }
            }).catch(() => undefined);
        }
    }

    private async _requestProfile(): Promise<void> {
        if (this._profileLoading) return;
        this._profileLoading = true;
        try {
            const result = await this.flow.platform.playerInfo.requestProfile();
            if (!this.isValid || !this.node.activeInHierarchy) return;
            this._refreshPlayer();
            if (result.success === false) {
                this.flow.toast(result.message);
                console.warn('[RankScreen] 玩家资料获取失败', result.reason, result.message);
            }
        } finally { this._profileLoading = false; }
    }

    private _fillItem(item: Node, row: RankEntry, rank: number): void {
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

        // 名次徽章图标：RankBadge 下 icon_first / icon_second / icon_third 按名次只亮一枚
        const badgeNode = item.getChildByName('RankBadge');
        ['icon_first', 'icon_second', 'icon_third'].forEach((iconName, index) => {
            const icon = badgeNode?.getChildByName(iconName);
            if (icon) icon.active = index + 1 === rank;
        });

        const name = item.getChildByName('PlayerName')?.getComponent(Label);
        if (name) name.string = row.name;
        if (row.isNpc) {
            const marker = new Node('NpcLabel');
            marker.layer = item.layer;
            item.addChild(marker);
            marker.setPosition(-130, -30);
            marker.addComponent(UITransform).setContentSize(65, 16);
            const label = marker.addComponent(Label);
            label.string = 'NPC'; label.fontSize = 12;
            label.color = new Color(150, 123, 80, 255);
        }

        const score = item.getChildByName('Score')?.getComponent(Label);
        if (score) score.string = `${row.passed}关`;

        // 头像：优先远程头像，失败按名字哈希用本地头像池
        void this._loadAvatar(item, row);

        // 背景及姓名、成绩字体颜色由模板控制，不对本人条目改色。
    }

    /** 头像：有远程地址直接加载，失败或为空时按名字哈希用本地头像池。 */
    private _loadAvatar(item: Node, row: RankEntry): void {
        const avatar = item.getChildByName('Avatar');
        if (!avatar) return;
        const apply = (frame: SpriteFrame): void => {
            if (!avatar.isValid) return;
            let sprite = avatar.getComponent(Sprite);
            if (!sprite) sprite = avatar.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
        };
        if (row.avatarUrl) {
            this._loadRemoteAvatar(row.avatarUrl).then(frame => {
                if (avatar.isValid) apply(frame);
            }).catch(() => this._loadPoolAvatar(avatar, row.name, apply));
        } else {
            this._loadPoolAvatar(avatar, row.name, apply);
        }
    }

    /** 远程头像（抖音头像等 https 地址）。 */
    private _loadRemoteAvatar(url: string): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            assetManager.loadRemote(url, { ext: '.jpg' }, (error: Error | null, asset: Asset) => {
                if (error || !asset) {
                    reject(error ?? new Error('远程头像加载失败'));
                    return;
                }
                const frame = new SpriteFrame();
                frame.texture = new Texture2D();
                (frame.texture as Texture2D).image = asset as ImageAsset;
                resolve(frame);
            });
        });
    }

    /** 本地头像池：名字哈希取模分配，同一玩家每次进入头像一致。 */
    private _loadPoolAvatar(avatar: Node, name: string, apply: (frame: SpriteFrame) => void): void {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
        }
        const path = AVATARS[hash % AVATARS.length];
        void this.flow.loadSpriteFrame(path).then(apply).catch(() => {
            // 头像缺失则保留空 Sprite
        });
    }

    private _refreshTabStyle(): void {
        this._styleTab(this.resolveNode(this.tabFriend, 'TabFriend'), this._tab === 'friend');
        this._styleTab(this.resolveNode(this.tabGlobal, 'TabGlobal'), this._tab === 'global');
    }

    private _styleTab(node: Node | null, selected: boolean): void {
        if (!node) return;
        // 选中显示 TabBG 底图，未选中隐藏；字体样式由场景模板控制，切换时不再改色
        const bg = node.getChildByName('TabBG');
        if (bg) bg.active = selected;
    }

    /** 同选关：List 改造为 Mask + ScrollView，Content 竖向排列、高度自适应。 */
    private _setupScrollContainer(): void {
        const root = this.resolveNode(this.listRoot, 'List');
        if (!root) return;
        const rootUi = root.getComponent(UITransform);
        if (this.flow.platform.kind === 'douyin') {
            const hint = new Node('RankStatus');
            hint.layer = root.layer;
            root.addChild(hint);
            hint.addComponent(UITransform).setContentSize(rootUi?.width ?? 660, 34);
            hint.setPosition(0, (1 - (rootUi?.anchorY ?? 0.5)) * (rootUi?.height ?? 817) - 17);
            const label = hint.addComponent(Label);
            label.string = '正在获取排行榜…';
            label.fontSize = 24;
            label.lineHeight = 36;
            label.color = new Color(65, 72, 95, 255);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            this._status = label;
        }
        // 编辑器内的示例条目只作为模板，不参与实际榜单显示。
        for (const child of root.children) {
            if (/^RankItem\d+$/.test(child.name)) child.active = false;
        }

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
            this._content.layer = root.layer;
            this._content.parent = root;
            const ui = this._content.addComponent(UITransform);
            const size = rootUi?.contentSize ?? new Size(750, 1334);
            ui.setContentSize(size.width, size.height);
            ui.setAnchorPoint(0.5, 1);
            this._content.setPosition(0, (1 - (rootUi?.anchorY ?? 0.5)) * size.height);
            const layout = this._content.addComponent(Layout);
            layout.type = Layout.Type.VERTICAL;
            layout.resizeMode = Layout.ResizeMode.CONTAINER;
            layout.spacingY = 12;
            layout.paddingTop = this.flow.platform.kind === 'douyin' ? 44 : 10;
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

    /** 无模板时的内置简易条目（白底圆角条 + 命名 Label）。 */
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
