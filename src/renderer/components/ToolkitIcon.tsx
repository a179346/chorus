import React from 'react';
import {
  GitPullRequest,
  GitCommitHorizontal,
  Terminal,
  Code,
  Server,
  Package,
  Rocket,
  Bug,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// The icons a toolkit command can carry, stored by name in ToolkitCommand.icon.

const ICON_MAP: Record<string, LucideIcon> = {
  'git-pull-request': GitPullRequest,
  'git-commit': GitCommitHorizontal,
  'terminal': Terminal,
  'code': Code,
  'server': Server,
  'package': Package,
  'rocket': Rocket,
  'bug': Bug,
  'wrench': Wrench,
  'zap': Zap,
};

export const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'git-pull-request', label: 'PR' },
  { value: 'git-commit', label: 'Commit' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'code', label: 'Code' },
  { value: 'server', label: 'Server' },
  { value: 'package', label: 'Package' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'bug', label: 'Bug' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'zap', label: 'Zap' },
];

/** A toolkit command's chosen icon, or nothing for an unset or unknown name. */
export function ToolkitIcon({ icon, size = 12 }: { icon: string; size?: number }): React.ReactElement | null {
  const Comp = ICON_MAP[icon];
  if (!Comp) return null;
  return <Comp size={size} />;
}
