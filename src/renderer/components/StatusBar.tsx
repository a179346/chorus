import React from 'react';
import { GitBranch } from 'lucide-react';
import type { Session } from '../../shared/types';

interface StatusBarProps {
  session: Session | null;
}

const statusColors: Record<string, string> = {
  idle: 'var(--status-idle)',
  waiting: 'var(--status-idle)',
  thinking: 'var(--status-thinking)',
  generating: 'var(--status-generating)',
  creating: 'var(--status-creating)',
  error: 'var(--status-error)',
  ended: 'var(--status-ended)',
};

const pulsingStatuses = new Set(['thinking', 'generating', 'waiting']);

function StatusDot({ status }: { status: string }): React.ReactElement {
  const color = statusColors[status] ?? 'var(--text-dimmed)';
  const isPulsing = pulsingStatuses.has(status);

  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        backgroundColor: color,
        marginRight: 7,
        animation: isPulsing ? 'statusPulse 1.5s ease-in-out infinite' : undefined,
        boxShadow: isPulsing ? `0 0 6px ${color}` : undefined,
        transition: 'background-color var(--transition-fast)',
      }}
    />
  );
}

function shortenPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

function shortenModel(model: string): string {
  // "claude-opus-4-6" → "opus-4-6"
  return model.replace(/^claude-/, '');
}

export function StatusBar({ session }: StatusBarProps): React.ReactElement {
  if (!session) {
    return (
      <div style={barStyle}>
        <span style={{ color: 'var(--text-dimmed)' }}>No active session</span>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      {/* Left — Status */}
      <div style={sectionStyle}>
        <StatusDot status={session.status} />
        <span style={{ color: statusColors[session.status] ?? 'var(--text-dimmed)', textTransform: 'capitalize', fontWeight: 500 }}>
          {session.status}
        </span>
      </div>

      <span style={separatorDotStyle}>·</span>

      {/* Center — Name + CWD + tags */}
      <div style={centerStyle}>
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {session.name}
        </span>
        <span style={{ color: 'var(--text-dimmed)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shortenPath(session.cwd)}
        </span>
        {session.gitBranch && (
          <span style={tagStyle}>
            <span style={{ color: 'var(--accent-orange)', marginRight: 3 }}></span>
            {session.gitBranch}
          </span>
        )}
        {session.worktree && (
          <span style={tagStyle}>
            <GitBranch size={11} style={{ color: 'var(--accent-blue)', marginRight: 3 }} />
            {session.worktree}
          </span>
        )}
      </div>

      {/* Right — Model + Context */}
      <div style={sectionStyle}>
        {session.model && (
          <span style={{ color: 'var(--text-dimmed)', whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.02em' }}>
            {shortenModel(session.model)}
          </span>
        )}

        {session.contextUsage != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={contextBarTrackStyle}>
              <div
                style={{
                  ...contextBarFillStyle,
                  width: `${Math.min(100, session.contextUsage)}%`,
                  backgroundColor:
                    session.contextUsage > 80
                      ? 'var(--accent-red)'
                      : session.contextUsage > 50
                        ? 'var(--accent-yellow)'
                        : 'var(--accent-primary)',
                }}
              />
            </div>
            <span style={{ color: 'var(--text-dimmed)', fontSize: 10, minWidth: 28, textAlign: 'right' }}>
              {session.contextUsage}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  height: 'var(--status-bar-height)',
  background: 'var(--bg-status-bar)',
  borderBottom: '1px solid rgba(var(--tint-rgb), 0.08)',
  boxShadow: '0 1px 8px rgba(var(--shade-rgb), 0.2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px 0 78px',
  gap: 16,
  fontFamily: 'var(--font-ui)',
  fontSize: 11,
  flexShrink: 0,
  zIndex: 1,
  position: 'relative',
  // @ts-expect-error Electron-specific
  WebkitAppRegion: 'drag',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const centerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'rgba(var(--tint-rgb), 0.07)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 7px',
  fontSize: 11,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  // @ts-expect-error Electron-specific
  WebkitAppRegion: 'no-drag',
};

const separatorDotStyle: React.CSSProperties = {
  color: 'var(--text-dimmed)',
  opacity: 0.5,
  fontSize: 11,
  flexShrink: 0,
};

const contextBarTrackStyle: React.CSSProperties = {
  width: 52,
  height: 4,
  background: 'rgba(var(--tint-rgb), 0.10)',
  borderRadius: 2,
  overflow: 'hidden',
};

const contextBarFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 2,
  transition: 'width var(--transition-normal), background-color var(--transition-normal)',
};
