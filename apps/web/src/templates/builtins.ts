/**
 * Starter templates (F265/F266): entity sheets for worldbuilding and a Forge
 * scene skeleton, seeded as notes in the Templates notebook on demand.
 */

export interface BuiltinTemplate {
  title: string;
  body: string;
}

export const builtinTemplates: BuiltinTemplate[] = [
  {
    title: 'Character Sheet',
    body: `# {{prompt:Character name}}

Created {{date}}.

## Essence
- **Role:** {{prompt:Role}}
- **Want:**
- **Wound:**

## Appearance
{{cursor}}

## Voice & mannerisms

## Relationships
- [[ ]]

## Secrets
`,
  },
  {
    title: 'Location Sheet',
    body: `# {{prompt:Location name}}

Created {{date}}.

## First impression
{{cursor}}

## Sights, sounds, smells

## Who is found here
- [[ ]]

## History

## Hooks & dangers
`,
  },
  {
    title: 'Item Card',
    body: `# {{prompt:Item name}}

Created {{date}}.

- **Type:**
- **Owner:** [[ ]]
- **Found at:** [[ ]]

## Description
{{cursor}}

## Powers & costs

## History
`,
  },
  {
    title: 'Story Scene',
    body: `# Scene: {{prompt:Scene name}}

Drafted {{date}} {{time}} for [[{{title}}]].

## Setting
- **Where:** [[ ]]
- **When:**
- **Who:** [[ ]]

## Goal → conflict → turn
{{cursor}}

## Choices offered
1.
2.

## State changes
- sets:
- requires:
`,
  },
];
