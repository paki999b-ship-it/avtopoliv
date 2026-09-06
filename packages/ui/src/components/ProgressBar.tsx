import { cx } from '../lib/cx.js';

export interface ProgressBarProps {
  /** 0…1 */
  value: number;
  label?: string;
  hint?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function ProgressBar({ value, label, hint, size = 'md', className }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cx('w-full', className)}>
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          {label && <span className="text-[13px] text-muted truncate">{label}</span>}
          {hint && <span className="text-[12px] text-dim iw-num shrink-0">{hint}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cx(
          'w-full bg-surface-3 rounded-full overflow-hidden',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        <div
          className="h-full bg-gradient-to-r from-accent-dim to-accent-strong transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
