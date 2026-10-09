'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  deleteActivityAction,
  exportPromptAction,
  generateIdeasAction,
  importIdeasAction,
  setActivityStatusAction,
} from '../actions';
import { field, Message, primary, secondary, useAction } from '../forms';

type Row = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  costMinEur: number;
  costMaxEur: number;
  durationMinutes: number;
  status: 'draft' | 'active' | 'blocked';
  source: 'manual' | 'claude' | 'import';
  placeQuery: string | null;
  atHome: boolean;
};

const SOURCE = { manual: '', claude: ' · by Claude', import: ' · imported' };

export function ActivityRow({ activity: a }: { activity: Row }) {
  const { pending, message, run } = useAction();
  const status = (s: Row['status'], label: string) => (
    <button
      type="button"
      className={secondary}
      disabled={pending}
      onClick={() =>
        run(
          () => setActivityStatusAction(a.id, s),
          () => `${label}.`,
        )
      }
    >
      {label}
    </button>
  );
  return (
    <li className="flex flex-col gap-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/admin/activities/${a.id}`} className="flex flex-col">
          <span className="font-medium">{a.title}</span>
          <span className="text-xs text-stone-500">
            {a.category} · {a.costMinEur}–{a.costMaxEur} € · {a.durationMinutes} min
            {a.atHome ? ' · at home' : a.placeQuery ? ` · “${a.placeQuery}”` : ''}
            {SOURCE[a.source]}
          </span>
          <span className="text-xs text-stone-400">{a.tags.join(', ')}</span>
        </Link>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {a.status !== 'active' && status('active', a.status === 'draft' ? 'Approve' : 'Unblock')}
          {a.status === 'active' && status('blocked', 'Block')}
          <button
            type="button"
            className={`${secondary} text-red-600`}
            disabled={pending}
            onClick={() =>
              confirm(`Delete "${a.title}"? Past plans keep their entries.`) &&
              run(
                () => deleteActivityAction(a.id),
                () => 'Deleted.',
              )
            }
          >
            {a.status === 'draft' ? 'Reject' : 'Delete'}
          </button>
        </div>
      </div>
      <Message message={message} />
    </li>
  );
}

export function IdeasPanel({ aiEnabled }: { aiEnabled: boolean }) {
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(10);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const generate = useAction();
  const exporter = useAction();
  const importer = useAction();

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900">
      <h2 className="font-medium">New ideas</h2>
      <div className="flex flex-col gap-2 text-sm">
        <input
          className={field}
          value={focus}
          maxLength={120}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Optional focus, e.g. rainy days, winter, cheap"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={field}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} ideas
              </option>
            ))}
          </select>
          <button
            type="button"
            className={primary}
            disabled={generate.pending || !aiEnabled}
            onClick={() =>
              generate.run(
                () => generateIdeasAction({ count, focus }),
                (r) =>
                  `${r.added} new draft(s) added${r.skipped ? `, ${r.skipped} duplicate(s) skipped` : ''}.`,
              )
            }
          >
            {generate.pending ? 'Claude is thinking…' : 'Let Claude generate'}
          </button>
          <span className="text-xs text-stone-500">
            {aiEnabled ? 'One API call, typically 2–5 cents.' : 'Claude API disabled.'}
          </span>
        </div>
        <Message message={generate.message} />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-stone-600 dark:text-stone-400">
          Without API: copy prompt to the Claude app, paste the answer here
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            className={`${secondary} self-start`}
            disabled={exporter.pending}
            onClick={() =>
              exporter.run(
                () => exportPromptAction(focus),
                (text) => {
                  setPrompt(text);
                  void navigator.clipboard?.writeText(text);
                  return 'Prompt copied to clipboard.';
                },
              )
            }
          >
            Copy prompt
          </button>
          <Message message={exporter.message} />
          {prompt && (
            <textarea className={`${field} font-mono text-xs`} rows={6} readOnly value={prompt} />
          )}
          <textarea
            className={`${field} font-mono text-xs`}
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste Claude's JSON answer here"
          />
          <button
            type="button"
            className={`${primary} self-start`}
            disabled={importer.pending || importText.trim() === ''}
            onClick={() =>
              importer.run(
                () => importIdeasAction(importText),
                (r) => {
                  setImportText('');
                  return `${r.added} new draft(s) imported${r.skipped ? `, ${r.skipped} duplicate(s) skipped` : ''}.`;
                },
              )
            }
          >
            Import
          </button>
          <Message message={importer.message} />
        </div>
      </details>
    </section>
  );
}
