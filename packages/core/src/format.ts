/** Форматирование чисел для русского интерфейса (десятичная запятая). */

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** «3.9270» → «3,93» */
export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

/** Значащие цифры — для очень мелких и очень крупных величин. */
export function fmtSig(value: number, sig = 3): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(value))));
  return fmt(value, Math.min(digits, 10));
}

/** «1,5 м/с» */
export function fmtU(value: number, unit: string, digits = 2): string {
  return `${fmt(value, digits)} ${unit}`;
}
