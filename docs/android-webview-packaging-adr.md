# ADR：Android 使用受管 WebView 壳打包 RPG Maker 游戏

- 状态：已采纳
- 日期：2026-09-16
- 范围：RPG Agent MV 生成的 Android APK 与在线更新

## 决策

Android 目标只使用仓库内受管的原生 Android 壳：单 Activity、AndroidX WebKit、`WebViewAssetLoader`、应用私有内容目录和原生更新桥。构建使用固定且经过校验的 JDK、Android SDK、Gradle、Android Gradle Plugin 与依赖缓存。ABI 拆分交给 Android Gradle Plugin 完成。

不同时维护 Cordova、Capacitor、第三方模板下载或“把 Web 目录改名为 APK”的备用路径。工具链不满足固定版本时直接阻止构建。

## 原因

RPG Maker MV/MZ 游戏本质上是 HTML、JavaScript 和素材，但 APK 还必须解决本地内容安全加载、生命周期、存档位置、应用签名、系统安装器和 ABI 元数据。固定一条原生路径可以让这些边界可测试、可记录，也避免多个壳对插件、文件路径和更新协议产生不同解释。

`WebViewAssetLoader` 通过 HTTPS 形式的受控本地域名提供 APK 内置内容，避免使用宽泛的 `file://` 访问。首次运行内容来自 APK；在线内容更新进入应用私有的按版本目录，完整校验后才原子激活。上一份健康内容保留用于回滚。

## 安全与更新边界

- JavaScript 只能通过明确暴露的桥调用内容更新、APK 更新和运行状态能力。
- 内容包、目标文件和差分结果都核对大小与 SHA-256。
- 可选的游戏清单签名在 JavaScript 选择任何更新前完成；验签失败不向原生层交付安装请求。
- APK 更新再次核对应用 ID、整数版本和签名证书，并交给 Android `PackageInstaller`；应用不会静默安装。
- 存档继续使用 WebView 的应用私有存储，不随内容目录切换；卸载应用仍可能清除本地存档。

## 后果

优点是构建和更新行为唯一、ABI 与签名身份可从产物中核验、回滚边界明确。代价是首次构建需要下载固定工具链，Android WebView 的设备差异仍需真机覆盖，第三方 RPG Maker 插件若依赖 NW.js 或桌面文件系统 API 也必须由作者验证或改造。

若未来更换壳、最低 Android 版本、WebView 资源路由或签名协议，应新增 ADR 并提供迁移和兼容策略，不能在现有预设下静默切换。
