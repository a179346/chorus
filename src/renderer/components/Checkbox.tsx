import React from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 'danger' turns the checked box and its label red. */
  tone?: 'danger';
  children: React.ReactNode;
}

/** A native checkbox in a custom box, so Tab, Space and label clicks all work. */
export function Checkbox({ checked, onChange, tone, children }: CheckboxProps): React.ReactElement {
  return (
    <label className="checkbox" data-tone={tone}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox-box" aria-hidden="true">
        <Check size={11} strokeWidth={3} />
      </span>
      {children}
    </label>
  );
}
