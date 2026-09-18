# ADR：Android 最低版本统一为 Android 7.0

- 状态：已采纳
- 日期：2026-09-18
- 范围：受管 Android 工具链、打包预设和 APK

## 决策

固定 AndroidX WebKit 1.17.0 要求最低 API 24，因此受管壳最低支持 Android 7.0。保留既定依赖版本，不通过覆盖依赖声明或降低库版本绕过要求。工具链自检工程、新预设默认值和构建前检查共用同一最低版本常量。

## 迁移与兼容

已有预设仍按原值读取，不自动改写。低于 API 24 的预设显示字段错误并阻止构建，开发者必须明确修改后再构建。数字输入仍允许显示旧值，防止控件挂载时自动把旧配置截断到新下限。

此变更不修改应用 ID、签名或已有存档。Android 7.0 及以上设备仍须满足应用 ID、证书和整数版本约束才能覆盖升级；Android 6 及更早设备不支持新 APK，不能承诺升级至该版本。

## 依据

真实首次构建在清单合并阶段确认 API 23 与固定依赖要求的 API 24 冲突。参考 [AndroidX WebKit 发行说明](https://developer.android.com/jetpack/androidx/releases/webkit)。本决策补充 [Android WebView 架构决策](android-webview-packaging-adr.md)，不改变原有壳技术栈。
