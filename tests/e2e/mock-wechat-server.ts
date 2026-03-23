/**
 * Mock WeChat API Server
 *
 * Simulates the ilinkai.weixin.qq.com API endpoints used by weixin-agent-sdk:
 *   - POST /ilink/bot/get_bot_qrcode   → returns fake QR code
 *   - POST /ilink/bot/get_qrcode_status → auto-confirms login
 *   - POST /ilink/bot/getupdates       → returns queued messages
 *   - POST /ilink/bot/sendmessage      → captures sent messages
 *   - POST /ilink/bot/getconfig        → returns typing ticket
 *   - POST /ilink/bot/sendtyping       → no-op
 *   - POST /ilink/bot/getuploadurl     → returns fake upload URL
 *
 * This enables full integration testing of the WeChat pipeline
 * without a real WeChat account.
 */
import express from 'express';
import type { Server } from 'node:http';

export interface QueuedMessage {
  from_user_id: string;
  item_list: Array<{ type: number; text_item?: { text: string } }>;
  context_token?: string;
  create_time_ms?: number;
}

export interface SentMessage {
  to: string;
  text?: string;
  timestamp: number;
}

export class MockWeChatServer {
  private app: express.Express;
  private server: Server | null = null;
  private port = 0;

  // Inbound message queue (simulates messages FROM users TO bot)
  private inboundQueue: QueuedMessage[] = [];
  // Captured outbound messages (sent BY bot TO users)
  public sentMessages: SentMessage[] = [];
  // Login state
  private loginConfirmed = false;
  private autoConfirmLogin = true;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes() {
    // QR code login (SDK uses GET with query params)
    this.app.all('/ilink/bot/get_bot_qrcode', (_req, res) => {
      res.json({
        qrcode: 'mock-qrcode-token',
        qrcode_img_content: 'https://mock.example.com/qr.png',
      });
    });

    // QR code status (SDK uses GET with query params)
    this.app.all('/ilink/bot/get_qrcode_status', (_req, res) => {
      if (this.autoConfirmLogin || this.loginConfirmed) {
        this.loginConfirmed = true;
        res.json({
          status: 'confirmed',
          bot_token: 'mock-bot-token-abc123',
          ilink_bot_id: 'mock-bot-id@im.bot',
          ilink_user_id: 'mock-user-id',
          baseurl: `http://127.0.0.1:${this.port}`,
        });
      } else {
        res.json({ status: 'wait' });
      }
    });

    // Long-poll getUpdates
    this.app.post('/ilink/bot/getupdates', (_req, res) => {
      const msgs = this.inboundQueue.splice(0);
      res.json({
        ret: 0,
        errcode: 0,
        msgs,
        get_updates_buf: 'mock-sync-buf',
      });
    });

    // Send message (capture) — SDK wraps in { msg: { to_user_id, item_list } }
    this.app.post('/ilink/bot/sendmessage', (req, res) => {
      const body = req.body;
      const msg = body.msg || body;
      this.sentMessages.push({
        to: msg.to_user_id || msg.ilink_user_id || '',
        text: msg.item_list?.[0]?.text_item?.text || '',
        timestamp: Date.now(),
      });
      res.json({ ret: 0, errcode: 0 });
    });

    // Get config (typing ticket)
    this.app.post('/ilink/bot/getconfig', (_req, res) => {
      res.json({
        ret: 0,
        typing_ticket: 'mock-typing-ticket',
      });
    });

    // Send typing indicator (no-op)
    this.app.post('/ilink/bot/sendtyping', (_req, res) => {
      res.json({ ret: 0 });
    });

    // Get upload URL (fake)
    this.app.post('/ilink/bot/getuploadurl', (_req, res) => {
      res.json({
        ret: 0,
        upload_url: 'https://mock.cdn.example.com/upload',
        file_id: 'mock-file-id',
        aes_key: 'mock-aes-key',
      });
    });
  }

  /** Queue a message to be delivered on next getUpdates poll. */
  queueMessage(fromUserId: string, text: string) {
    this.inboundQueue.push({
      from_user_id: fromUserId,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: 'mock-ctx-token',
      create_time_ms: Date.now(),
    });
  }

  /** Get all messages sent by the bot. */
  getSentMessages(): SentMessage[] {
    return [...this.sentMessages];
  }

  /** Clear sent messages. */
  clearSentMessages() {
    this.sentMessages = [];
  }

  /** Start the mock server on a random port. */
  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve(this.port);
      });
    });
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
