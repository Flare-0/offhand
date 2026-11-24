import { z } from 'zod';
import { AE_DOCS, type DocEntry } from '../data/ae-docs.js';
import { OffhandError } from '../../shared/errors.js';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

export interface DocMatch {
  id: string;
  title: string;
  kind: DocEntry['kind'];
  signature?: string;
  summary: string;
  url: string;
  score: number;
}

function matchesWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
}

export function searchDocs(query: string, limit = 5): DocMatch[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_.]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);

  if (terms.length === 0) return [];

  const matches: DocMatch[] = [];

  for (const entry of AE_DOCS) {
    const id = entry.id.toLowerCase();
    const title = entry.title.toLowerCase();
    const summary = entry.summary.toLowerCase();
    const body = entry.body.toLowerCase();
    const tags = (entry.tags ?? []).map((tag) => tag.toLowerCase());

    let score = 0;
    for (const term of terms) {
      if (id === term || title === term) score += 20;
      else if (id.includes(term)) score += 12;
      else if (title.includes(term)) score += 10;
      else if (tags.some((tag) => tag === term)) score += 8;
      else if (tags.some((tag) => tag.includes(term))) score += 5;
      else if (matchesWord(summary, term)) score += 4;
      else if (matchesWord(body, term)) score += 2;
    }

    if (score > 0) {
      matches.push({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        ...(entry.signature ? { signature: entry.signature } : {}),
        summary: entry.summary,
        url: entry.url,
        score,
      });
    }
  }

  return matches
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

export function getDoc(id: string): DocEntry {
  const entry = AE_DOCS.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new OffhandError('DOC_NOT_FOUND', `No bundled doc entry with id "${id}".`, {
      hint: 'Call docs with action="search" and a query to discover valid ids.',
    });
  }
  return entry;
}

export const docsTool: ToolDefinition = {
  name: 'docs',
  title: 'After Effects docs',
  description:
    'Search a bundled After Effects scripting and expression reference. Use this before writing ExtendScript, or when unsure which AE object or method to use. action="search" (default) takes query; action="get" takes id. Read-only.',
  inputSchema: {
    action: z.enum(['search', 'get']).default('search').describe('search or get'),
    query: z.string().min(1).max(200).optional().describe('Search terms, e.g. "save frame png".'),
    id: z.string().min(1).max(120).optional().describe('Entry id from a previous search.'),
    limit: z.number().int().min(1).max(10).default(5).describe('Maximum search results.'),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(args) {
    if (args.action === 'get') {
      if (!args.id) {
        throw new OffhandError('INVALID_ARGS', 'action="get" requires id.', {
          hint: 'Run docs with action="search" first, then pass one of the returned ids.',
        });
      }
      const entry = getDoc(args.id);
      return textResult({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        signature: entry.signature,
        summary: entry.summary,
        body: entry.body,
        url: entry.url,
        tags: entry.tags,
      });
    }

    if (!args.query) {
      throw new OffhandError('INVALID_ARGS', 'action="search" requires query.', {
        hint: 'Examples: "keyframe ease", "text document", "save frame png".',
      });
    }

    const results = searchDocs(args.query, args.limit);
    return textResult({
      query: args.query,
      count: results.length,
      results: results.map(({ id, title, kind, signature, summary, url }) => ({
        id,
        title,
        kind,
        signature,
        summary,
        url,
      })),
      ...(results.length === 0
        ? { hint: 'No match. Try a broader term such as "keyframe", "mask", "shape", or "render".' }
        : {}),
    });
  },
};
