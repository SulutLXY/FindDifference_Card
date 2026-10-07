import { _decorator, Label, Node } from 'cc';
import { UIScreen } from './UIScreen';
import { LobbyEntries } from './LobbyEntries';
import { FavoriteGift } from './FavoriteGift';
import { APP_VERSION } from '../core/AppVersion';

const { ccclass, property } = _decorator;

/**
 * 大厅界面（Screens/Lobby）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnStart   开始挑战按钮（Node，其下 Label-001 显示「当前第N关」，运行时刷新）
 * - BtnLevels  选择关卡按钮（Node）
 * - BtnRank    排行榜按钮（Node，占位）
 * - BtnCollect 收藏按钮（Node）
 * - Title      游戏标题（Label，可选）
 * - Subtitle   副标题（Label，可选）
 * - FooterEnv  底部环境信息（Label，运行时刷新）
 */
@ccclass('LobbyScreen')
export class LobbyScreen extends UIScreen {
    @property({ type: Node, displayName: 'Setting', tooltip: '主页设置按钮，由场景设计并绑定' })
    public setting: Node | null = null;

    @property({ type: Node, tooltip: '开始挑战按钮（命名 BtnStart）' })
    public btnStart: Node | null = null;

    @property({ type: Node, tooltip: '选择关卡按钮（命名 BtnLevels）' })
    public btnLevels: Node | null = null;

    @property({ type: Node, tooltip: '排行榜按钮（命名 BtnRank，占位）' })
    public btnRank: Node | null = null;

    @property({ type: Node, tooltip: '收藏按钮（命名 BtnCollect）' })
    public btnCollect: Node | null = null;

    @property({ type: Label, tooltip: '当前关卡提示（BtnStart 下的 Label-001，运行时刷新为真实进度）' })
    public currentLevel: Label | null = null;

    @property({ type: Label, tooltip: '底部环境信息（命名 FooterEnv）' })
    public footerEnv: Label | null = null;

    protected onLoad(): void {
        const entryHost = this.flow.node.parent ?? this.node;
        if (!entryHost.getComponent(LobbyEntries)) entryHost.addComponent(LobbyEntries);
        if (!entryHost.getComponent(FavoriteGift)) entryHost.addComponent(FavoriteGift);
        this.wireButton(this.setting, 'Setting', () => this.flow.showSettings(false));
        this.wireButton(this.btnStart, 'BtnStart', () => this.flow.startContinue());
        this.wireButton(this.btnLevels, 'BtnLevels', () => this.flow.showCitySelect());
        this.wireButton(this.btnRank, 'BtnRank', () => this.flow.showRank());
        // 场景按钮名为 Btncollect（小写 c），命名查找与实际节点保持一致
        this.wireButton(this.btnCollect, 'Btncollect', () => this.flow.showCollect());
    }

    protected onOpen(): void {
        const rankButton = this.resolveNode(this.btnRank, 'BtnRank');
        if (rankButton) rankButton.active = !this.flow.platform.isHarmony;
        void this._refreshRankVisibility();
        this.setLabel(this.footerEnv, 'FooterEnv', `当前环境：${this.flow.platform.kind.toUpperCase()}  |  版本号：${APP_VERSION}`);
        // 「城市-关卡名」与开始挑战实际进入的关卡保持一致
        void this._refreshContinueLabel();
    }

    private async _refreshContinueLabel(): Promise<void> {
        const target = await this.flow.findContinueTarget();
        // 关卡名已自带「城市-」前缀（如 北京-08）时不再拼城市名，避免「北京-北京-08」
        const levelName = target ? target.level.name : '';
        const label = target
            ? (levelName.startsWith(`${target.city.name}-`) ? levelName : `${target.city.name}-${levelName}`)
            : '全部通关，恭喜！';
        this.setLabel(this.currentLevel, 'BtnStart/Label-001', label);
    }

    private async _refreshRankVisibility(): Promise<void> {
        const harmony = await this.flow.platform.detectHarmony();
        if (!this.isValid) return;
        const button = this.resolveNode(this.btnRank, 'BtnRank');
        if (button) button.active = !harmony;
    }
}
