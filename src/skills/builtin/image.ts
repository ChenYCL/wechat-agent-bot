/**
 * Built-in /image skill — generate or fetch images and send to WeChat.
 *
 * Usage:
 *   /image <prompt>         — search and send an image from Unsplash
 *   /image cat              — send a random cat image
 *   /image url <https://..> — download and send an image from URL
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import { logger } from '../../utils/logger.js';

const MEDIA_DIR = join(process.cwd(), 'data', 'media');

async function ensureMediaDir() {
  if (!existsSync(MEDIA_DIR)) await mkdir(MEDIA_DIR, { recursive: true });
}

async function downloadImage(url: string): Promise<string> {
  await ensureMediaDir();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : '.jpg';
  const filename = `${randomUUID()}${ext}`;
  const filePath = join(MEDIA_DIR, filename);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buffer);
  return filePath;
}

export function createImageSkill(): Skill {
  return {
    name: 'image',
    description: 'Send an image. Usage: /image <keyword> or /image url <https://...>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';

      if (!text) {
        return { text: 'Usage:\n/image cat — search image\n/image url https://... — send from URL' };
      }

      try {
        // Direct URL mode
        if (text.startsWith('url ')) {
          const url = text.slice(4).trim();
          if (!url.startsWith('https://')) {
            return { text: '⚠️ Only HTTPS URLs supported' };
          }
          const filePath = await downloadImage(url);
          logger.info(`[image] Downloaded: ${url} → ${filePath}`);
          return { media: { type: 'image', url: filePath } };
        }

        // Search mode — use free image APIs
        const keyword = encodeURIComponent(text);

        // Try Unsplash random photo
        const unsplashUrl = `https://source.unsplash.com/800x600/?${keyword}`;
        try {
          const filePath = await downloadImage(unsplashUrl);
          logger.info(`[image] Unsplash: ${text} → ${filePath}`);
          return {
            text: `📷 ${text}`,
            media: { type: 'image', url: filePath },
          };
        } catch {
          // Fallback: placeholder
        }

        // Fallback: picsum random
        const picsumUrl = `https://picsum.photos/800/600`;
        const filePath = await downloadImage(picsumUrl);
        return {
          text: `📷 Random image (keyword: ${text})`,
          media: { type: 'image', url: filePath },
        };
      } catch (err) {
        logger.error(`[image] Error: ${(err as Error).message}`);
        return { text: `⚠️ 图片获取失败: ${(err as Error).message}` };
      }
    },
  };
}
