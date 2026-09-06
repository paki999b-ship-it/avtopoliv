import { cx } from '../lib/cx.js';

/** Шаг вычисления; поля повторяют `CalcStep` из @irrigo/core. */
export interface StepLike {
  label: string;
  formula: string;
  substitution: string;
  result: string;
}

/**
 * Формула → подстановка → результат. §3.2 ТЗ требует показывать все три,
 * поэтому вывод устроен так, что пропустить подстановку нельзя.
 */
export function StepList({ steps, className }: { steps: StepLike[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={cx('flex flex-col gap-3', className)}>
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="text-[13px] text-muted mb-2">{step.label}</p>
          <p className="iw-num text-[13px] text-dim">{step.formula}</p>
          <p className="iw-num text-[13px] text-text/90 mt-1">{step.substitution}</p>
          <p className="iw-num text-[15px] text-accent-ink font-semibold mt-1.5">
            = {step.result}
          </p>
        </li>
      ))}
    </ol>
  );
}
