import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Единица подписывается у каждого значения — §5 ТЗ. */
  unit?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
  hint?: ReactNode;
  className?: string;
}

const TONE = {
  default: 'text-text',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
} as const;

export function Stat({ label, value, unit, tone = 'default', hint, className }: StatProps) {
  return (
    <div className={cx('rounded-lg border border-border bg-surface-2 px-4 py-3', className)}>
      <p className="text-[12px] text-dim uppercase tracking-wide">{label}</p>
      <p className={cx('iw-num text-[22px] font-semibold leading-tight mt-1', TONE[tone])}>
        {value}
        {unit && <span className="text-[13px] text-muted font-normal ml-1.5">{unit}</span>}
      </p>
      {hint && <p className="text-[12px] text-dim mt-1">{hint}</p>}
    </div>
  );
}
