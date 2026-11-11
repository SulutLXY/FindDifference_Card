import { _decorator, Color, Component, Enum, Mat4, Material, Sprite, Texture2D, UITransform, Vec2, Vec4, warn } from 'cc';

const { ccclass, property, requireComponent, executeInEditMode } = _decorator;
const wrap = (value: number) => ((value % 1) + 1) % 1;
export enum StickerOverlayMode { Tile = 0, Fill = 1 }

/** 图A保持静止；图B通过独立纹理、局部坐标、颜色及平铺设置叠加滚动。 */
@ccclass('SpriteUVScroll')
@requireComponent(Sprite)
@executeInEditMode
export class SpriteUVScroll extends Component {
    @property({ type: Material, tooltip: '拖入PleyGame/Materials/SpriteUVScroll.mtl；也可使用Sprite已绑定的该材质' })
    public material: Material | null = null;

    @property({ tooltip: '默认使用材质面板中的图B、颜色、速度等参数；关闭后使用下面的组件参数' })
    public useMaterialSettings = true;

    @property({ type: Texture2D, tooltip: '图B：拖入独立图片的texture子资源；不使用图A的图集贴图。留空时使用材质中已配置的Overlay Texture' })
    public overlayTexture: Texture2D | null = null;

    @property({ type: Color, tooltip: '仅修改图B的颜色与颜色Alpha，不影响图A' })
    public overlayColor = new Color(255, 255, 255, 255);

    @property({ tooltip: '图B独立不透明度，0完全透明，1使用原图透明度', range: [0, 1], slide: true })
    public overlayOpacity = 1;

    @property({ type: Enum(StickerOverlayMode), tooltip: 'Tile平铺：使用Tiling；Fill填充：图B独立拉伸填满精灵区域，忽略Tiling' })
    public overlayMode = StickerOverlayMode.Tile;

    @property({ tooltip: '图B限制在图A的透明轮廓内；关闭后允许图B显示在图A透明区' })
    public clipToBaseAlpha = true;

    @property({ type: Vec2, tooltip: '仅图B：每秒滚过的纹理比例。X正向右，Y正向上，负值反向；支持斜向' })
    public speed = new Vec2(0.15, 0);

    @property({ type: Vec2, tooltip: '仅图B平铺模式的横/纵重复次数，与图A的图集尺寸和UV范围无关' })
    public tiling = new Vec2(1, 1);

    @property({ type: Vec2, tooltip: '初始纹理偏移，0～1为一个周期' })
    public offset = new Vec2(0, 0);

    @property({ tooltip: '关闭时暂停，重新打开继续滚动' })
    public playing = true;

    private _sprite: Sprite | null = null;
    private _ui: UITransform | null = null;
    private _owned: Material | null = null;
    private _original: Material | null = null;
    private _sourceOverlay: Texture2D | null = null;
    private _source: Material | null = null;
    private _phaseX = 0;
    private _phaseY = 0;
    private readonly _speed = new Vec4();
    private readonly _offset = new Vec4();
    private readonly _inverse = new Mat4();
    private readonly _rowX = new Vec4();
    private readonly _rowY = new Vec4();
    private readonly _bounds = new Vec4();
    private readonly _tint = new Vec4();

    protected onEnable(): void {
        this._initialize(true);
    }

    private _initialize(report = false): void {
        if (this._owned) return;
        const sprite = this.getComponent(Sprite);
        const ui = this.getComponent(UITransform);
        const source = this.material ?? sprite?.customMaterial;
        if (!sprite || !ui || !source || source.effectAsset?.name !== 'SpriteUVScroll') {
            if (report) warn('[SpriteUVScroll] 请在Sprite节点绑定SpriteUVScroll材质');
            return;
        }
        this._sprite = sprite;
        this._ui = ui;
        this._original = sprite.customMaterial;
        this._sourceOverlay = source.getProperty('overlayTexture') as Texture2D | null;
        this._source = source;
        // 使用渲染器的非序列化材质实例，避免编辑器保存时把临时材质写进预制体。
        if (sprite.customMaterial !== source) sprite.customMaterial = source;
        this._owned = sprite.getMaterialInstance(0);
        this._syncGeometry();
        this._apply();
    }

