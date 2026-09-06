/** Внутренние помощники для сборки CalcResult. Не часть публичного API. */

import type { CalcNote, CalcStep, Severity } from '../types.js';

export class StepLog {
  readonly steps: CalcStep[] = [];
  readonly notes: CalcNote[] = [];

  step(label: string, formula: string, substitution: string, result: string): this {
    this.steps.push({ label, formula, substitution, result });
    return this;
  }

  note(severity: Severity, code: string, message: string, why?: string, fix?: string): this {
    const n: CalcNote = { severity, code, message };
    if (why) n.why = why;
    if (fix) n.fix = fix;
    this.notes.push(n);
    return this;
  }

  info = (code: string, message: string, why?: string, fix?: string) =>
    this.note('info', code, message, why, fix);
  warn = (code: string, message: string, why?: string, fix?: string) =>
    this.note('warning', code, message, why, fix);
  error = (code: string, message: string, why?: string, fix?: string) =>
    this.note('error', code, message, why, fix);
}

/** Проверка входного числа: конечное и в допустимом диапазоне. */
export function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name}: ожидается число, получено «${value}»`);
  if (value <= 0) throw new Error(`${name}: должно быть больше нуля, получено ${value}`);
  return value;
}

export function requireNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name}: ожидается число, получено «${value}»`);
  if (value < 0) throw new Error(`${name}: не может быть отрицательным, получено ${value}`);
  return value;
}

export function requireRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name}: ожидается число, получено «${value}»`);
  if (value < min || value > max) {
    throw new Error(`${name}: должно быть в диапазоне ${min}…${max}, получено ${value}`);
  }
  return value;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
