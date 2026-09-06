import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cx } from '../lib/cx.js';

const CONTROL =
  'w-full h-10 px-3 bg-surface-2 border border-border rounded-lg text-text ' +
  'placeholder:text-dim focus:border-accent focus:outline-none transition-colors ' +
  'disabled:opacity-50';

export interface FieldProps {
  label: ReactNode;
  /** Единица измерения — по §5 ТЗ подписывается у каждого значения. */
  unit?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, unit, hint, error, children, className }: FieldProps) {
  return (
    <label className={cx('block', className)}>
      <span className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[13px] text-muted">{label}</span>
        {unit && <span className="text-[12px] text-dim shrink-0">{unit}</span>}
      </span>
      {children}
      {error ? (
        <span className="block text-[12px] text-danger mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-dim mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, className)} />;
}

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
}

/**
 * Числовой ввод, который не воюет с пользователем: хранит сырую строку,
 * принимает запятую как десятичный разделитель (русская раскладка),
 * и отдаёт null, пока поле пустое или недописано.
 */
export function NumberInput({
  value,
  onValueChange,
  className,
  ...rest
}: NumberInputProps) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={value === null || Number.isNaN(value) ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.').trim();
        if (raw === '') return onValueChange(null);
        const parsed = Number(raw);
        onValueChange(Number.isFinite(parsed) ? parsed : null);
      }}
      className={cx(CONTROL, 'iw-num', className)}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, 'cursor-pointer', className)}>
      {children}
    </select>
  );
}
