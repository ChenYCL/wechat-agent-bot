/**
 * Express API server - serves WebUI and exposes config/management APIs.
 */
import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createModelRoutes } from './routes/models.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createMcpRoutes } from './routes/mcp.js';
import { createStatusRoutes } from './routes/status.js';
import { createSkillRoutes } from './routes/skills.js';
import type { ConfigStore } from '../config/store.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { SchedulerManager } from '../scheduler/manager.js';
import type { McpClient } from '../mcp/client.js';
import type { SkillRegistry } from '../skills/registry.js';
import { logger } from '../utils/logger.js';

export interface ServerDeps {
  config: ConfigStore;
  providers: ProviderRegistry;
  scheduler: SchedulerManager;
  mcp: McpClient;
  skills: SkillRegistry;
}

/** Simple token-based auth middleware. Set API_SECRET env var to enable. */
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = process.env.API_SECRET;
  if (!secret) return next(); // No secret configured = auth disabled (dev mode)

  const token = req.headers.authorization?.replace('Bearer ', '')
    || (req.query as Record<string, string>).token;
  if (token === secret) return next();

  res.status(401).json({ error: 'Unauthorized. Set Authorization: Bearer <API_SECRET> header.' });
}

export function createServer(deps: ServerDeps) {
  const app = express();

  // Security: restrict CORS to localhost origins
  app.use(cors({
    origin: [
      'http://localhost:3210', 'http://127.0.0.1:3210',
      'http://localhost:5173', 'http://127.0.0.1:5173',
    ],
  }));
  app.use(express.json({ limit: '1mb' }));

  // Security: basic headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // Auth on all /api/ routes
  app.use('/api', authMiddleware);

  // API routes
  app.use('/api/models', createModelRoutes(deps));
  app.use('/api/tasks', createTaskRoutes(deps));
  app.use('/api/mcp', createMcpRoutes(deps));
  app.use('/api/skills', createSkillRoutes(deps));
  app.use('/api/status', createStatusRoutes(deps));

  // Config save endpoint
  app.post('/api/config/save', async (_req, res) => {
    try {
      await deps.config.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  app.get('/api/config', (_req, res) => {
    const config = deps.config.get();
    // Mask API keys — show only last 4 chars
    const masked = {
      ...config,
      models: config.models.map((m) => ({
        ...m,
        apiKey: m.apiKey ? `***${m.apiKey.slice(-4)}` : '',
      })),
    };
    res.json(masked);
  });

  // Serve WebUI static files
  const webuiDist = join(process.cwd(), 'webui', 'dist');
  if (existsSync(webuiDist)) {
    app.use(express.static(webuiDist, { dotfiles: 'deny' }));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(join(webuiDist, 'index.html'));
    });
  }

  return app;
}

export async function startServer(deps: ServerDeps): Promise<void> {
  const app = createServer(deps);
  const config = deps.config.get();
  const { port, host } = config.server;

  app.listen(port, host, () => {
    logger.info(`WebUI & API server running at http://${host}:${port}`);
  });
}
