/**
 * Built-in /image skill — generate images via the active OpenAI-compatible
 * provider (DALL-E / gpt-image-1 / any model exposed on `/v1/images/generations`)
 * or download a specific URL.
 *
 *   /image <prompt>             — AI-generate an image
 *   /image url <https://...>    — download + send the image at that URL
 *   /image -size 512 <prompt>   — override size (default 1024)
 *
 * The skill uses the apiKey + baseUrl of the user's active model, so as
 * long as they've configured an OpenAI-compatible provider (OpenAI,
 * Azure OpenAI, 中转, etc.) they get whatever quality their proxy
 * supports without any extra config.
 */
import OpenAI from 'openai';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';
import { logger } from '../../utils/logger.js';

const MEDIA_DIR = join(process.cwd(), 'data', 'media');
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_MODEL = 'dall-e-3';

async function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) await mkdir(MEDIA_DIR, { recursive: true });
}

async function downloadImage(url: string, timeoutMs = 60_000): Promise<string> {
  await ensureMediaDir();
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/png';
  const ext = contentType.includes('png') ? '.png'
    : contentType.includes('gif') ? '.gif'
    : contentType.includes('webp') ? '.webp'
    : '.jpg';
  const filePath = join(MEDIA_DIR, `${randomUUID()}${ext}`);
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  return filePath;
}

async function saveBase64Image(b64: string): Promise<string> {
  await ensureMediaDir();
  const filePath = join(MEDIA_DIR, `${randomUUID()}.png`);
  await writeFile(filePath, Buffer.from(b64, 'base64'));
  return filePath;
}

function parseOpts(text: string): { size: string; model: string | null; prompt: string } {
  let size = DEFAULT_SIZE;
  let model: string | null = null;
  const tokens = text.split(/\s+/);
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-size' || t === '--size') {
      const v = tokens[++i] || '';
      if (/^\d+$/.test(v)) size = `${v}x${v}`;
      else if (/^\d+x\d+$/.test(v)) size = v;
      continue;
    }
    if (t === '-model' || t === '--model') {
      model = tokens[++i] || null;
      continue;
    }
    rest.push(t);
  }
  return { size, model, prompt: rest.join(' ').trim() };
}

export function createImageSkill(access: ProviderAccess): Skill {
  return {
    name: 'image',
    description: 'AI 生成图片. /image <描述> 或 /image url <https://...>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';
      if (!text) {
        return { text: '用法：\n/image <描述> — AI 生成图片（如 /image 一只穿宇航服的猫）\n/image url https://... — 发送指定 URL 的图片\n/image -size 512 <描述> — 自定义尺寸' };
      }

      // Direct URL mode
      if (text.startsWith('url ')) {
        const url = text.slice(4).trim();
        if (!/^https:\/\//i.test(url)) return { text: '⚠️ 只支持 HTTPS URL' };
        try {
          const filePath = await downloadImage(url, 30_000);
          return { media: { type: 'image', url: filePath } };
        } catch (err) {
          return { text: `⚠️ ${(err as Error).message}` };
        }
      }

      // AI generation
      const provider = access.getActive(request.conversationId);
      if (!provider) {
        return { text: '⚠️ 还没配置模型，去 WebUI Models 页面加一个 OpenAI 兼容的 key' };
      }
      if (provider.config.provider !== 'openai') {
        return { text: `⚠️ 图片生成需要 OpenAI 兼容的 provider，当前是 \`${provider.config.provider}\`\n💡 切到 /model list 里 openai 的那条` };
      }

      const { size, model, prompt } = parseOpts(text);
      if (!prompt) return { text: '⚠️ 缺少描述' };

      const openai = new OpenAI({
        apiKey: provider.config.apiKey,
        baseURL: provider.config.baseUrl || 'https://api.openai.com/v1',
      });

      const imageModel = model ?? DEFAULT_MODEL;
      logger.info(`[image] gen via ${provider.config.baseUrl ?? 'openai'} model=${imageModel} size=${size} prompt="${prompt.slice(0, 80)}"`);

      try {
        const result = await openai.images.generate({
          model: imageModel,
          prompt,
          n: 1,
          size: size as any,
        });
        const item = result.data?.[0];
        let filePath: string;
        if (item?.url) filePath = await downloadImage(item.url);
        else if ((item as any)?.b64_json) filePath = await saveBase64Image((item as any).b64_json);
        else return { text: '⚠️ 生成失败：未返回图片数据' };

        return { media: { type: 'image', url: filePath } };
      } catch (err) {
        const msg = (err as Error).message;
        logger.error(`[image] generation failed: ${msg}`);
        // Common: the proxy doesn't expose /v1/images/generations or the model name is wrong
        if (/(404|not found|no such model|unknown model|not supported)/i.test(msg)) {
          return { text: `⚠️ 当前模型/中转不支持 \`${imageModel}\`\n\n💡 试试 \`/image -model gpt-image-1 ${prompt}\` 或 \`-model dall-e-2\`` };
        }
        return { text: `⚠️ 生成失败：${msg.slice(0, 200)}` };
      }
    },
  };
}
