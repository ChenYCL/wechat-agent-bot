import { Router } from 'express';
import { join } from 'node:path';
import type { ServerDeps } from '../index.js';
import { loadSkillsFromDir, loadSkillFromNpm, loadSkillFromGitHub } from '../../skills/loader.js';

export function createSkillRoutes(deps: ServerDeps) {
  const router = Router();
  const dataDir = join(process.cwd(), 'data');
  const skillsDir = join(dataDir, 'skills');

  // List all registered skills
  router.get('/', (_req, res) => {
    const skills = deps.skills.getAll();
    res.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        builtin: true, // TODO: track source
      })),
    });
  });

  // Load skills from data/skills/ directory
  router.post('/load-dir', async (_req, res) => {
    try {
      const skills = await loadSkillsFromDir(skillsDir);
      for (const skill of skills) {
        deps.skills.register(skill);
      }
      res.json({ ok: true, loaded: skills.map((s) => s.name) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Install and load a skill from npm
  router.post('/install-npm', async (req, res) => {
    try {
      const { packageName } = req.body;
      if (!packageName || typeof packageName !== 'string') {
        return res.status(400).json({ error: 'packageName is required' });
      }
      // Basic validation
      if (packageName.includes('..') || packageName.includes(';')) {
        return res.status(400).json({ error: 'Invalid package name' });
      }
      const skill = await loadSkillFromNpm(packageName, skillsDir);
      if (skill) {
        deps.skills.register(skill);
        res.json({ ok: true, name: skill.name });
      } else {
        res.status(400).json({ error: 'Package does not export a valid skill interface' });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Load skills from a GitHub repo
  router.post('/install-github', async (req, res) => {
    try {
      const { repoUrl } = req.body;
      if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'repoUrl is required' });
      }
      if (!repoUrl.startsWith('https://github.com/')) {
        return res.status(400).json({ error: 'Only GitHub HTTPS URLs are supported' });
      }
      const skills = await loadSkillFromGitHub(repoUrl, skillsDir);
      for (const skill of skills) {
        deps.skills.register(skill);
      }
      res.json({ ok: true, loaded: skills.map((s) => s.name) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Unregister a skill
  router.delete('/:name', (req, res) => {
    deps.skills.unregister(req.params.name);
    res.json({ ok: true });
  });

  return router;
}
