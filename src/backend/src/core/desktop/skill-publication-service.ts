import fs from 'node:fs';
import path from 'node:path';

import { resolveOpencodeSkillsDir } from '../workspace-paths.ts';

export interface PublishSkillInput {
  skill: string;
  content: string;
  mode: 'replace' | 'create';
}

export interface PublishSkillResult {
  skillPath: string;
  backupPath: string;
}

export class SkillPublicationService {
  private readonly workflowRoot: string;

  constructor(workflowRoot: string) {
    this.workflowRoot = workflowRoot;
  }

  publish(input: PublishSkillInput): PublishSkillResult {
    assertSkillName(input.skill);
    const content = input.content.trimEnd();
    if (!content.trim()) throw new Error('Skill content is empty');

    const skillDir = path.join(resolveOpencodeSkillsDir(this.workflowRoot), input.skill);
    const skillFile = path.join(skillDir, 'SKILL.md');
    const exists = fs.existsSync(skillFile);
    if (input.mode === 'replace' && !exists) throw new Error(`Skill not found: ${input.skill}`);
    if (input.mode === 'create' && exists) throw new Error(`Skill already exists: ${input.skill}`);

    let backupPath = '';
    if (exists) {
      const backupDir = path.join(this.workflowRoot, 'runtime', 'backups', 'skills', timestamp(), input.skill);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(skillFile, path.join(backupDir, 'SKILL.md'));
      backupPath = path.relative(this.workflowRoot, backupDir);
    }

    fs.mkdirSync(skillDir, { recursive: true });
    const tempFile = path.join(skillDir, `.SKILL.${Date.now().toString(36)}.tmp`);
    fs.writeFileSync(tempFile, content + '\n');
    fs.renameSync(tempFile, skillFile);
    return {
      skillPath: path.relative(this.workflowRoot, skillFile),
      backupPath,
    };
  }

}

export function assertSkillName(skill: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) {
    throw new Error('Skill name must match ^[a-z0-9][a-z0-9-]*$');
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
