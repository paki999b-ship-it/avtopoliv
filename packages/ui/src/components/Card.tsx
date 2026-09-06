import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}

export function Card({
  title,
  subtitle,
  actions,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      {...rest}
      className={cx(
        'bg-surface border border-border rounded-xl overflow-hidden',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-border bg-surface-2/50">
          <div className="min-w-0">
            {title && (
              <h3 className="text-[15px] font-semibold leading-tight truncate">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-[13px] text-dim mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-5')}>{children}</div>
    </section>
  );
}
