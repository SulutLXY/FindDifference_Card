export type PlayerChannel = 'douyin' | 'wechat' | 'h5';
export type PlayerInfoResult<T> =
    | { success: true; channel: PlayerChannel; data: T }
    | { success: false; channel: PlayerChannel; reason: 'unsupported' | 'failed' | 'timeout' | 'not_logged_in' | 'invalid_response'; message: string };

export interface PlayerDeviceInfo {
    appName?: string;
    brand?: string;
    model?: string;
    system?: string;
    platform?: string;
    language?: string;
    version?: string;
    SDKVersion?: string;
    screenWidth?: number;
    screenHeight?: number;
    windowWidth?: number;
    windowHeight?: number;
    pixelRatio?: number;
}

/** 临时凭证只交给自己的服务器换取身份，不能当作玩家ID或持久化存档。 */
export interface PlayerLoginTicket {
    code?: string;
    anonymousCode?: string;
    isAnonymous: boolean;
}

export interface PlayerProfile {
    nickName: string;
    avatarUrl: string;
}

/** 非 Component；通过 GameFlow.platform.playerInfo 使用。 */
export class PlayerInfoService {
    private _deviceInfo: PlayerDeviceInfo | null = null;
    public get isOpenHarmony(): boolean {
        if (!this._deviceInfo) {
            try {
                const sdk = this.sdk(this.channel());
                if (typeof sdk?.getSystemInfoSync === 'function') this._deviceInfo = sdk.getSystemInfoSync();
            } catch { /* 异步获取设备信息时继续判断。 */ }
        }
        return this._deviceInfo?.platform?.toLowerCase() === 'openharmony';
    }
    public profile: PlayerProfile | null = null;
    constructor(
        private readonly channel: () => PlayerChannel,
        private readonly host: any = globalThis,
        private readonly timeoutMs = 15000,
    ) {}

    private sdk(channel: PlayerChannel): any {
        return channel === 'douyin' ? this.host.tt : channel === 'wechat' ? this.host.wx : undefined;
    }

    private call<T>(channel: PlayerChannel, method: string, options: Record<string, unknown>,
        parse: (value: any) => T): Promise<PlayerInfoResult<T>> {
        const sdk = this.sdk(channel);
        if (typeof sdk?.[method] !== 'function') {
            return Promise.resolve({ success: false, channel, reason: 'unsupported', message: `当前渠道不支持 ${method}` });
        }
        return new Promise(resolve => {
            let settled = false;
            const finish = (value: PlayerInfoResult<T>) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => finish({ success: false, channel, reason: 'timeout', message: '平台接口响应超时' }), this.timeoutMs);
            try {
                sdk[method]({ ...options,
                    success: (value: any) => {
                        try { finish({ success: true, channel, data: parse(value) }); }
                        catch { finish({ success: false, channel, reason: 'invalid_response', message: '平台返回数据不完整' }); }
                    },
                    fail: (error: any) => finish({ success: false, channel, reason: 'failed',
                        message: `${method}: ${error?.errMsg ?? '平台调用失败或玩家未同意授权'}${error?.errNo != null ? ` (${error.errNo})` : ''}` }),
                });
            } catch {
                finish({ success: false, channel, reason: 'failed', message: '平台接口调用异常' });
            }
        });
    }

    /** 设备信息与玩家身份无关；不采集或生成设备唯一标识。 */
    public getSystemInfo(): Promise<PlayerInfoResult<PlayerDeviceInfo>> {
        const channel = this.channel();
        if (channel === 'h5') {
            const data: PlayerDeviceInfo = {};
            if (typeof this.host.navigator?.language === 'string') data.language = this.host.navigator.language;
            for (const [key, value] of Object.entries({ screenWidth: this.host.screen?.width,
                screenHeight: this.host.screen?.height, windowWidth: this.host.innerWidth,
                windowHeight: this.host.innerHeight, pixelRatio: this.host.devicePixelRatio })) {
                if (typeof value === 'number' && Number.isFinite(value)) (data as any)[key] = value;
            }
            return Promise.resolve({ success: true, channel, data });
        }
        return this.call(channel, 'getSystemInfo', {}, value => {
            if (!value || typeof value !== 'object') throw new Error('missing system info');
            const data: PlayerDeviceInfo = {};
            for (const key of ['appName','brand','model','system','platform','language','version','SDKVersion']) {
                if (typeof value[key] === 'string') (data as any)[key] = value[key];
            }
            for (const key of ['screenWidth','screenHeight','windowWidth','windowHeight','pixelRatio']) {
                if (typeof value[key] === 'number' && Number.isFinite(value[key])) (data as any)[key] = value[key];
            }
            this._deviceInfo = data;
            return data;
        });
    }

    /** 抖音默认不强制拉起宿主登录；用户点击登录按钮时可传 true。微信返回 code。 */
    public login(force = false): Promise<PlayerInfoResult<PlayerLoginTicket>> {
        const channel = this.channel();
        return this.call(channel, 'login', channel === 'douyin' ? { force } : {}, value => {
            const code = typeof value?.code === 'string' && value.code.trim() ? value.code : undefined;
            const anonymousCode = channel === 'douyin' && typeof value?.anonymousCode === 'string'
                && value.anonymousCode.trim() ? value.anonymousCode : undefined;
            if (!code && !anonymousCode) throw new Error('missing login ticket');
            return { code, anonymousCode, isAnonymous: !code };
        });
    }

    /** 从玩家点击“授权资料”的回调调用；不在启动时主动触发。 */
    public async requestProfile(): Promise<PlayerInfoResult<PlayerProfile>> {
        const channel = this.channel();
        if (channel !== 'douyin') {
            return { success: false, channel, reason: 'unsupported', message: channel === 'wechat'
                ? '微信头像昵称需单独接入当前渠道的资料填写能力' : '浏览器预览没有平台玩家资料' };
        }
        this.profile = null;
        const ticket = await this.login(true);
        if (ticket.success === false) return ticket;
        if (ticket.data.isAnonymous) {
            return { success: false, channel, reason: 'not_logged_in', message: '请先登录抖音账号，再授权玩家资料' };
        }
        if (typeof this.sdk(channel)?.getSetting === 'function') {
            const setting = await this.call(channel, 'getSetting', {}, value => value?.authSetting ?? {});
            if (setting.success && setting.data['scope.userInfo'] === false) {
                return { success: false, channel, reason: 'failed',
                    message: '玩家资料权限已关闭，请在小游戏右上角「更多 → 设置」开启后重试' };
            }
        }
        const result = await this.call(channel, 'getUserInfo', { withCredentials: false }, value => {
            const profile = value?.userInfo;
            if (typeof profile?.nickName !== 'string' || !profile.nickName.trim()
                || typeof profile?.avatarUrl !== 'string') throw new Error('missing profile');
            return { nickName: profile.nickName, avatarUrl: profile.avatarUrl };
        });
        if (result.success) this.profile = result.data;
        return result;
    }
}
