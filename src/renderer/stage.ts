import {
  GitPullRequestDraft,
  GitPullRequestArrow,
  GitMerge,
  GitPullRequestClosed,
} from 'lucide-react';
import type { SessionStage } from '../shared/types';

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
