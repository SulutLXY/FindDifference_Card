import { _decorator, Component } from 'cc';

const { ccclass } = _decorator;

/** 兼容旧组件 UUID。布局统一交给 Creator 配置和原有 Widget，禁止运行时改写设计容器。 */
@ccclass('ResponsiveLayout')
export class ResponsiveLayout extends Component {
    public refresh(): void { /* Retained for existing serialized bindings; intentionally inert. */ }
}
