export interface Insets { top: number; bottom: number; left: number; right: number; }
export const DESIGN_WIDTH = 750;
export const DESIGN_HEIGHT = 1334;

/** 使用实际游戏窗口的比例；比 9:16 更短时保留完整设计画面，9:18 起选长屏。 */
export function gameViewport(width: number, height: number) {
    const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    const ratio = valid ? height / width : 16 / 9;
    return {
        width: DESIGN_WIDTH,
        height: Math.max(DESIGN_HEIGHT, DESIGN_WIDTH * ratio),
        prefab: ratio >= 2 - 0.001 ? 'prefabs/GameScreen' : 'prefabs/GameScreen_9x16',
    };
}

/** 设计参数保持原值，只计算整个设计容器在实际可见区域内的等比缩放。 */
export function fitDesignFrame(width: number, height: number, designWidth: number, designHeight: number, insets: Partial<Insets> = {}) {
    const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
    designWidth = positive(designWidth, DESIGN_WIDTH); designHeight = positive(designHeight, DESIGN_HEIGHT);
    width = positive(width, designWidth); height = positive(height, designHeight);
    const clean = (value: number | undefined, maximum: number) => Number.isFinite(value) ? Math.max(0, Math.min(value!, maximum / 3)) : 0;
    const left = clean(insets.left, width), right = clean(insets.right, width);
    const top = clean(insets.top, height), bottom = clean(insets.bottom, height);
    const safeWidth = width - left - right, safeHeight = height - top - bottom;
    const scale = Math.min(1, safeWidth / designWidth, safeHeight / designHeight);
    return { designWidth, designHeight, safeWidth, safeHeight, scale, x: (left - right) / 2, y: (bottom - top) / 2 };
}
