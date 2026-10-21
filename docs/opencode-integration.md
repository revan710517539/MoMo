# OpenCode 制作引擎接入

本模块接入真实 `opencode-ai@1.19.3` CLI。它只向模型请求工具源码，不执行模型生成的 JavaScript，不写入工具库，不调用文件或剪贴板。宿主在收到经过校验的 bundle 后另行持久化、授权和运行。

## 主进程接口

```js
const { OpenCodeEngine, validateBundle, buildPrompt } = require('./opencode.cjs');
const engine = new OpenCodeEngine({
  userData: app.getPath('userData'), // 必须为绝对路径
  binaryPath: '/absolute/path/to/opencode', // 可选，默认查项目依赖中的平台原生二进制
  getSettings: () => ({
    provider: 'openai-compatible', // 或 custom；均使用 chat/completions 协议
    baseURL: 'https://provider.example/v1',
    model: 'your-model-id',
    apiKey: 'the-key-explicitly-entered-in-this-app',
    // opencodePath: '/absolute/path/to/opencode', // 可选，优先于 binaryPath
  }),
  onEvent: ({ id, status, message }) => { /* 发送到宿主界面 */ },
});
await engine.status();
const bundle = await engine.generate({ id: 'unique-job-id', request: '制作一个文字计数器', previous: undefined });
engine.cancel('unique-job-id');
await engine.close();
```

- `status()` 异步返回 `{ installed, configured, version, provider, model, baseURL, reason }`，不返回 key、命令输出或认证文件。`configured` 只表示设置结构有效，不代表模型服务已连通或额度可用。
- `generate()` 异步返回校验后的 bundle；`previous` 可传前一个完整 bundle，模型返回完整修改版本。需求最长 12000 字，最多同时两个任务，任务 ID 不允许重复。
- `cancel(id)` 返回是否存在该任务；`close()` 禁止新生成任务，取消并等待现有任务清理。任务在准备阶段被取消也不会随后启动子进程。
- 事件为 `{ id, status, message }`，状态为 `generating`、`validating`、`cancelled`、`error`。`validating` 表示静态校验通过，**不表示已保存或运行成功**；保存成功应由宿主单独回执。
- 常见错误 `Error.code`：`NOT_CONFIGURED`、`INVALID_SETTINGS`、`NOT_INSTALLED`、`INVALID_REQUEST`、`BUSY`、`CLOSED`、`TIMEOUT`、`CANCELLED`、`INVALID_BUNDLE`、`OPENCODE_ERROR`。原始 provider stderr/错误正文不转发到 UI。

## 真实协议

CLI 以 `run --pure --format json --model momo/<configured-model> --title ...` 启动。需求通过 stdin 传入，避免出现在命令行参数中。适配器只读取 NDJSON 的 `text` 事件中的 `part.text`，拼接后必须为纯 JSON；Markdown 代码围栏、错误事件、工具调用事件和无文本响应全部拒绝。

已用安装的 1.19.3 实际验证：

1. `--version` 返回 `1.19.3`，`run --help` 确认 `--pure`、`--format json`。
2. 隔离环境下 `debug config` 回读到 `permission: {"*":"deny"}`、空插件/MCP 和禁用工具配置。
3. 真实 CLI 连接本机 OpenAI SSE 协议 fixture，收到 `/v1/chat/completions`，正确传入指定模型和需求，`tools` 数量为 0；响应通过 CLI NDJSON 后被本模块解析并验证。

以上证明 CLI/协议接线和隔离配置，不是实际大模型质量、额度、网络或真实用户工具可用性验收。未读取本机已有凭据；未访问收费模型。当前不自动选用免费 provider，也不在未配置时返回模板冒充生成结果。

## 配置、凭据和生命周期

每次版本探测/生成在 `userData/opencode-engine/job-*` 创建独立的 `home`、XDG 配置/数据/缓存/状态和空 `work` 目录。子进程环境采用允许列表，不继承供应商 key、`NODE_OPTIONS`、用户 `OPENCODE_*`、全局配置路径等。禁用项目配置和 Claude 兼容配置；`--pure` 禁用外部插件；不向生成任务提供原仓库路径、文件附件或系统凭据。

