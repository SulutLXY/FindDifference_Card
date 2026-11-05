export interface DailyReward { kind: 'hint' | 'energy'; amount: number; }
export interface DailySignInConfig { days: DailyReward[]; }
export interface DailySignInProgress { lastClaimDay?: string; dayIndex?: number; promptDay?: string; }

/** 使用北京时间日历日期；漏签重置，七天领完后开始下一轮，回拨不能重复领。 */
export function dailySignInStatus(progress: DailySignInProgress | undefined, day: string, config: DailySignInConfig) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))
        || new Date(day).toISOString().slice(0, 10) !== day) throw Error('签到日期无效');
    if (!Array.isArray(config.days) || config.days.length !== 7 || config.days.some(reward =>
        !reward || !['hint', 'energy'].includes(reward.kind) || !Number.isSafeInteger(reward.amount) || reward.amount < 1)) throw Error('七日奖励配置无效');
    const previous = progress?.lastClaimDay;
    const lastIndex = Number.isInteger(progress?.dayIndex) && progress!.dayIndex! >= 1 && progress!.dayIndex! <= 7 ? progress!.dayIndex! : 0;
    const claimed = !!previous && previous >= day;
    const consecutive = !!previous && (Date.parse(day) - Date.parse(previous)) === 86400000;
    const dayIndex = claimed ? Math.max(1, lastIndex) : consecutive ? lastIndex % 7 + 1 : 1;
    return { dayIndex, claimed, canClaim: !claimed, reward: config.days[dayIndex - 1] };
}
