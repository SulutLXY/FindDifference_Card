import { game, sys } from 'cc';
import type { ImageAsset } from 'cc';
import { HTML5, PREVIEW } from 'cc/env';

/** Creator 预览和正式 H5 的 PC 鼠标环境使用；CSS 光标不创建节点，也不参与点击命中。 */
export function installPreviewMouseCursor(loadImage: () => Promise<ImageAsset>): () => void {
    if (!(PREVIEW || HTML5) || !sys.isBrowser || sys.isMobile
        || typeof window === 'undefined' || typeof document === 'undefined'
        || !window.matchMedia?.('(any-hover: hover) and (any-pointer: fine)').matches
        || !game.canvas) return () => {};

    const target = game.canvas;
    const previous = target.style.getPropertyValue('cursor');
    const priority = target.style.getPropertyPriority('cursor');
    let disposed = false;
    let installed = '';
    void loadImage().then(image => {
        image.addRef();
        try {
            if (disposed) return;
            const data = image.data;
            if (!data || ArrayBuffer.isView(data) || image.width <= 0 || image.height <= 0) return;
            const cursor = document.createElement('canvas');
            cursor.width = 48;
            cursor.height = Math.round(cursor.width * image.height / image.width);
            const context = cursor.getContext('2d');
            if (!context) return;
            context.drawImage(data, 0, 0, cursor.width, cursor.height);
            // 猫爪前端为实际点击位置；尺寸按 CSS 像素固定，不受游戏画面缩放影响。
            const x = Math.round(cursor.width * 0.34), y = Math.round(cursor.height * 0.08);
            target.style.setProperty('cursor', `url("${cursor.toDataURL('image/png')}") ${x} ${y}, auto`);
            installed = target.style.getPropertyValue('cursor');
        } finally {
            image.decRef();
        }
    }).catch(error => {
        if (!disposed) console.warn('[PreviewMouseCursor] 网页鼠标素材加载失败，保留系统光标', error);
    });

    return () => {
        disposed = true;
        if (!installed || target.style.getPropertyValue('cursor') !== installed) return;
        if (previous) target.style.setProperty('cursor', previous, priority);
        else target.style.removeProperty('cursor');
    };
}
