import { _decorator, BlockInputEvents, Toggle } from 'cc';
import { UIScreen } from './UIScreen';

const { ccclass } = _decorator;

@ccclass('SettingsModal')
export class SettingsModal extends UIScreen {
    protected onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) this.node.addComponent(BlockInputEvents);
        this.wireButton(null, 'BtnClose', () => this.flow.closeSettings());
        this.wireButton(null, 'BtnPrimary', () => this.flow.continueFromSettings());
        this.wireButton(null, 'BtnHome', () => void this.flow.showLevelSelect());
        const music = this.resolveNode(null, 'icon_BGmusic/Choice')?.getComponent(Toggle);
        const sound = this.resolveNode(null, 'icon_ComboSound/Choice')?.getComponent(Toggle);
        music?.node.on(Toggle.EventType.TOGGLE, () => this.flow.setMusicEnabled(music.isChecked), this);
        sound?.node.on(Toggle.EventType.TOGGLE, () => this.flow.setSoundEnabled(sound.isChecked), this);
    }

    public present(inGame: boolean): void {
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
