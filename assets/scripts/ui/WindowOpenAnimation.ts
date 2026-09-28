import { _decorator, Animation, Component } from 'cc';

const { ccclass } = _decorator;
export const WINDOW_OPEN_CLIPS = ['An_WindowOpen_01', 'An_WinStarshow_01'] as const;

/** 跟随节点的实际启用状态播放，父面板开关也会触发。 */
@ccclass('WindowOpenAnimation')
export class WindowOpenAnimation extends Component {
    protected onEnable(): void {
        const animation = this.getComponent(Animation);
        if (!animation) return;
        let started = false;
        for (const name of WINDOW_OPEN_CLIPS) {
            const state = animation.getState(name);
            if (!state) continue;
            if (started) {
                state.stop();
                state.play();
            }
            else animation.play(name);
            started = true;
        }
    }
}
