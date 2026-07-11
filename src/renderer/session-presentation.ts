import {
  GitPullRequestDraft,
  GitPullRequestArrow,
  GitMerge,
  GitPullRequestClosed,
} from 'lucide-react';
import type { PrRef, SessionStage, SessionStatus } from '../shared/types';

// How a session presents itself anywhere in the UI: status colours, stage
// icons, and the shortening helpers. One lookup, N components.

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'var(--status-idle)',
  waiting: 'var(--status-idle)',
  thinking: 'var(--status-thinking)',
  generating: 'var(--status-generating)',
  creating: 'var(--status-creating)',
  error: 'var(--status-error)',
  ended: 'var(--status-ended)',
};

export function statusColor(status: SessionStatus | string): string {
  return STATUS_COLORS[status as SessionStatus] ?? 'var(--text-dimmed)';
}

export const PULSING_STATUSES: ReadonlySet<string> = new Set([
  'thinking',
  'generating',
  'waiting',
]);

/** "/Users/me/code/app" → "~/code/app" */
export function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

/** "claude-opus-4-6" → "opus-4-6" */
export function shortenModel(model: string): string {
  return model.replace(/^claude-/, '');
}

export function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

// ─── PR stage ────────────────────────────────────────────

export function prUrl(pr: PrRef): string {
  return `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;
}

export const STAGE_ICON: Record<Exclude<SessionStage, 'no-pr'>, {
  Icon: typeof GitPullRequestArrow;
  color: string;
  background: string;
  tooltip: string;
}> = {
  draft: {
    Icon: GitPullRequestDraft,
    color: 'var(--text-secondary)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    tooltip: 'Draft PR',
  },
  ready: {
    Icon: GitPullRequestArrow,
    color: 'var(--accent-green)',
    background: 'rgba(var(--accent-rgb), 0.22)',
    tooltip: 'PR ready for review',
  },
  merged: {
    Icon: GitMerge,
    color: '#a78bfa',
    background: 'rgba(var(--tint-rgb), 0.08)',
    tooltip: 'PR merged',
  },
  closed: {
    Icon: GitPullRequestClosed,
    color: 'var(--accent-red)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    tooltip: 'PR closed',
  },
};
