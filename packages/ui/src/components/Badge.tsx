import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-muted border-border-strong',
  accent: 'bg-accent/15 text-accent-ink border-accent/35',
  ok: 'bg-ok-dim text-ok border-ok/35',
  warn: 'bg-warn-dim text-warn border-warn/35',
  danger: 'bg-danger-dim text-danger border-danger/35',
  info: 'bg-info-dim text-info border-info/35',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[12px] font-medium leading-5',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
