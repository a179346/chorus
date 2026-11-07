import {
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestArrow,
  GitMerge,
  GitPullRequestClosed,
} from 'lucide-react';
import type { LinkedPr, PrStage, Session, SessionStatus } from '../shared/types';
import { prLabel } from '../shared/pr-ref';

// How a session presents itself anywhere in the UI: status colours, stage
// icons, and the shortening helpers. One lookup, N components.

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'var(--status-idle)',
  waiting: 'var(--status-waiting)',
  thinking: 'var(--status-thinking)',
  generating: 'var(--status-generating)',
  creating: 'var(--status-creating)',
  error: 'var(--status-error)',
  ended: 'var(--status-ended)',
};

export function statusColor(status: SessionStatus | string): string {
  return STATUS_COLORS[status as SessionStatus] ?? 'var(--text-dimmed)';
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  waiting: 'Needs input',
  thinking: 'Thinking',
  generating: 'Generating',
  creating: 'Creating',
  error: 'Error',
  ended: 'Ended',
};

export function statusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status];
}

/** Claude's process is gone; the session can be relaunched in place. */
export function hasExited(session: Session): boolean {
  return session.status === 'ended' || session.status === 'error';
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

export const STAGE_ICON: Record<PrStage, {
  Icon: typeof GitPullRequestArrow;
  color: string;
  background: string;
  label: string;
}> = {
  unknown: {
    Icon: GitPullRequest,
    color: 'var(--text-dimmed)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    label: 'Status unknown',
  },
  draft: {
    Icon: GitPullRequestDraft,
    color: 'var(--text-secondary)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    label: 'Draft',
  },
  ready: {
    Icon: GitPullRequestArrow,
    color: 'var(--accent-green)',
    background: 'rgba(var(--accent-rgb), 0.22)',
    label: 'Ready for review',
  },
  merged: {
    Icon: GitMerge,
    color: '#a78bfa',
    background: 'rgba(var(--tint-rgb), 0.08)',
    label: 'Merged',
  },
  closed: {
    Icon: GitPullRequestClosed,
    color: 'var(--accent-red)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    label: 'Closed',
  },
};

/** "owner/repo#12 · Ready for review" */
export function prTooltip(pr: LinkedPr): string {
  return `${prLabel(pr)} · ${STAGE_ICON[pr.stage].label}`;
}

// Open PRs lead: they still need something from you. 'unknown' only shows
// when no PR has resolved yet.
const STAGE_PRIORITY: readonly PrStage[] = ['ready', 'draft', 'merged', 'closed', 'unknown'];

/** The single stage that stands for a session's PRs where there is room for one icon. */
export function summaryStage(prs: readonly LinkedPr[]): PrStage | null {
  for (const stage of STAGE_PRIORITY) {
    if (prs.some((pr) => pr.stage === stage)) return stage;
  }
  return null;
}
