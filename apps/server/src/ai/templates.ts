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

  /** Rewrite a passage following an instruction (F1336, free text). */
  rewrite: defineTemplate({
    id: 'rewrite',
    system:
      'You rewrite the given text following the instruction. Preserve meaning and any ' +
      'markdown structure. Reply with ONLY the rewritten text — no preamble, no commentary.',
    template: 'Instruction: {{instruction}}\n\nText:\n{{body}}',
    slots: ['instruction', 'body'] as const,
  }),

  /** Turn messy notes into a structured markdown outline (F1335, free text). */
  outline: defineTemplate({
    id: 'outline',
    system:
      'You turn rough notes into a clean, hierarchical markdown outline using "-" bullets ' +
      "and nesting. Keep the author's content; only organise it. Reply with ONLY the outline.",
    template: 'Notes:\n{{body}}',
    slots: ['body'] as const,
  }),

  /** Extract actions + decisions from meeting notes (F1337, structured → JSON). */
  meetingStructure: defineTemplate({
    id: 'meeting-structure',
    system:
      'You structure meeting notes. Extract action items, decisions, and a one-line summary. ' +
      'Reply ONLY with JSON: {"summary": "...", "decisions": ["..."], ' +
      '"actions": [{"task": "...", "owner": "..."}]}. Use "" for an unknown owner. No prose.',
    template: 'Meeting notes:\n{{body}}',
    slots: ['body'] as const,
  }),

  /** Draft a weekly review from journal entries (F1338, free text). */
  weeklyReview: defineTemplate({
    id: 'weekly-review',
    system:
      'You draft a reflective weekly review from the journal entries provided. Cover what ' +
      'happened, wins, challenges, and a few focus points for next week. Use markdown headings.',
    template: 'Journal entries this week:\n{{body}}',
    slots: ['body'] as const,
  }),

  /** Propose wikilinks from a note to candidate notes (F1334, structured → JSON). */
  linkSuggest: defineTemplate({
    id: 'link-suggest',
    system:
      'You suggest wikilinks. Given a note and a list of candidate note titles, identify ' +
      'short phrases in the note that should link to a candidate. Only use titles from the ' +
      'list; never invent. Reply ONLY with JSON: ' +
      '{"links": [{"phrase": "...", "target": "exact candidate title"}]}. No prose.',
    template: 'Note:\n{{body}}\n\nCandidate titles:\n{{candidates}}',
    slots: ['body', 'candidates'] as const,
  }),

  // ── Story co-writer (F1341–F1346) ──────────────────────────────────────────

  /** Suggest the next story beats from the current knot (F1341, structured → JSON). */
  beatSuggest: defineTemplate({
    id: 'beat-suggest',
    system:
      'You are a story co-writer. Given the current scene, propose 3-5 possible next beats — ' +
      'short, concrete story moments that could follow. Match the established tone. Reply ONLY ' +
      'with JSON: {"beats": ["...", "..."]}. No prose.',
    template: '{{style}}Current scene:\n{{scene}}',
    slots: ['style', 'scene'] as const,
  }),

  /** Draft a set of player choices in the author's style (F1342, structured → JSON). */
  choiceExpand: defineTemplate({
    id: 'choice-expand',
    system:
      'You draft interactive-fiction choices. Given a scene, write 2-4 distinct, in-voice ' +
      'player choices that lead somewhere different. Keep each label under 12 words. Reply ONLY ' +
      'with JSON: {"choices": ["...", "..."]}. No prose.',
    template: '{{style}}Scene:\n{{scene}}',
    slots: ['style', 'scene'] as const,
  }),

  /** Draft scene prose from an outline (F1343, free text). */
  sceneDraft: defineTemplate({
    id: 'scene-draft',
    system:
      'You are a fiction co-writer. Expand the outline into vivid scene prose, honouring the ' +
      'style guidance if given. Reply with ONLY the prose — no headings, no commentary.',
    template: '{{style}}Outline:\n{{outline}}',
    slots: ['style', 'outline'] as const,
  }),

  /** Capture an author's style from sample text (F1344, structured → JSON). */
  styleCapture: defineTemplate({
    id: 'style-capture',
    system:
      'You analyse prose style. From the sample, describe the tone in one phrase and list 3-6 ' +
      'concrete stylistic traits (sentence length, diction, mood, person/tense). Reply ONLY ' +
      'with JSON: {"tone": "...", "traits": ["..."]}. No prose.',
    template: 'Sample:\n{{sample}}',
    slots: ['sample'] as const,
  }),

  /** Check a scene against known entity facts for contradictions (F1345, structured → JSON). */
  consistencyCheck: defineTemplate({
    id: 'consistency-check',
    system:
      'You are a continuity editor. Compare the scene against the established facts and list ' +
      'any contradictions. Only flag genuine conflicts grounded in the facts; never invent ' +
      'facts. Reply ONLY with JSON: {"issues": [{"claim": "...", "conflict": "...", ' +
      '"severity": "low|medium|high"}]}. Empty array if consistent. No prose.',
    template: 'Established facts:\n{{facts}}\n\nScene:\n{{scene}}',
    slots: ['facts', 'scene'] as const,
  }),

  /** Suggest content for an underdeveloped branch (F1346, structured → JSON). */
  gapAnalysis: defineTemplate({
    id: 'gap-analysis',
    system:
      'You analyse interactive-story branches. Given a description of a thin or dead-end path, ' +
      'suggest 3-5 concrete ways to develop it (new beats, choices, or consequences). Reply ' +
      'ONLY with JSON: {"suggestions": ["...", "..."]}. No prose.',
    template: 'Branch:\n{{branch}}',
    slots: ['branch'] as const,
  }),

  // ── Character & dialogue (F1351–F1358) ─────────────────────────────────────

  /** Generate dialogue grounded in a character sheet (F1351, free text). */
  dialogueGen: defineTemplate({
    id: 'dialogue-gen',
    system:
      'You write character dialogue. Stay strictly consistent with the character sheet — their ' +
      'voice, values, and knowledge. Write only what this character would plausibly say in the ' +
      'situation. Reply with ONLY the dialogue lines, no narration.',
    template: 'Character sheet:\n{{sheet}}\n\nSituation:\n{{situation}}',
    slots: ['sheet', 'situation'] as const,
  }),

  /** Distil a reusable voice card from a character's lines (F1352, structured → JSON). */
  voiceCard: defineTemplate({
    id: 'voice-card',
    system:
      "You profile a character's speech. From the sample lines, extract their voice. Reply " +
      'ONLY with JSON: {"register": "...", "quirks": ["..."], "vocabulary": ["..."], ' +
      '"catchphrases": ["..."]}. Keep lists short and concrete. No prose.',
    template: 'Character: {{name}}\n\nSample lines:\n{{lines}}',
    slots: ['name', 'lines'] as const,
  }),

  /** Polish a dialogue passage for subtext and brevity (F1353, free text). */
  dialoguePolish: defineTemplate({
    id: 'dialogue-polish',
    system:
      'You are a dialogue editor. Tighten the passage: cut filler, add subtext, keep each ' +
      "character's voice. Preserve who says what. Reply with ONLY the polished dialogue.",
    template: 'Dialogue:\n{{dialogue}}',
    slots: ['dialogue'] as const,
  }),

  /** In-character reply for NPC interview mode (F1354, free text). */
  npcInterview: defineTemplate({
    id: 'npc-interview',
    system:
      'You role-play a character for their author. Answer strictly in character, grounded in ' +
      'the sheet; if asked something the character would not know, react as they would. Never ' +
      "break character or mention being an AI. Reply with ONLY the character's response.",
    template:
      'Character sheet:\n{{sheet}}\n\nConversation so far:\n{{history}}\n\nAuthor asks: {{question}}',
    slots: ['sheet', 'history', 'question'] as const,
  }),

  /** Extract entity facts from an interview transcript (F1355, structured → JSON). */
  factExtract: defineTemplate({
    id: 'fact-extract',
    system:
      'You extract durable character facts from an interview transcript. Only include facts the ' +
      'character actually stated about themselves. Reply ONLY with JSON: ' +
      '{"facts": ["..."]}. No speculation. No prose.',
    template: 'Transcript:\n{{transcript}}',
    slots: ['transcript'] as const,
  }),

  /** Suggest relationship dynamics between characters (F1356, structured → JSON). */
  relationshipDynamics: defineTemplate({
    id: 'relationship-dynamics',
    system:
      'You suggest relationship dynamics between characters from their facts and connections. ' +
      'Propose tensions, alliances, or histories worth developing. Reply ONLY with JSON: ' +
      '{"dynamics": [{"between": "A & B", "dynamic": "..."}]}. No prose.',
    template: 'Characters and connections:\n{{graph}}',
    slots: ['graph'] as const,
  }),

  /** Generate world-consistent names (F1357, structured → JSON). */
  nameGen: defineTemplate({
    id: 'name-gen',
    system:
      'You generate names that fit a fictional world. Match the linguistic feel of the world ' +
      'description. Reply ONLY with JSON: {"names": ["..."]}. No prose.',
    template: 'World:\n{{world}}\n\nGenerate names for: {{kind}}',
    slots: ['world', 'kind'] as const,
  }),

  /** Summarise a character's arc across story branches (F1358, structured → JSON). */
  arcTracker: defineTemplate({
    id: 'arc-tracker',
    system:
      "You track a character's arc. From the scenes (which may span branches), summarise how " +
      'the character changes and list the key turning points. Reply ONLY with JSON: ' +
      '{"summary": "...", "turningPoints": ["..."]}. No prose.',
    template: 'Character: {{name}}\n\nScenes:\n{{scenes}}',
    slots: ['name', 'scenes'] as const,
  }),
} as const;

export type TemplateId = (typeof TEMPLATES)[keyof typeof TEMPLATES]['id'];
