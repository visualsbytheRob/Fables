/**
 * Prompt template library (F1313) — versioned in-repo so prompts are reviewable
 * and regression-testable, not scattered string literals.
 *
 * Each template declares its slots; structured tasks instruct the model to reply
 * with JSON that the task router validates (F1315). Users can override any of
 * these at runtime (F1317) without editing source.
 */

import { defineTemplate } from './prompt.js';

export const TEMPLATES = {
  /** Suggest topical tags for a note (structured → JSON). */
  tagSuggest: defineTemplate({
    id: 'tag-suggest',
    system:
      'You suggest 3-6 short, lowercase, single-or-two-word topical tags for a note. ' +
      'Reply ONLY with JSON: {"tags": ["tag1", "tag2"]}. No prose.',
    template: 'Title: {{title}}\n\nBody:\n{{body}}',
    slots: ['title', 'body'] as const,
  }),

  /** Suggest a concise note title (structured → JSON). */
  titleSuggest: defineTemplate({
    id: 'title-suggest',
    system:
      'You propose one concise, specific title (max 8 words) for a note. ' +
      'Reply ONLY with JSON: {"title": "..."}. No prose.',
    template: 'Note body:\n{{body}}',
    slots: ['body'] as const,
  }),

  /** Summarize a note in a few sentences (free text). */
  summarize: defineTemplate({
    id: 'summarize',
    system: 'You write a faithful 1-3 sentence summary of a note. No preamble.',
    template: 'Summarize this note titled "{{title}}":\n\n{{body}}',
    slots: ['title', 'body'] as const,
  }),

  /** Answer a question grounded ONLY in provided sources (RAG, free text). */
  qaAnswer: defineTemplate({
    id: 'qa-answer',
    system:
      'You answer the question using ONLY the provided sources. Cite sources by their [n] ' +
      'markers. If the sources do not contain the answer, say so plainly — do not invent.',
    template: 'Sources:\n{{sources}}\n\nQuestion: {{question}}',
    slots: ['sources', 'question'] as const,
  }),

  /** RAG answer that carries earlier turns for context (F1324 conversation memory). */
  qaFollowUp: defineTemplate({
    id: 'qa-followup',
    system:
      'You answer the latest question using ONLY the provided sources. Cite sources by their ' +
      '[n] markers. Use the conversation only to interpret what the new question refers to ' +
      '(e.g. pronouns); still ground every claim in the sources. If they lack the answer, say so.',
    template:
      'Sources:\n{{sources}}\n\nConversation so far:\n{{history}}\n\nLatest question: {{question}}',
    slots: ['sources', 'history', 'question'] as const,
  }),

  /** Propose next questions after an answer (F1328, structured → JSON). */
  followUpSuggest: defineTemplate({
    id: 'followup-suggest',
    system:
      'Given a question and the answer it received, propose 3 short, specific follow-up ' +
      'questions the user might naturally ask next. Reply ONLY with JSON: ' +
      '{"questions": ["...", "...", "..."]}. No prose.',
    template: 'Question: {{question}}\n\nAnswer: {{answer}}',
    slots: ['question', 'answer'] as const,
  }),
} as const;

export type TemplateId = (typeof TEMPLATES)[keyof typeof TEMPLATES]['id'];
