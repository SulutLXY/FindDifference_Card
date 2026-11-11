import type { AudioClip, AudioSource } from 'cc';

interface MusicVoice {
    source: AudioSource;
    key: string;
    clip: AudioClip | null;
    releaseBundle?: () => void;
    gain: number;
    start: number;
    target: number;
}

/** 两路循环音源交叉淡化；音量包络与结算压低音量分别计算。 */
export class BackgroundMusicMixer {
    private readonly voices: MusicVoice[];
    private elapsed = 0;
    private ducked = false;

    constructor(sources: [AudioSource, AudioSource], private readonly duration = 1.5) {
        this.voices = sources.map(source => {
            source.playOnAwake = false;
            source.loop = true;
            source.volume = 0;
            return { source, key: '', clip: null, gain: 0, start: 0, target: 0 };
        });
    }

    /** 快速切回仍在淡出的曲目时，直接反向淡化，不重新下载或重播。 */
    public resume(key: string): boolean {
        const voice = this.voices.find(item => item.clip && item.key === key);
        if (!voice) return false;
        if (voice.target !== 1) this.transition(voice);
        return true;
    }

    /** 仅在新音频就绪后切换；下载期间旧曲继续播放。 */
    public play(key: string, clip: AudioClip, releaseBundle?: () => void): void {
        if (this.resume(key)) { releaseBundle?.(); return; }
        const voice = this.voices.find(item => !item.clip)
            ?? this.voices.reduce((a, b) => a.gain <= b.gain ? a : b);
        this.release(voice);
        clip.addRef();
        voice.clip = clip;
        voice.key = key;
        voice.releaseBundle = releaseBundle;
        voice.source.clip = clip;
        voice.source.volume = 0;
        voice.source.play();
        this.transition(voice);
    }

    public update(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return;
        this.elapsed = Math.min(this.duration, this.elapsed + dt);
        const t = this.duration > 0 ? this.elapsed / this.duration : 1;
        for (const voice of this.voices) {
            if (!voice.clip) continue;
            voice.gain = voice.start + (voice.target - voice.start) * t;
            this.applyVolume(voice);
            if (t >= 1 && voice.target === 0) this.release(voice);
        }
    }

    public setDucked(ducked: boolean): void {
        this.ducked = ducked;
        for (const voice of this.voices) this.applyVolume(voice);
    }

    /** 关闭音乐、进入 Feed 预览及销毁时立即停掉两路，不留下淡出尾音。 */
    public stop(): void {
        for (const voice of this.voices) this.release(voice);
        this.elapsed = 0;
    }

    private transition(incoming: MusicVoice): void {
        this.elapsed = 0;
        for (const voice of this.voices) {
            voice.start = voice.gain;
            voice.target = voice === incoming ? 1 : 0;
        }
    }

    private applyVolume(voice: MusicVoice): void {
        if (voice.source.isValid) voice.source.volume = voice.gain * (this.ducked ? 0.5 : 1);
    }

    private release(voice: MusicVoice): void {
        if (voice.source.isValid) {
            voice.source.stop();
            voice.source.clip = null;
            voice.source.volume = 0;
        }
        voice.clip?.decRef();
        voice.clip = null;
        voice.releaseBundle?.();
        voice.releaseBundle = undefined;
        voice.key = '';
        voice.gain = voice.start = voice.target = 0;
    }
}
