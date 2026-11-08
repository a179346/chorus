import {
  Bell,
  BellDot,
  BellOff,
  GitPullRequest,
  PanelBottom,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  X,
  Zap,
} from 'lucide-react';
import type { Session, ToolkitCommand } from '../shared/types';
import { hasExited, shortenPath, statusColor, statusLabel } from './session-presentation';
import { countNeedingAttention } from './use-sessions';
import type { PaletteItem } from './components/CommandPalette';
import { Keys } from './components/Kbd';
import { StatusDot } from './components/StatusDot';
import { ToolkitIcon } from './components/ToolkitIcon';

export interface PaletteActions {
  selectSession: (id: string) => void;
  newSession: () => void;
  nextNeedingAttention: () => void;
  renameSession: (id: string) => void;
  toggleNotify: (id: string) => void;
  managePrs: (id: string) => void;
  restartSession: (id: string) => void;
  findInTerminal: () => void;
  endSession: (id: string) => void;
  toggleShell: () => void;
  openPreferences: () => void;
  runToolkitCommand: (id: string) => void;
}

interface PaletteContext {
  sessions: Session[];
  activeSession: Session | null;
  toolkitCommands: ToolkitCommand[];
  shellCollapsed: boolean;
  actions: PaletteActions;
}

const ICON_SIZE = 14;

/** Everything ⌘K can reach, grouped: sessions, then actions, then toolkit commands. */
export function buildPaletteItems({
  sessions,
  activeSession,
  toolkitCommands,
  shellCollapsed,
  actions,
}: PaletteContext): PaletteItem[] {
  const sessionItems: PaletteItem[] = sessions.map((session, index) => ({
    id: `session:${session.id}`,
    group: 'Sessions',
    title: session.name,
    subtitle: session.worktree ? `${shortenPath(session.cwd)} · ${session.worktree}` : shortenPath(session.cwd),
    keywords: statusLabel(session.status),
    leading: <StatusDot status={session.status} />,
    trailing: (
      <>
        <span style={{ color: session.id === activeSession?.id ? 'var(--text-dimmed)' : statusColor(session.status) }}>
          {session.id === activeSession?.id ? 'Current' : statusLabel(session.status)}
        </span>
        {index < 9 && <Keys keys={['⌘', String(index + 1)]} />}
      </>
    ),
    run: () => actions.selectSession(session.id),
  }));

  const actionItems: PaletteItem[] = [
    {
      id: 'action:new-session',
      group: 'Actions',
      title: 'New Session…',
      keywords: 'create start open',
      leading: <Plus size={ICON_SIZE} />,
      trailing: <Keys keys={['⌘', 'T']} />,
      run: actions.newSession,
    },
    ...(countNeedingAttention(sessions, activeSession?.id ?? null) > 0
      ? [{
          id: 'action:next-attention',
          group: 'Actions',
          title: 'Next Session Needing Attention',
          keywords: 'unread waiting jump',
          leading: <BellDot size={ICON_SIZE} />,
          trailing: <Keys keys={['⌘', 'J']} />,
          run: actions.nextNeedingAttention,
        }]
      : []),
    ...(activeSession ? activeSessionItems(activeSession, actions) : []),
    {
      id: 'action:toggle-shell',
      group: 'Actions',
      title: shellCollapsed ? 'Show Shell Panel' : 'Hide Shell Panel',
      keywords: 'terminal toggle collapse expand',
      leading: <PanelBottom size={ICON_SIZE} />,
      run: actions.toggleShell,
    },
    {
      id: 'action:preferences',
      group: 'Actions',
      title: 'Preferences…',
      keywords: 'settings theme font size',
      leading: <Settings size={ICON_SIZE} />,
      trailing: <Keys keys={['⌘', ',']} />,
      run: actions.openPreferences,
    },
  ];

  // Toolkit commands type into a session, so they need one to target
  const toolkitItems: PaletteItem[] = activeSession
    ? toolkitCommands.map((command) => ({
        id: `toolkit:${command.id}`,
        group: 'Toolkit',
        title: command.label,
        subtitle: command.command,
        leading: command.icon ? <ToolkitIcon icon={command.icon} size={ICON_SIZE} /> : <Zap size={ICON_SIZE} />,
        run: () => actions.runToolkitCommand(command.id),
      }))
    : [];

  return [...sessionItems, ...actionItems, ...toolkitItems];
}

/** Actions on the current session; the subtitle names it so the target is never ambiguous. */
function activeSessionItems(session: Session, actions: PaletteActions): PaletteItem[] {
  const { id, name } = session;
  const items: PaletteItem[] = [
    {
      id: 'action:rename',
      group: 'Actions',
      title: 'Rename Session…',
      subtitle: name,
      leading: <Pencil size={ICON_SIZE} />,
      run: () => actions.renameSession(id),
    },
    {
      id: 'action:toggle-notify',
      group: 'Actions',
      title: session.notifyOnIdle ? 'Turn Off Notifications' : 'Turn On Notifications',
      subtitle: name,
      keywords: 'notify bell alert',
      leading: session.notifyOnIdle ? <BellOff size={ICON_SIZE} /> : <Bell size={ICON_SIZE} />,
      run: () => actions.toggleNotify(id),
    },
    {
      id: 'action:prs',
      group: 'Actions',
      title: 'Pull Requests…',
      subtitle: name,
      keywords: 'pr github link',
      leading: <GitPullRequest size={ICON_SIZE} />,
      run: () => actions.managePrs(id),
    },
    {
      id: 'action:find',
      group: 'Actions',
      title: 'Find in Terminal',
      subtitle: name,
      keywords: 'search',
      leading: <Search size={ICON_SIZE} />,
      trailing: <Keys keys={['⌘', 'F']} />,
      run: actions.findInTerminal,
    },
  ];
  if (hasExited(session)) {
    items.push({
      id: 'action:restart',
      group: 'Actions',
      title: 'Restart Claude Code',
      subtitle: name,
      keywords: 'relaunch resume',
      leading: <RotateCcw size={ICON_SIZE} />,
      run: () => actions.restartSession(id),
    });
  }
  items.push({
    id: 'action:end',
    group: 'Actions',
    title: 'End Session…',
    subtitle: name,
    keywords: 'close remove kill quit',
    leading: <X size={ICON_SIZE} />,
    trailing: <Keys keys={['⌘', 'W']} />,
    run: () => actions.endSession(id),
  });
  return items;
}
