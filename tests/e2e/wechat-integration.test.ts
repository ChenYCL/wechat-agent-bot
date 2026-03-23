/**
 * WeChat Integration Test
 *
 * Full integration test that exercises the REAL weixin-agent-sdk code
 * against a mock WeChat API server. Tests the entire flow:
 *
 *   1. login() → QR scan simulation → token saved
 *   2. start() → long-poll loop → receives mock messages
 *   3. agent.chat() → processes message → sends reply
 *   4. Verify sent messages captured by mock server
 *
 * This is the closest to real E2E without an actual WeChat account.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { login, start } from 'weixin-agent-sdk';
import type { Agent, ChatRequest, ChatResponse } from 'weixin-agent-sdk';
import { MockWeChatServer } from './mock-wechat-server.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WeChat SDK Integration', () => {
  let mockServer: MockWeChatServer;
  let baseUrl: string;
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    // Temp state dir so we don't pollute ~/.openclaw
    tmpDir = await mkdtemp(join(tmpdir(), 'wechat-integration-'));
    originalEnv = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = tmpDir;

    // Start mock WeChat API
    mockServer = new MockWeChatServer();
    const port = await mockServer.start();
    baseUrl = mockServer.getBaseUrl();
  });

  afterAll(async () => {
    await mockServer.stop();
    if (originalEnv !== undefined) {
      process.env.OPENCLAW_STATE_DIR = originalEnv;
    } else {
      delete process.env.OPENCLAW_STATE_DIR;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    mockServer.clearSentMessages();
  });

  it('should login via mock QR code flow', async () => {
    const accountId = await login({
      baseUrl,
      log: () => {}, // suppress output in tests
    });

    expect(accountId).toBeTruthy();
    expect(typeof accountId).toBe('string');
    // The SDK normalizes "mock-bot-id@im.bot" → "mock-bot-id-im-bot"
    expect(accountId).toContain('mock-bot-id');
  });

  it('should receive and reply to messages via start()', async () => {
    // First login to ensure we have credentials
    await login({ baseUrl, log: () => {} });

    // Track received messages
    const receivedMessages: ChatRequest[] = [];

    const agent: Agent = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        receivedMessages.push(request);
        return { text: `Echo: ${request.text}` };
      },
    };

    // Queue a message BEFORE starting the bot
    mockServer.queueMessage('user-123', 'Hello bot!');

    // Start the bot with abort signal (so we can stop it)
    const abortController = new AbortController();

    // Run bot in background, stop after a short poll cycle
    const botPromise = start(agent, {
      abortSignal: abortController.signal,
      log: () => {},
    });

    // Wait for one poll cycle to process the queued message
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Queue another message during runtime
    mockServer.queueMessage('user-456', 'Second message');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Stop the bot
    abortController.abort();
    await botPromise.catch(() => {}); // ignore abort error

    // Verify: agent received the messages
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(receivedMessages[0].text).toContain('Hello bot!');
    expect(receivedMessages[0].conversationId).toBe('user-123');

    // Verify: bot sent replies back through the mock server
    const sent = mockServer.getSentMessages();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].text).toContain('Echo: Hello bot!');
  }, 15000); // longer timeout for poll cycles

  it('should handle slash commands (SDK built-in)', async () => {
    await login({ baseUrl, log: () => {} });

    const agent: Agent = {
      async chat(request: ChatRequest): Promise<ChatResponse> {
        return { text: `Processed: ${request.text}` };
      },
    };

    // Queue an /echo command (handled by SDK internally)
    mockServer.queueMessage('user-789', '/echo test message');

    const abortController = new AbortController();
    const botPromise = start(agent, {
      abortSignal: abortController.signal,
      log: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    abortController.abort();
    await botPromise.catch(() => {});

    // /echo is handled by the SDK itself, not the agent
    // So the reply should come from the SDK's slash command handler
    const sent = mockServer.getSentMessages();
    expect(sent.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it('should handle empty message queue gracefully', async () => {
    await login({ baseUrl, log: () => {} });

    const agent: Agent = {
      async chat(): Promise<ChatResponse> {
        return { text: 'ok' };
      },
    };

    const abortController = new AbortController();
    const botPromise = start(agent, {
      abortSignal: abortController.signal,
      log: () => {},
    });

    // Wait one cycle with no messages
    await new Promise((resolve) => setTimeout(resolve, 1500));
    abortController.abort();
    await botPromise.catch(() => {});

    // No messages sent because no messages received
    expect(mockServer.getSentMessages()).toHaveLength(0);
  }, 10000);
});
