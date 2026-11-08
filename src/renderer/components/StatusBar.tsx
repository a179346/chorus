import React from 'react';
import { GitBranch } from 'lucide-react';
import type { Session } from '../../shared/types';
import { prLabel } from '../../shared/pr-ref';
import { STAGE_ICON, prTooltip, statusColor, statusLabel, shortenPath, shortenModel } from '../session-presentation';
import { openPrInBrowser } from './PrLinks';
import { StatusDot } from './StatusDot';

interface StatusBarProps {
  session: Session | null;
}

export function StatusBar({ session }: StatusBarProps): React.ReactElement {
  // Still the window's drag handle when there's nothing to show
  if (!session) return <div style={barStyle} />;

  return (
    <div style={barStyle}>
      {/* Left — Status */}
      <div style={sectionStyle}>
        <StatusDot status={session.status} />
        <span style={{ color: statusColor(session.status), fontWeight: 500 }}>
          {statusLabel(session.status)}
        </span>
      </div>

      {/* Center — Name + CWD + tags */}
      <div style={centerStyle}>
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
          {session.name}
        </span>
        <span style={{ color: 'var(--text-dimmed)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shortenPath(session.cwd)}
        </span>
        {session.worktree && (
          <span style={tagStyle}>
            <GitBranch size={11} style={{ color: 'var(--accent-blue)', marginRight: 3 }} />
            {session.worktree}
          </span>
        )}
        {session.prs.map((pr) => {
          const { Icon, color, background } = STAGE_ICON[pr.stage];
          return (
            <button
              type="button"
              key={prLabel(pr)}
              className="pr-chip"
              title={`${prTooltip(pr)} — open on GitHub`}
              onClick={() => openPrInBrowser(pr)}
              style={{ padding: '2px 6px', background, color }}
            >
              <Icon size={12} />
              #{pr.number}
            </button>
          );
        })}
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
  borderBottom: '1px solid var(--border-subtle)',
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
