/**
 * CSV → entities importer (F1463).
 *
 * Each row in a CSV file becomes one StagedDoc (note). Title is taken from a
 * name/title column (case-insensitive). Body is a markdown "Properties" table
 * of remaining non-empty columns. A tags/Tags column yields tags[].
 */

import fs from 'node:fs';
import path from 'node:path';
import { validation } from '@fables/core';
import type { SourceAdapter, StagedDoc } from '../framework/index.js';
import { parseCsv } from '../notion/adapter.js';

export interface CsvEntitiesInput {
  path: string;
}

export class CsvEntitiesAdapter implements SourceAdapter {
  readonly name = 'csv';
  constructor(private readonly input: CsvEntitiesInput) {}

  stage(): StagedDoc[] {
    const filePath = resolveCsvPath(this.input.path);
    const text = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(text);
    if (rows.length === 0) return [];

    const basename = path.basename(filePath, '.csv');
    const notebookPath = ['Entities', basename];

    return rows.map((row, index) => rowToDoc(row, index, basename, notebookPath));
  }
}

// ── Path validation ───────────────────────────────────────────────────────────

function resolveCsvPath(inputPath: string): string {
  if (inputPath.includes('\0') || !path.isAbsolute(inputPath)) {
    throw validation('import path must be an absolute path with no NUL bytes');
  }
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw validation('import path does not exist', { path: inputPath });
  }
  if (!fs.statSync(real).isFile() || !real.toLowerCase().endsWith('.csv')) {
    throw validation('import path must be a .csv file', { path: inputPath });
  }
  return real;
}

// ── Row → StagedDoc ───────────────────────────────────────────────────────────

function rowToDoc(
  row: Record<string, string>,
  index: number,
  basename: string,
  notebookPath: string[],
): StagedDoc {
  const keys = Object.keys(row);
  const firstKey = keys[0] ?? '';

  // Find the title column (name or title, case-insensitive).
  const titleKey = keys.find((k) => /^(name|title)$/i.test(k));
  const titleValue = titleKey !== undefined ? (row[titleKey] ?? '') : (row[firstKey] ?? '');
  const title = titleValue.trim() || `Row ${index + 1}`;

  // Find the tags column.
  const tagsKey = keys.find((k) => /^tags?$/i.test(k));
  const tags: string[] =
    tagsKey !== undefined && row[tagsKey]
      ? row[tagsKey]!.split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  // Build the properties table from remaining non-empty columns.
  const skipKeys = new Set<string>();
  if (titleKey !== undefined) skipKeys.add(titleKey);
  if (tagsKey !== undefined) skipKeys.add(tagsKey);

  const tableRows: string[] = [];
  for (const key of keys) {
    if (skipKeys.has(key)) continue;
    const value = row[key] ?? '';
    if (!value.trim()) continue;
    tableRows.push(`| ${escapeTableCell(key)} | ${escapeTableCell(value)} |`);
  }

  const body =
    tableRows.length > 0
      ? `## Properties\n\n| Field | Value |\n| --- | --- |\n${tableRows.join('\n')}`
      : '';

  const sourceId = `${basename}-${index}`.toLowerCase();

  return {
    sourceId,
    title,
    body,
    notebookPath,
    tags,
    assets: [],
    links: [],
  };
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}
