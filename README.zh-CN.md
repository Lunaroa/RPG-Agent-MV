# RPG Agent MV

简体中文 | [English](README.md)

面向个人 RPG Maker MV 与 RPG Maker MZ 1.10.0 制作者的本地 AI 制作助手。

RPG Agent MV 将自然语言目标转换为 MV 或 MZ 项目里的事件、脚本和受控批量修改。产品名继续使用 RPG Agent MV，工程引擎由系统自动识别。

![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.5.0-339933.svg)
![Electron](https://img.shields.io/badge/built%20with-Electron-47848F.svg)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)

[用户手册](docs/README.md) | [English User Guide](docs/en/README.md) | [快速开始](#快速开始) | [源码运行](#源码运行) | [项目边界](#项目边界)

## 它能做什么

### 自然语言生成事件

直接描述你想要的 NPC、剧情段、任务提示、机关或演出效果，Agent 会读取当前项目内容，生成符合当前 MV 或 MZ 引擎结构的事件内容。

适合这类需求：

- 写一个村民 NPC 的对话和后续分支。
- 做一个任务开始、推进、完成的事件。
- 准备一个宝箱、传送点、提示牌或剧情触发点。
- 根据已有地图和素材生成一段可放进项目里的事件。

### 批量修改旧事件

当项目里已经有很多地图和事件时，可以用自然语言描述要统一修改的内容，由 Agent 读取项目事实并批量处理。

适合这类需求：

- 把一批 NPC 的台词风格改得更一致。
- 给多个事件补同一种开关、变量或条件。
- 批量调整提示牌、商店、传送点或任务事件。
- 查找旧事件里不合理的逻辑并统一整理。

### 写脚本和改插件相关逻辑

RPG Maker 项目经常需要改 JavaScript、看插件参数或补一点项目逻辑。RPG Agent MV 会按当前 MV 或 MZ 工程的插件声明和命令格式处理。

适合这类需求：

- 写一个小脚本解决项目里的重复操作。
- 修改已有插件调用方式。
- 查找某个菜单、战斗、道具或事件行为来自哪里。
- 根据项目现状给出脚本修改建议。

### 理解当前项目

Agent 会围绕你选择的 RPG Maker MV 或 MZ 工程工作，读取地图、事件、素材、数据库和插件状态，而不是只凭空写一段文本。

这让它更适合个人项目里的日常制作：输入“把这个镇子的 NPC 都改得更像边境小镇居民”后，系统会先读取项目已有内容，再推进具体修改。

## 项目边界

RPG Agent MV 不是完整游戏生成器，也不是 RPG Maker 编辑器的替代品。

它当前不承诺：

- 从零生成完整游戏。
- 自动生成地图、美术、音频或缺失素材。
- 自动理解所有第三方插件的完整语义。
- 替代你对剧情、角色、演出和最终效果的判断。

它更适合处理个人制作里的重复工作：把制作目标落进项目，减少重复点事件、翻旧脚本和手动批量修改的时间。

### 引擎兼容范围

- 原有 RPG Maker MV 兼容范围保持不变。
- MZ 1.10.0 是完整验证基线。可识别的旧版 MZ 工程允许在明确警告后导入和编辑；真正写入暂存修改前会再次提示，用户可选择以后不再显示此类兼容性警告。
- 导入后的旧版 MZ 核心仍不进入试玩验证边界；使用 MZ 试玩或隔离运行验证前，需要先把核心更新到 1.10.0。
- 工程标记不是必需文件。系统会自动识别核心脚本、数据布局、图块尺寸、画布尺寸和加密状态；加密工程可在警告后加载，但加密素材的列表、预览、替换和资源校验可能受限。MV/MZ 文件混用、数据布局冲突、必要数据缺失或核心版本无法识别时仍会拒绝。
- 使用 MZ 工程不要求安装 RPG Maker MZ。编辑只需要源工程；普通试玩和隔离战斗测试会静态校验并使用工程根目录 `Game.exe` 旁的 NW.js。识别阶段不会执行它，隔离测试也不会复制该运行器。

## 界面预览

| 主页 | 控制台 |
|----------|------------|
| ![主页](docs/assets/preview/home-workspace.png) | ![控制台](docs/assets/preview/console-workspace.png) |

## 快速开始

1. 准备一个数据和核心脚本完整的 RPG Maker MV 或 MZ 工程目录。MZ 1.10.0 是完整验证基线；旧版核心和加密资源需要明确确认。
2. 启动 RPG Agent MV 桌面应用。
3. 在设置中配置模型供应商和 API Key。
4. 选择你的 RMMV 项目。
5. 用自然语言描述你要生成的事件、要批量修改的旧事件，或要写的脚本。
6. 查看生成结果，并选择调整、补充或应用到项目。

示例请求：

```text
为 Map003 准备一个老人 NPC 事件。
第一次对话时，老人提醒主角去北边森林找失踪的猎人。
任务接受后打开一个开关，后续对话改为催促玩家尽快出发。
```

```text
把所有村民的普通问候台词改得更像边境小镇居民。
保留原本的任务提示和商店功能，不要改剧情关键 NPC。
```

```text
写一个脚本命令：
根据变量 12 的值，给玩家发放对应数量的治疗药水，并在没有物品时显示提示。
```

## 源码运行

### 环境要求

- Windows
- Node.js 22.5 或更高版本
- npm
- 一个数据和核心脚本完整的 RPG Maker MV 或 MZ 工程目录；MZ 1.10.0 是完整验证基线

### 安装依赖

先进入 `RPG-Agent-MV` 根目录，再执行：

```powershell
cd RPG-Agent-MV
npm run install:deps
```

如果要在源码模式下直接使用本地 Agent，或在当前机器构建安装包，再显式构建一次运行工具：

```powershell
npm run build:opencode-runtime
```

### 启动桌面端

依赖装完后，再从根目录执行：

```powershell
npm --prefix src/ui/desktop run dev
```


## 仓库结构

```text
RPG-Agent-MV/
├─ config/              # Agent、供应商和运行配置
├─ data/                # 应用持久数据
├─ docs/                # 用户手册
├─ projects/            # 本地 RMMV 项目投放区，只保留 README
├─ runtime/             # 会话、日志、trace、临时输出和本地密钥
├─ src/
│  ├─ backend/          # 项目识别、索引、Agent 编排和检查
│  ├─ contract/         # 前后端共享类型与协议
│  ├─ py/               # Python 辅助能力
│  └─ ui/desktop/       # Electron 桌面应用
├─ third_party/         # 第三方源码和运行时来源记录，安装包只带必要运行文件
└─ package.json
```

## 文档

| 文档 | 内容 |
|------|------|
| [用户手册](docs/README.md) | 完整使用说明 |
| [安装与启动](docs/1-getting-started/1.2-installation.md) | 运行前提、启动流程和基础自检 |
| [快速上手](docs/1-getting-started/1.4-quickstart.md) | 第一次事件生成任务 |
| [项目接入](docs/2-projects/2.1-project.md) | 选择和管理 RMMV 项目 |
| [模型与运行检测](docs/5-faq/5.3-model-check.md) | 排查模型不可用和运行失败 |


## 社区

欢迎Agent开发者和对 RPG Maker MV 制作感兴趣的创作者入群交流、反馈问题或一起参与开发。

- QQ 群：943573784

## License

Apache-2.0

项目自有代码、后端和桌面端包装代码均采用 Apache-2.0。安装包随附 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)，用于说明随产品分发的第三方组件、运行时和依赖许可。

RPG Agent MV is an independent third-party tool designed to work with RPG Maker MV and supported RPG Maker MZ projects.