    protected update(dt: number): void {
        if (this._owned && this._sprite && (this._sprite.customMaterial !== this._source
            || (this.material && this.material !== this._source))) this.onDisable();
        if (!this._owned) this._initialize();
        if (!this._owned || !this._sprite || this._sprite.getRenderMaterial(0) !== this._owned) return;
        this._syncGeometry();
        const speed = this._setting('scrollSpeed') as Vec4 | null;
        if (this.playing && Number.isFinite(dt) && dt > 0) {
            const x = speed?.x ?? this.speed.x, y = speed?.y ?? this.speed.y;
            this._phaseX = wrap(this._phaseX + (Number.isFinite(x) ? x : 0) * dt);
            this._phaseY = wrap(this._phaseY + (Number.isFinite(y) ? y : 0) * dt);
        }
        this._apply();
    }

    public resetScroll(): void { this._phaseX = this._phaseY = 0; this._apply(); }

    private _syncGeometry(): void {
        if (!this._owned || !this._ui) return;
        Mat4.invert(this._inverse, this.node.worldMatrix);
        const m = this._inverse, ui = this._ui;
        this._rowX.set(m.m00, m.m04, m.m08, m.m12);
        this._rowY.set(m.m01, m.m05, m.m09, m.m13);
        this._bounds.set(-ui.width * ui.anchorX, -ui.height * ui.anchorY, ui.width, ui.height);
        this._owned.setProperty('bWorldToLocalX', this._rowX);
        this._owned.setProperty('bWorldToLocalY', this._rowY);
        this._owned.setProperty('bLocalBounds', this._bounds);
    }

    private _apply(): void {
        if (!this._owned) return;
        const positive = (n: number) => Number.isFinite(n) && n > 0 ? n : 1;
        const speed = this._setting('scrollSpeed') as Vec4 | null;
        const offset = this._setting('scrollOffset') as Vec4 | null;
        const x = speed?.x ?? this.speed.x, y = speed?.y ?? this.speed.y;
        const ox = offset?.x ?? this.offset.x, oy = offset?.y ?? this.offset.y;
        this._speed.set(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0,
            positive(speed?.z ?? this.tiling.x), positive(speed?.w ?? this.tiling.y));
        this._offset.set(wrap(this._phaseX + (Number.isFinite(ox) ? ox : 0)),
            wrap(this._phaseY + (Number.isFinite(oy) ? oy : 0)), 1, 1);
        this._owned.setProperty('scrollSpeed', this._speed);
        this._owned.setProperty('scrollOffset', this._offset);
        const overlay = this.overlayTexture ?? (this._source?.getProperty('overlayTexture') as Texture2D | null);
        if (overlay) this._owned.setProperty('overlayTexture', overlay);
        const tint = this._setting('overlayColor') as Color | Vec4 | null;
        if (tint instanceof Vec4) this._tint.set(tint.x, tint.y, tint.z, tint.w);
        else {
            const color = tint ?? this.overlayColor;
            this._tint.set(color.r / 255, color.g / 255, color.b / 255, color.a / 255);
        }
        const opacity = (this._setting('overlayOpacity') as number | null) ?? this.overlayOpacity;
        const mode = (this._setting('overlayMode') as number | null) ?? this.overlayMode;
        const enabled = (this._setting('overlayEnabled') as number | null) ?? 1;
        const clip = (this._setting('clipToBaseAlpha') as number | null) ?? (this.clipToBaseAlpha ? 1 : 0);
        this._owned.setProperty('overlayColor', this._tint);
        this._owned.setProperty('overlayOpacity', Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0);
        this._owned.setProperty('overlayMode', mode === StickerOverlayMode.Fill ? 1 : 0);
        this._owned.setProperty('overlayEnabled', overlay && enabled > 0 ? 1 : 0);
        this._owned.setProperty('clipToBaseAlpha', clip > 0 ? 1 : 0);
    }

    private _setting(name: string) { return this.useMaterialSettings ? this._source?.getProperty(name) ?? null : null; }

    protected onDisable(): void {
        if (this._sprite?.isValid && this._sprite.getRenderMaterial(0) === this._owned) {
            this._sprite.setSharedMaterial(this._sprite.getSharedMaterial(0), 0, true);
            if (this._sprite.customMaterial !== this._original) this._sprite.customMaterial = this._original;
        }
        this._owned = null;
        this._sprite = null;
        this._ui = null;
        this._original = null;
        this._sourceOverlay = null;
        this._source = null;
    }
}
