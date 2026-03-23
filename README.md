# WeChat Agent Bot

微信 AI 智能助手 — 一键安装，多模型切换，WebUI 配置，定时任务，记忆系统，MCP 工具集成。

基于 [weixin-agent-sdk](https://github.com/wong2/weixin-agent-sdk)（OpenClaw 协议），本地 `npm install` 即可运行。

## Features

- **多模型支持** — OpenAI / Anthropic / Claude Code (本地session) / Kimi / GLM / MiniMax 等
- **中转代理** — 每个模型可配独立 baseURL，兼容任意 OpenAI 格式 API
- **Claude Code 集成** — 复用本地 Claude Code 订阅，不需要 API Key
- **Stream 模式** — 默认开启，加速响应
- **WebUI 控制台** — 浏览器管理模型、技能、定时任务、MCP 服务器
- **10 个内置技能** — 图片搜索、天气、翻译、摘要、记忆系统等
- **SQLite 持久化** — 对话历史 + 用户记忆永久存储（data/bot.db），重启不丢失
- **定时任务** — Cron 驱动，定时发送研报等
- **MCP 工具集成** — 搜索 MCP 注册表一键安装
- **第三方扩展** — 支持从 npm / GitHub / 本地目录加载自定义 Skill
- **一键安装** — `./setup.sh` 自动装 Node.js、Python、所有依赖

## Quick Start

### 1. 安装

```bash
# 方式一：一键安装（推荐，自动装 Node.js >=22）
./setup.sh

# 方式二：手动（需要 Node.js >=22）
npm install
cd webui && npm install && npm run build && cd ..
cp .env.example .env
```

### 2. 配置

编辑 `.env`，填入你的 API Key：

```bash
# OpenAI 或兼容 API（如中转）
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=https://api.openai.com/v1    # 中转改这里
OPENAI_MODEL=gpt-4o

# Anthropic（可选）
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

也可以通过 `data/config.json` 配置多个模型，或启动后在 WebUI 中配置。

### 3. 启动

```bash
npm run dev
```

终端会打印二维码，**用微信扫码**即可连接。

```
✅ 与微信连接成功！
WebUI & API server running at http://localhost:3210
```

### 4. 使用

在微信中给 bot 发消息即可对话。支持以下命令：

| 命令 | 说明 |
|---|---|
| `/help` | 查看所有可用命令 |
| `/model list` | 列出所有模型 |
| `/model <id>` | 切换模型 |
| `/clear` | 清空当前对话历史 |
| `/image <关键词>` | 搜索图片并发送到微信 |
| `/image url <https://...>` | 下载图片并发送 |
| `/weather <城市>` | 查天气（免费 API，无需 Key） |
| `/translate <语言> <文本>` | 翻译（调用当前 AI） |
| `/summary <URL 或文本>` | 网页/文本摘要 |
| `/remember <key> <内容>` | 保存记忆 |
| `/recall [key]` | 查看记忆 |
| `/forget <key>` | 删除记忆 |

## Architecture

```
wechat-agent-bot/
├── src/
│   ├── index.ts              # 主入口，启动所有模块
│   ├── core/
│   │   ├── types.ts          # 类型定义（兼容 weixin-agent-sdk）
│   │   ├── bot.ts            # 微信 Bot 生命周期管理
│   │   ├── router.ts         # 消息路由（skill → provider）
│   │   └── dry-run.ts        # Dry-run 测试模式
│   ├── providers/
│   │   ├── base.ts           # Provider 基类（持久化历史）
│   │   ├── openai.ts         # OpenAI 兼容（stream + baseURL 中转）
│   │   ├── anthropic.ts      # Anthropic Claude（stream）
│   │   ├── claude-code.ts    # Claude Code 本地 session（复用订阅）
│   │   └── registry.ts       # Provider 注册中心
│   ├── scheduler/            # Cron 定时任务
│   ├── mcp/                  # MCP 协议客户端
│   ├── skills/
│   │   ├── registry.ts       # Skill 注册中心
│   │   ├── loader.ts         # 第三方 Skill 加载器（npm/GitHub/本地）
│   │   └── builtin/          # 10 个内置 Skill
│   ├── config/               # JSON 配置持久化
│   ├── server/               # Express API + WebUI 静态文件
│   └── utils/
│       ├── history-store.ts  # 对话历史持久化（data/history/）
│       └── logger.ts         # Winston 日志
├── webui/                    # Vite + React + Tailwind 前端
├── tests/                    # 69 个测试
├── data/                     # 运行时数据（config, history, memories）
├── setup.sh                  # 一键安装脚本
└── .env                      # 环境变量配置
```

## Configuration

### 三种使用模式

**模式一：第三方 API Key（推荐独立部署）**
```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

**模式二：Claude Code 本地 Session（需要安装 Claude Code CLI）**
```json
{
  "id": "claude-local",
  "provider": "claude-code",
  "model": "sonnet",
  "apiKey": "local"
}
```
复用你的 Claude Code 订阅（Max/Pro/Team），不需要 API Key。

**模式三：国产模型（Kimi / GLM / MiniMax）**
```json
{
  "id": "kimi",
  "provider": "openai",
  "model": "moonshot-v1-8k",
  "apiKey": "your-kimi-key",
  "baseUrl": "https://api.moonshot.cn/v1"
}
```
所有兼容 OpenAI 格式的 API 都走 `openai` provider + 自定义 `baseUrl`。

### 多模型配置示例（data/config.json）

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "provider": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.openai.com/v1",
      "stream": true,
      "maxHistory": 50,
      "systemPrompt": "You are a helpful assistant."
    },
    {
      "id": "claude",
      "name": "Claude Sonnet",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-xxx"
    },
    {
      "id": "claude-local",
      "name": "Claude Code (Local)",
      "provider": "claude-code",
      "model": "sonnet",
      "apiKey": "local"
    }
  ]
}
```

### 定时任务

```json
{
  "scheduledTasks": [
    {
      "id": "morning-report",
      "name": "每日早报",
      "cron": "0 9 * * *",
      "enabled": true,
      "type": "report",
      "config": { "topic": "AI industry news" }
    }
  ]
}
```

### MCP 服务器

```json
{
  "mcpServers": [
    {
      "id": "filesystem",
      "name": "Filesystem",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/tmp"],
      "enabled": true
    }
  ]
}
```

## WeChat 消息格式

SDK 会自动将 AI 回复中的 **Markdown 转为纯文本**发送（微信不支持 Markdown 渲染）：

- `**bold**` → `bold`
- `` `code` `` → `code`
- `[link](url)` → `link`
- 代码块 → 保留代码内容，去掉 ``` 标记
- 表格 → 空格分隔
- 换行保留

如果需要富文本效果，可以考虑生成图片发送（media response）。

## Development

```bash
npm run test          # 单元测试（23 个）
npm run test:e2e      # E2E 测试（46 个，含微信集成 + WebUI）
npm run test:all      # 全部 69 个
npm run dry-run       # 终端交互测试（不需要微信）
npm run webui:dev     # WebUI 开发模式（http://localhost:5173）
```

### 添加自定义 Provider

```typescript
import { ProviderRegistry } from './providers/registry.js';

registry.registerFactory('my-provider', (config) => ({
  id: config.id,
  name: config.name,
  config,
  async chat(request) {
    return { text: `Custom reply to: ${request.text}` };
  },
}));
```

### 添加自定义 Skill

```typescript
import { SkillRegistry } from './skills/registry.js';

skills.register({
  name: 'weather',
  description: 'Get weather info',
  async execute(request) {
    return { text: `Weather for: ${request.text}` };
  },
});
```

## Production Deployment (PM2)

```bash
# 首次安装（setup.sh 会自动安装 PM2）
./setup.sh

# 启动（后台运行，自动重启）
npm run pm2:start

# 查看状态
npm run pm2:status

# 查看实时日志
npm run pm2:logs

# 重启
npm run pm2:restart

# 停止
npm run pm2:stop

# 开机自启动
pm2 startup
pm2 save
```

PM2 配置文件：`ecosystem.config.cjs`

| 配置项 | 值 | 说明 |
|---|---|---|
| 日志路径 | `data/logs/out.log` | 标准输出 |
| 错误日志 | `data/logs/error.log` | 错误输出 |
| 自动重启 | 开启 | 崩溃后 5 秒重启，最多 10 次 |
| 内存限制 | 500MB | 超出自动重启 |

### 数据目录结构

```
data/
├── bot.db          # SQLite 数据库（对话历史 + 用户记忆，永久存储）
├── config.json     # 运行时配置（模型、任务、MCP）
├── logs/
│   ├── out.log     # PM2 标准输出日志
│   └── error.log   # PM2 错误日志
├── media/          # 图片等媒体缓存
└── skills/         # 第三方 Skill 安装目录
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | 系统状态 |
| GET | `/api/config` | 配置信息（key 脱敏） |
| POST | `/api/config/save` | 保存配置 |
| GET | `/api/models` | 模型列表 |
| POST | `/api/models` | 添加模型 |
| PUT | `/api/models/:id` | 更新模型 |
| DELETE | `/api/models/:id` | 删除模型 |
| POST | `/api/models/:id/activate` | 激活模型 |
| GET | `/api/tasks` | 定时任务列表 |
| POST | `/api/tasks` | 添加任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |
| GET | `/api/mcp` | MCP 服务器和工具 |
| POST | `/api/mcp` | 添加 MCP 服务器 |
| DELETE | `/api/mcp/:id` | 删除 MCP 服务器 |

## FAQ

**Q: 需要升级微信版本吗？**
A: 不需要。SDK 使用 OpenClaw 长轮询协议（服务端 API），只要微信能扫码即可。

**Q: 需要公网服务器吗？**
A: 不需要。长轮询模式，本地运行即可。

**Q: 微信支持 Markdown 吗？**
A: 不支持。SDK 自动将 Markdown 转为纯文本。保留换行，去除格式标记。

**Q: 重启后对话会丢失吗？**
A: 不会。所有数据永久存储在 `data/bot.db`（SQLite），包括对话历史和用户记忆。

**Q: 如何使用中转 API？**
A: 在模型配置中设置 `baseUrl` 为你的中转地址即可。

**Q: Stream 模式有什么好处？**
A: 减少首 token 等待时间。虽然微信不支持流式发送，但 stream 让 API 更快开始返回，总响应时间更短。

**Q: 如何部署到生产环境？**
A: 使用 PM2：`npm run pm2:start`。配合 `pm2 startup && pm2 save` 可实现开机自启动。日志在 `data/logs/`。

**Q: 数据存在哪里？**
A: 所有数据在 `data/` 目录：`bot.db`（SQLite，对话历史+记忆）、`config.json`（配置）、`logs/`（日志）。备份 `data/` 目录即可迁移。

## License

MIT
