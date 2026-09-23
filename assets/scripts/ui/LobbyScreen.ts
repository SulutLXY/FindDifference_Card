import { _decorator, Label, Node } from 'cc';
import { UIScreen } from './UIScreen';

const { ccclass, property } = _decorator;

/**
 * 大厅界面（Screens/Lobby）。
 *
 * 命名规则（未拖拽绑定时按此自动查找）：
 * - BtnStart   开始挑战按钮（Node，其下 Label-001 显示「当前第N关」，运行时刷新）
 * - BtnLevels  选择关卡按钮（Node）
 * - BtnRank    排行榜按钮（Node，占位）
 * - Title      游戏标题（Label，可选）
 * - Subtitle   副标题（Label，可选）
 * - FooterEnv  底部环境信息（Label，运行时刷新）
 */
@ccclass('LobbyScreen')
export class LobbyScreen extends UIScreen {
    @property({ type: Node, tooltip: '开始挑战按钮（命名 BtnStart）' })
    public btnStart: Node | null = null;

    @property({ type: Node, tooltip: '选择关卡按钮（命名 BtnLevels）' })
    public btnLevels: Node | null = null;

    @property({ type: Node, tooltip: '排行榜按钮（命名 BtnRank）' })
    public btnRank: Node | null = null;

    @property({ type: Label, tooltip: '当前关卡提示（BtnStart 下的 Label-001，运行时刷新为真实进度）' })
    public currentLevel: Label | null = null;

    @property({ type: Label, tooltip: '游戏标题（命名 Title，可选）' })
    public title: Label | null = null;

    @property({ type: Label, tooltip: '副标题（命名 Subtitle，可选）' })
    public subtitle: Label | null = null;

    @property({ type: Label, tooltip: '底部环境信息（命名 FooterEnv）' })
    public footerEnv: Label | null = null;

    protected onLoad(): void {
        this.wireButton(this.btnStart, 'BtnStart', () => this.flow.startContinue());
        this.wireButton(this.btnLevels, 'BtnLevels', () => this.flow.showLevelSelect());
        this.wireButton(this.btnRank, 'BtnRank', () => this.flow.showRank());
    }

    protected onOpen(): void {
        this.setLabel(this.footerEnv, 'FooterEnv', `当前环境：${this.flow.platform.kind.toUpperCase()}`);
        // 「当前第N关」与开始挑战实际进入的关卡保持一致：最新解锁关（不超过总关卡数）
        const continueId = Math.min(this.flow.save.data.unlockedLevel, this.flow.levels.length);
        this.setLabel(this.currentLevel, 'BtnStart/Label-001', `当前第${continueId}关`);
    }
}
