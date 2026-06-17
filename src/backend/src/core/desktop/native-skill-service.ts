import { assertSkillName, SkillPublicationService } from './skill-publication-service.ts';

export interface CreateNativeSkillResult {
  skill: string;
  skillPath: string;
  backupPath: string;
}

export function createNativeSkill(
  workflowRoot: string,
  skill: string,
  description: string,
): CreateNativeSkillResult {
  assertSkillName(skill);
  const normalizedDescription = normalizeDescription(description);
  const content = [
    '---',
    `name: ${skill}`,
    `description: ${normalizedDescription}`,
    '---',
    '',
    `# ${skill}`,
    '',
    normalizedDescription,
    '',
    '## 使用原则',
    '',
    '- 先读取当前项目事实，再给出判断。',
    '- 缺少关键约束时直接 ASK，不要自行假设。',
    '- 需要写入工程时遵守项目的受控写入、验证和回滚流程。',
    '',
  ].join('\n');
  const result = new SkillPublicationService(workflowRoot).publish({
    skill,
    content,
    mode: 'create',
  });
  return { skill, ...result };
}

function normalizeDescription(value: string): string {
  const description = String(value || '').replace(/\s+/g, ' ').trim();
  if (!description) throw new Error('Skill description is required');
  return description;
}
