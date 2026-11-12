import type { DocNode, TemplateInfo } from '@localspace/shared';
import { getWorkspaceId, prisma } from '../../db';
import { notFound } from '../../errors';
import { listBuiltinTemplates, templateContent } from '../pages/templates';

/** Replaces {{date}}, {{time}}, {{weekday}} and {{title}} in every text node. Unknown placeholders are left as typed. */
export function applyVariables(contentJson: string, vars: { title: string; now?: Date }): string {
  const now = vars.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    title: vars.title,
  };
  const walk = (n: DocNode) => {
    if (n.type === 'text' && n.text) n.text = n.text.replace(/\{\{\s*(date|time|weekday|title)\s*\}\}/g, (_m, k: string) => map[k]);
    n.content?.forEach(walk);
  };
  const doc = JSON.parse(contentJson) as DocNode;
  walk(doc);
  return JSON.stringify(doc);
}

export async function listAllTemplates(): Promise<TemplateInfo[]> {
  const custom = await prisma.template.findMany({ orderBy: { createdAt: 'desc' } });
  return [...listBuiltinTemplates(), ...custom.map((t) => ({ id: t.id, name: t.name, description: t.description, icon: 'file', custom: true }))];
}

/** Content for a built-in or custom template id, or null if unknown. */
export async function resolveTemplate(id: string): Promise<string | null> {
  return templateContent(id) ?? (await prisma.template.findUnique({ where: { id } }))?.contentJson ?? null;
}

export async function createTemplate(input: { name: string; description?: string; fromPageId: string }): Promise<TemplateInfo> {
  const page = await prisma.page.findFirst({ where: { id: input.fromPageId, deletedAt: null } });
  if (!page) throw notFound('Page');
  const t = await prisma.template.create({ data: { workspaceId: await getWorkspaceId(), name: input.name, description: input.description ?? '', contentJson: page.contentJson } });
  return { id: t.id, name: t.name, description: t.description, icon: 'file', custom: true };
}

export async function updateTemplate(id: string, input: { name?: string; description?: string }): Promise<TemplateInfo> {
  if (!(await prisma.template.findUnique({ where: { id } }))) throw notFound('Template');
  const t = await prisma.template.update({ where: { id }, data: input });
  return { id: t.id, name: t.name, description: t.description, icon: 'file', custom: true };
}

export async function deleteTemplate(id: string) {
  const r = await prisma.template.deleteMany({ where: { id } });
  if (!r.count) throw notFound('Template');
}
