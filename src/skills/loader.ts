/**
 * Dynamic skill loader — load third-party skills from:
 *   1. Local directory (data/skills/*.js)
 *   2. npm packages (dynamic import)
 *   3. GitHub URL (clone + import)
 *
 * Each skill module must export: { name, description, execute }
 * or a factory function: (deps) => { name, description, execute }
 */
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { Skill } from './registry.js';
import { logger } from '../utils/logger.js';

export interface SkillModule {
  name: string;
  description: string;
  execute: Skill['execute'];
}

export interface SkillLoaderDeps {
  dataDir: string;
}

/**
 * Scan data/skills/ directory and dynamically import each .js/.mjs file.
 */
export async function loadSkillsFromDir(dir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  if (!existsSync(dir)) return skills;

  const files = await readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const filePath = join(dir, file);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const skill = mod.default || mod;
      if (skill.name && skill.execute) {
        skills.push(skill as Skill);
        logger.info(`[skill-loader] Loaded from file: /${skill.name} — ${skill.description || ''}`);
      }
    } catch (err) {
      logger.error(`[skill-loader] Failed to load ${file}: ${(err as Error).message}`);
    }
  }
  return skills;
}

/**
 * Install an npm package into data/skills/node_modules and import it.
 */
export async function loadSkillFromNpm(packageName: string, installDir: string): Promise<Skill | null> {
  try {
    // Install into isolated directory
    if (!existsSync(installDir)) {
      execFileSync('mkdir', ['-p', installDir]);
    }
    logger.info(`[skill-loader] Installing npm package: ${packageName}`);
    execFileSync('npm', ['install', '--prefix', installDir, packageName], {
      encoding: 'utf-8',
      timeout: 60_000,
    });

    // Import the installed package
    const modPath = join(installDir, 'node_modules', packageName);
    const mod = await import(pathToFileURL(modPath).href);
    const skill = mod.default || mod;
    if (skill.name && skill.execute) {
      logger.info(`[skill-loader] Loaded npm skill: /${skill.name}`);
      return skill as Skill;
    }
    logger.warn(`[skill-loader] Package ${packageName} does not export a valid skill`);
    return null;
  } catch (err) {
    logger.error(`[skill-loader] Failed to load npm package ${packageName}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Clone a GitHub repo and load skills from it.
 */
export async function loadSkillFromGitHub(repoUrl: string, installDir: string): Promise<Skill[]> {
  const skills: Skill[] = [];
  try {
    const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    const cloneDir = join(installDir, repoName);

    if (existsSync(cloneDir)) {
      // Pull latest
      execFileSync('git', ['-C', cloneDir, 'pull'], { encoding: 'utf-8', timeout: 30_000 });
    } else {
      logger.info(`[skill-loader] Cloning ${repoUrl}...`);
      execFileSync('git', ['clone', '--depth', '1', repoUrl, cloneDir], {
        encoding: 'utf-8',
        timeout: 60_000,
      });
    }

    // Install deps if package.json exists
    if (existsSync(join(cloneDir, 'package.json'))) {
      execFileSync('npm', ['install', '--prefix', cloneDir], { encoding: 'utf-8', timeout: 60_000 });
    }

    // Load from index.js or scan for skill files
    const indexPath = join(cloneDir, 'index.js');
    if (existsSync(indexPath)) {
      const mod = await import(pathToFileURL(indexPath).href);
      const skill = mod.default || mod;
      if (skill.name && skill.execute) {
        skills.push(skill as Skill);
      } else if (Array.isArray(skill)) {
        skills.push(...skill.filter((s: any) => s.name && s.execute));
      }
    }

    logger.info(`[skill-loader] Loaded ${skills.length} skills from ${repoUrl}`);
  } catch (err) {
    logger.error(`[skill-loader] Failed to load from ${repoUrl}: ${(err as Error).message}`);
  }
  return skills;
}
