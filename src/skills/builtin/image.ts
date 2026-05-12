/**
 * Built-in /image skill — AI image generation + image-to-image edits
 * via the active OpenAI-compatible provider (DALL-E / gpt-image-N /
 * compatible relays).
 *
 *   /image <prompt>                       generate (txt2img)
 *   /image <prompt>   + 上传图片          edit / img2img — uses the
 *                                          attached image as base
 *   /image edit <prompt>                  same; you can omit the word
 *                                          "edit" — img2img kicks in
 *                                          automatically when there's
 *                                          an image in this message OR
 *                                          one sent in the last 5min
 *   /image url <https://...>              download + send (no AI)
 *   /image -size 1024 -model dall-e-3 …   override defaults
 *
 * UX flow:
 *   - 微信用户发图 + 文字（caption 模式）→ 同一 ChatRequest 带 media
 *   - 微信用户先发图 → 几秒后发 "/image 改成赛博朋克风" → LastImageStore
 *     里有缓存（5 min TTL），自动作为 img2img 输入
 */
import OpenAI, { toFile } from 'openai';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';
import type { LastImageStore } from '../../utils/last-image-store.js';
import { logger } from '../../utils/logger.js';

const MEDIA_DIR = join(process.cwd(), 'data', 'media');
const DEFAULT_SIZE = '1024x1024';
const DEFAULT_MODEL = 'gpt-image-2';

async function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) await mkdir(MEDIA_DIR, { recursive: true });
}

async function downloadImage(url: string, timeoutMs = 60_000): Promise<string> {
  await ensureMediaDir();
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/png';
  const ext = ct.includes('png') ? '.png' : ct.includes('gif') ? '.gif' : ct.includes('webp') ? '.webp' : '.jpg';
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
    if (t === 'edit') continue; // syntactic sugar
    rest.push(t);
  }
  return { size, model, prompt: rest.join(' ').trim() };
}

async function pickInputImage(request: ChatRequest, lastImage: LastImageStore | null): Promise<{ filePath: string; mimeType?: string } | null> {
  if (request.media?.type === 'image' && request.media.filePath) {
    return { filePath: request.media.filePath, mimeType: request.media.mimeType };
  }
  if (!lastImage) return null;
  const cached = lastImage.get(request.conversationId);
  if (cached) return { filePath: cached.filePath, mimeType: cached.mimeType };
  return null;
}

export function createImageSkill(access: ProviderAccess, lastImage?: LastImageStore): Skill {
  const lastImg = lastImage ?? null;
  return {
    name: 'image',
    description: 'AI 生成 / 编辑图片. /image <描述> 或 发图 + /image <修改描述>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';
      if (!text && !request.media) {
        return {
          text: [
            '用法：',
            '/image <描述>                 — 生成 (gpt-image-2)',
            '发图 + /image <修改描述>      — 编辑 / 图生图',
            '/image url https://...        — 直接发指定图片',
            '/image -size 512 -model dall-e-3 <描述>',
          ].join('\n'),
        };
      }

      // Direct URL pass-through
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

      const provider = access.getActive(request.conversationId);
      if (!provider) return { text: '⚠️ 还没配置模型，去 WebUI Models 页面加一个 OpenAI 兼容的 key' };
      if (provider.config.provider !== 'openai') {
        return { text: `⚠️ 图片生成需要 OpenAI 兼容的 provider，当前是 \`${provider.config.provider}\`` };
      }

      const { size, model, prompt } = parseOpts(text);
      if (!prompt) return { text: '⚠️ 缺少描述' };

      const openai = new OpenAI({
        apiKey: provider.config.apiKey,
        baseURL: provider.config.baseUrl || 'https://api.openai.com/v1',
      });
      const imageModel = model ?? DEFAULT_MODEL;

      const input = await pickInputImage(request, lastImg);

      try {
        let resultPath: string;
        if (input) {
          // ── img2img ──
          logger.info(`[image] edit via ${provider.config.baseUrl ?? 'openai'} model=${imageModel} size=${size} base=${basename(input.filePath)} prompt="${prompt.slice(0, 80)}"`);
          const buf = await readFile(input.filePath);
          const fileName = basename(input.filePath);
          const mime = input.mimeType || 'image/png';
          const file = await toFile(buf, fileName, { type: mime });
          const result = await openai.images.edit({
            model: imageModel as any,
            image: file,
            prompt,
            n: 1,
            size: size as any,
          });
          const item = result.data?.[0];
          if (item?.url) resultPath = await downloadImage(item.url);
          else if ((item as any)?.b64_json) resultPath = await saveBase64Image((item as any).b64_json);
          else return { text: '⚠️ 编辑失败：未返回图片数据' };
          // Cache the output as the next "last image" so user can chain
          // edits ("再加个霓虹灯" right after).
          lastImg?.put(request.conversationId, resultPath, 'image/png');
        } else {
          // ── txt2img ──
          logger.info(`[image] gen via ${provider.config.baseUrl ?? 'openai'} model=${imageModel} size=${size} prompt="${prompt.slice(0, 80)}"`);
          const result = await openai.images.generate({
            model: imageModel as any,
            prompt,
            n: 1,
            size: size as any,
          });
          const item = result.data?.[0];
          if (item?.url) resultPath = await downloadImage(item.url);
          else if ((item as any)?.b64_json) resultPath = await saveBase64Image((item as any).b64_json);
          else return { text: '⚠️ 生成失败：未返回图片数据' };
          lastImg?.put(request.conversationId, resultPath, 'image/png');
        }
        return { media: { type: 'image', url: resultPath } };
      } catch (err) {
        const msg = (err as Error).message;
        logger.error(`[image] failed: ${msg}`);
        if (/(404|not found|no such model|unknown model|not supported)/i.test(msg)) {
          return {
            text: [
              `⚠️ 中转/模型不支持 \`${imageModel}\``,
              '',
              '可尝试：',
              `\`/image -model gpt-image-1 ${prompt}\``,
              `\`/image -model dall-e-3 ${prompt}\``,
              `\`/image -model dall-e-2 ${prompt}\`  (img2img 兼容性最好)`,
            ].join('\n'),
          };
        }
        return { text: `⚠️ ${input ? '编辑' : '生成'}失败：${msg.slice(0, 200)}` };
      }
    },
  };
}
