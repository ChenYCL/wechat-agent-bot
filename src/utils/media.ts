import { readFile } from 'node:fs/promises';

export async function readFileAsBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return buffer.toString('base64');
}
