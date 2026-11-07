import React from 'react';
import type { SessionStatus } from '../../shared/types';
import { PULSING_STATUSES, statusColor, statusLabel } from '../session-presentation';

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
}

/** A session's status as a coloured dot that breathes while Claude is busy or waiting. */
export function StatusDot({ status, size = 7 }: StatusDotProps): React.ReactElement {
  const color = statusColor(status);
  const pulsing = PULSING_STATUSES.has(status);
  return (
    <span
      className="status-dot"
      role="img"
      aria-label={statusLabel(status)}
      data-pulsing={pulsing}
      style={{ width: size, height: size, background: color, boxShadow: pulsing ? `0 0 6px ${color}` : undefined }}
    />
  );
}
