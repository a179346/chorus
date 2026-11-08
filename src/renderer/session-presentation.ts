import {
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestArrow,
  GitMerge,
  GitPullRequestClosed,
  TriangleAlert,
} from 'lucide-react';
import { isExitedStatus, type LinkedPr, type PrStage, type Session, type SessionStatus } from '../shared/types';
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
  return isExitedStatus(session.status);
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
  'not-found': {
    Icon: TriangleAlert,
    color: 'var(--accent-yellow)',
    background: 'rgba(var(--tint-rgb), 0.08)',
    label: 'Not found',
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

// The lowest number leads. Open PRs lead: they still need something from you,
// and so does a PR gh can't find (fix access or remove it). 'unknown' only
// shows when no PR has resolved yet.
const STAGE_PRIORITY: Record<PrStage, number> = {
  ready: 0,
  draft: 1,
  'not-found': 2,
  merged: 3,
  closed: 4,
  unknown: 5,
};

/** The single stage that stands for a session's PRs where there is room for one icon. */
export function summaryStage(prs: readonly LinkedPr[]): PrStage | null {
  let summary: PrStage | null = null;
  for (const { stage } of prs) {
    if (summary === null || STAGE_PRIORITY[stage] < STAGE_PRIORITY[summary]) summary = stage;
  }
  return summary;
}
