import React from 'react';

/** Keycaps for a shortcut: <Keys keys={['⌘', 'T']} />. */
export function Keys({ keys }: { keys: readonly string[] }): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {keys.map((key) => (
        <kbd key={key} className="kbd">{key}</kbd>
      ))}
    </span>
  );
}
