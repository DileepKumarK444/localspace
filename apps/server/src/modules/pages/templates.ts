import { callout, doc, expand, h, ol, p, table, taskList, ul, type Node } from './builders';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  build: () => Node[];
}

const TEMPLATES: TemplateDef[] = [
  { id: 'blank', name: 'Blank page', description: 'Start from scratch', icon: 'file', build: () => [p()] },
  {
    id: 'meeting-notes', name: 'Meeting notes', description: 'Agenda, notes and action items', icon: 'users',
    build: () => [
      p('Date: {{date}}  ·  Attendees: '),
      h(2, 'Agenda'), ol(['Topic one'], ['Topic two']),
      h(2, 'Notes'), p(),
      h(2, 'Decisions'), ul(['']),
      h(2, 'Action items'), taskList({ text: 'Owner — action' }),
    ],
  },
  {
    id: 'project-plan', name: 'Project plan', description: 'Goals, scope, milestones and risks', icon: 'target',
    build: () => [
      callout('info', 'Summary: one or two sentences describing the project and why it matters.'),
      h(2, 'Goals'), ul(['Goal one'], ['Goal two']),
      h(2, 'Scope'), p('In scope / out of scope.'),
      h(2, 'Milestones'),
      table([['Milestone', 'Owner', 'Due', 'Status'], ['', '', '', 'Not started'], ['', '', '', 'Not started']]),
      h(2, 'Risks'), callout('warning', 'List the top risks and how you will mitigate them.'),
    ],
  },
  {
    id: 'decision-record', name: 'Decision record', description: 'Context, options and the decision made', icon: 'scale',
    build: () => [
      p('Status: Proposed  ·  Date: {{date}}'),
      h(2, 'Context'), p('What problem are we solving, and what constraints apply?'),
      h(2, 'Options considered'),
      table([['Option', 'Pros', 'Cons'], ['A', '', ''], ['B', '', '']]),
      h(2, 'Decision'), callout('note', 'We will …'),
      h(2, 'Consequences'), ul(['Positive: '], ['Negative: ']),
    ],
  },
  {
    id: 'how-to', name: 'How-to guide', description: 'Step-by-step instructions', icon: 'book',
    build: () => [
      p('This guide explains how to …'),
      h(2, 'Before you begin'), ul(['Prerequisite one']),
      h(2, 'Steps'), ol(['First step'], ['Second step']),
      expand('Troubleshooting', p('Common problems and fixes.')),
    ],
  },
  {
    id: 'daily-note', name: 'Daily note', description: 'Date-stamped log with priorities', icon: 'book',
    build: () => [
      h(2, '{{weekday}}, {{date}}'),
      h(3, 'Top priorities'), taskList({ text: 'Priority one' }, { text: 'Priority two' }),
      h(3, 'Notes'), p(),
      h(3, 'Done today'), ul(['']),
    ],
  },
  {
    id: 'bug-report', name: 'Bug report', description: 'Steps, expected vs actual, environment', icon: 'target',
    build: () => [
      callout('error', 'Summary of the problem in one sentence.'),
      h(2, 'Steps to reproduce'), ol(['Step one'], ['Step two']),
      h(2, 'Expected vs actual'),
      table([['Expected', 'Actual'], ['', '']]),
      h(2, 'Environment'), ul(['Version: '], ['OS / browser: ']),
      h(2, 'Logs'), p('Paste relevant output here.'),
    ],
  },
  {
    id: 'retrospective', name: 'Retrospective', description: 'What went well, what did not, what next', icon: 'refresh',
    build: () => [
      h(2, 'What went well'), ul(['']),
      h(2, 'What did not go well'), ul(['']),
      h(2, 'What we will try next'), taskList({ text: 'Experiment' }),
    ],
  },
];

export const listBuiltinTemplates = () => TEMPLATES.map(({ id, name, description, icon }) => ({ id, name, description, icon, custom: false }));

export function templateContent(id: string): string | null {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? doc(...t.build()) : null;
}
