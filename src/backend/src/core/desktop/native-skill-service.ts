import { assertSkillName, SkillPublicationService } from './skill-publication-service.ts';
import { nativeSkillUsagePrinciples } from './nativeSkillServiceLocalization.ts';

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
    ...nativeSkillUsagePrinciples(),
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
