# WeChat Agent Bot

微信 AI 智能助手 — 一键安装，多模型切换，WebUI 配置，定时任务，记忆系统，MCP 工具集成。

基于 [weixin-agent-sdk](https://github.com/wong2/weixin-agent-sdk)（OpenClaw 协议），本地 `npm install` 即可运行。

## Features

- **多模型支持** — OpenAI / Anthropic / 任意 OpenAI 兼容 API（支持中转 baseURL）
- **Stream 模式** — 默认开启，加速首 token 响应
- **WebUI 控制台** — 浏览器管理模型、定时任务、MCP 服务器
- **持久化会话** — 对话历史存磁盘，重启不丢失（7 天 TTL）
- **记忆系统** — `/remember` `/recall` `/forget`，类似 Claude Memory
- **定时任务** — Cron 驱动，定时发送研报、日报等
- **MCP 工具集成** — 接入任意 MCP 服务器扩展能力
- **Skill 扩展** — 斜杠命令系统，可自定义
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
│   │   ├── base.ts           # Provider 基类（含会话历史）
│   │   ├── openai.ts         # OpenAI 兼容（支持 stream + baseURL 中转）
│   │   ├── anthropic.ts      # Anthropic Claude（支持 stream）
│   │   └── registry.ts       # Provider 注册中心
│   ├── scheduler/            # Cron 定时任务
│   ├── mcp/                  # MCP 协议客户端
│   ├── skills/               # 斜杠命令系统
│   │   └── builtin/          # 内置: help, model, clear, remember, recall, forget
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

### 多模型配置（data/config.json）

```json
{
  "models": [
    {
      "id": "gpt-5.4",
      "name": "GPT-5.4",
      "provider": "openai",
      "model": "gpt-5.4",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.zyai.online/v1",
      "stream": true,
      "maxHistory": 50,
      "temperature": 0.7,
      "systemPrompt": "You are a helpful assistant."
    },
    {
      "id": "claude",
      "name": "Claude Sonnet",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-xxx"
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
A: 不会。对话历史和记忆都持久化到 `data/` 目录（7 天 TTL）。

**Q: 如何使用中转 API？**
A: 在模型配置中设置 `baseUrl` 为你的中转地址（如 `https://api.zyai.online/v1`）。

**Q: Stream 模式有什么好处？**
A: 减少首 token 等待时间。虽然微信不支持流式发送，但 stream 让 API 更快开始返回，总响应时间更短。

## License

MIT