provider 固定使用 `@ai-sdk/openai-compatible`，只允许本次设置中的 `momo` provider。API Key 放在子进程 inline 配置环境中，不进入 argv 或适配器写出的配置文件。远程端点要求 HTTPS，本机回环端点允许 HTTP；拒绝 URL 内嵌凭据、查询参数、片段与配置插值。API Key 不出现在状态、事件和错误文本中。

生成配置显式 `permission: { '*': 'deny' }`，并禁用工具；模型不可调用 bash/read/write/MCP/task 等能力。CLI 自身运行、模型 HTTP 请求和自有状态写入仍然存在：**这不是 OS 沙箱，也不是对 OpenCode 二进制漏洞的隔离证明**。

生成最多 180 秒；版本探测最多 10 秒；stdout/stderr 总量最多 2 MiB。取消或超时先终止进程组，500 ms 后强制结束（Windows 使用子进程终止）。正常完成、错误和取消均删除任务目录。主进程应在退出时调用 `close()`；强制杀死整个宿主或断电可能留下临时任务目录，应按应用保留策略处理。适配器不会自动安装依赖。

## Bundle 与宿主桥

bundle 必须精确包含：

```json
{"title":"工具名","description":"用途","html":"<main>页面内容</main>","css":"main{padding:16px}","js":"","permissions":[],"inputHint":"使用提示"}
```

字段长度上限：title 100、description 1200、html 80000、css 40000、js 100000、inputHint 1000 字符。只允许下列权限名称，声明本身不代表已获授权：

- `file.read`：`window.momo.pickFiles({multiple})` → `{canceled,files:[{id,name}]}`；`window.momo.readFile(id)` → `{id,name,text}`。
- `file.write`：`window.momo.saveText({name,content})` → `{id,name,canceled}`。
- `clipboard.read`：`window.momo.readClipboard()` → `{text}`。
- `clipboard.write`：`window.momo.writeClipboard(text)`。
- `notification`：`window.momo.notify({title,body})`。
- `app.open`：`window.momo.openOutput(id)`，只能打开宿主已保存的输出。

静态校验拒绝未知字段/权限、超长输入、脚本/样式标签边界、iframe 等嵌入内容、内联事件、资源 URL、CSS 外部加载，以及明显 Node、动态代码、网络和逃逸 API。它是保守过滤，会拒绝部分正常代码；**正则校验不能证明任意 JavaScript 安全，也不能替代运行时约束**。

宿主仍必须对生成代码禁用 Node、隔离 renderer，落实 CSP（尤其 default/connect/frame/object/form/navigation 等），限制窗口与导航，校验每次 IPC 的来源、工具 ID、声明权限和用户授权，并提供操作日志、确认与撤销。模型源码不可在主进程、Node `eval`、`vm` 或 `Function` 中执行。

## 验证与回滚

运行 `node --test tests/opencode.test.mjs`。测试覆盖源校验、桥接提示词、未配置错误、URL 边界、隔离环境、stdin/NDJSON 协议、错误脱敏、拒绝工具调用、取消、关闭、超时和目录清理；安装了当前平台二进制时额外运行真实 CLI + 本地协议 fixture。fixture 不是大模型。

本变更仅包含 `electron/opencode.cjs`、`tests/opencode.test.mjs`、本说明。回滚可移除这三个新增文件并由宿主恢复旧接线；不会触及用户现有 OpenCode 配置、密钥或工具数据。打包发行时需由宿主提供经过固定版本与签名检查的可执行文件路径，不能依赖开发目录的 `node_modules` 布局。

官方契约参考：[CLI](https://opencode.ai/docs/cli/)、[配置](https://opencode.ai/docs/config/)、[自定义 provider](https://opencode.ai/docs/providers/)。
