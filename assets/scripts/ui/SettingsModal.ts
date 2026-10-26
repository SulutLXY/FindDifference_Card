import { _decorator, BlockInputEvents, Label, Toggle } from 'cc';
import { UIScreen } from './UIScreen';
import { LobbyEntries } from './LobbyEntries';

const { ccclass } = _decorator;

@ccclass('SettingsModal')
export class SettingsModal extends UIScreen {
    protected onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.wireButton(null, 'BtnClose', () => this.flow.closeSettings());
        this.wireButton(null, 'BtnPrimary', () => this.flow.continueFromSettings());
        this.wireButton(null, 'BtnHome', () => this.flow.returnToLobby());
        const music = this.resolveNode(null, 'icon_BGmusic/Choice')?.getComponent(Toggle);
        const sound = this.resolveNode(null, 'icon_ComboSound/Choice')?.getComponent(Toggle);
        music?.node.on(Toggle.EventType.TOGGLE, () => this.flow.setMusicEnabled(music.isChecked), this);
        sound?.node.on(Toggle.EventType.TOGGLE, () => this.flow.setSoundEnabled(sound.isChecked), this);
    }

    public present(inGame: boolean): void {
        const homeLabel = this.resolveNode(null, 'BtnHome')?.getComponentInChildren(Label);
        if (homeLabel) homeLabel.string = '返回主页';
        // 与动态结算弹窗一致，每次展示明确接线，不能依赖大厅首次扫描。
        const host = this.flow.node.parent;
        const entries = host?.getComponent(LobbyEntries) ?? host?.addComponent(LobbyEntries);
        entries?.bindRewardEntries(this.node);
        const moneyTool = this.findChildDeep(this.node, 'moneyTool');
        if (moneyTool) moneyTool.active = inGame;
        this.open();
        this.node.setSiblingIndex(this.node.parent!.children.length - 1);
        for (const [name, active] of [['show', !inGame], ['BtnClose', true], ['BtnHome', inGame], ['BtnPrimary', inGame]] as const) {
            const node = this.resolveNode(null, name);
            if (node) node.active = active;
        }
        const music = this.resolveNode(null, 'icon_BGmusic/Choice')?.getComponent(Toggle);
        const sound = this.resolveNode(null, 'icon_ComboSound/Choice')?.getComponent(Toggle);
        if (music) music.setIsCheckedWithoutNotify(this.flow.save.data.musicEnabled);
        if (sound) sound.setIsCheckedWithoutNotify(this.flow.save.data.soundEnabled);
    }
}
