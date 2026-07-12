# MCP 工坊

MCP Server 可视化调试工具。基于 **Tauri 2 + React + Rust** 构建，支持连接、调试、诊断 MCP 服务器，并提供代理拦截与录制回放能力。

## 功能

### 连接与服务器管理

- 支持 **Stdio** 与 **HTTP** 两种传输方式
- 多服务器并行管理，实时显示连接状态
- 右键菜单：**重新连接**、**刷新**（tools / resources / prompts）、**查看/编辑属性**
- 内置 Codex 配置预设（`codex mcp-server`）

### 调试面板

| 面板 | 说明 |
|------|------|
| **工具** | 浏览并调用 MCP tools，根据 JSON Schema 动态生成表单 |
| **资源** | 列出资源并读取内容；支持按 URI 直接读取未列出的资源 |
| **提示词** | 浏览并获取 MCP prompts |
| **诊断** | 静态分析、调用测试、多模型对比、描述优化、协议合规检查 |
| **设置** | 集中管理 LLM 模型配置（供诊断等功能使用） |
| **代理拦截** | stdio / HTTP MITM 代理，拦截并查看 MCP 消息 |
| **录制回放** | 录制 MCP 会话并回放 |

### 其他

- 消息日志：实时展示 MCP JSON-RPC 请求/响应
- 三栏可拖拽调整布局
- 跟随系统平台的表单控件样式（macOS / Windows / Linux）

## 下载安装

在 [GitHub Actions](https://github.com/xinjiyuan97/mcp-inspector/actions) 或 [Releases](https://github.com/xinjiyuan97/mcp-inspector/releases) 下载对应平台的安装包：

| 系统 | Artifact / 文件 |
|------|-----------------|
| macOS（Apple Silicon） | `mcp-inspector-macos-aarch64` → `.dmg` |
| macOS（Intel） | `mcp-inspector-macos-x86_64` → `.dmg` |
| Windows | `mcp-inspector-windows` → `.msi` / `.exe` |
| Linux | `mcp-inspector-linux` → `.deb` / `.AppImage` |

不确定 Mac 芯片类型时，终端运行 `uname -m`：`arm64` 选 aarch64，`x86_64` 选 x86_64。

## 本地开发

### 环境要求

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://rustup.rs/) stable
- 平台依赖：
  - **macOS**：Xcode Command Line Tools
  - **Linux**：`libwebkit2gtk-4.1-dev`、`libappindicator3-dev`、`librsvg2-dev`、`patchelf` 等（见 CI workflow）
  - **Windows**：WebView2（通常已预装）

### 启动

```bash
pnpm install
pnpm tauri dev
```

### 构建

```bash
pnpm tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

## 使用示例

### 连接文件系统 MCP Server

| 字段 | 值 |
|------|-----|
| 传输类型 | Stdio |
| 命令 | `npx` |
| 参数 | `-y @modelcontextprotocol/server-filesystem /tmp` |

### 连接 Codex

点击「填入 Codex」预设，或手动配置：

| 字段 | 值 |
|------|-----|
| 命令 | `codex` |
| 参数 | `mcp-server` |

### 读取未列出的资源

在 **资源** 面板顶部的「按 URI 读取」输入框中填入 URI（如 `file:///path/to/file`），点击读取。MCP 的 `resources/read` 不要求资源出现在 `resources/list` 中。

## 项目结构

```
mcp-inspector/
├── src/                    # React 前端
│   ├── components/         # UI 组件
│   ├── store/              # Zustand 状态管理
│   └── i18n/               # 国际化
├── src-tauri/              # Tauri + Rust 后端
│   └── src/
│       ├── mcp/            # MCP 客户端（连接、tools/resources/prompts）
│       ├── diag/           # 诊断（lint、调用测试、描述优化、合规检查）
│       └── proxy/          # stdio / HTTP 代理
└── .github/workflows/      # CI 构建与 Release
```

## CI / Release

推送 `v*` 标签（如 `v0.1.0`）会触发 GitHub Actions，自动构建 macOS / Linux / Windows 安装包并创建 Draft Release。

```bash
git tag v0.1.0
git push origin v0.1.0
```

也可在 Actions 页面手动 **Run workflow** 仅构建产物（不创建 Release）。

## 技术栈

- **前端**：React 19、TypeScript、Tailwind CSS 4、Zustand、React Aria Components、Monaco Editor
- **后端**：Rust、Tauri 2、[rmcp](https://github.com/modelcontextprotocol/rust-sdk) MCP 客户端
- **打包**：Tauri（`.dmg` / `.msi` / `.deb` / `.AppImage`）

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
