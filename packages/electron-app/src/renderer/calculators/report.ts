import { fmt } from '@irrigo/core';
import type { CalcResult, CalculatorMeta } from '@irrigo/core';
import type { CalcFieldSpec, FormValues, ResultTable } from './types.js';

/**
 * Выгрузка расчёта (§3.2 ТЗ): текст в буфер обмена и CSV в файл.
 *
 * В обеих выгрузках есть и вход, и вывод формулы, и замечания. Расчёт без
 * исходных данных нельзя ни проверить, ни повторить — а именно для проверки
 * его обычно и копируют.
 */

const DISCLAIMER =
  'АртЛандшафт — учебная программа. Расчёт не является проектной документацией; ' +
  'значения по конкретному оборудованию сверяйте с техкартой производителя.';

interface ReportInput {
  meta: CalculatorMeta;
  fields: CalcFieldSpec[];
  /** Значения формы в тех единицах, в которых их видел пользователь. */
  values: FormValues;
  /** Подписи единиц полей — уже с учётом системы единиц профиля. */
  fieldUnits: Record<string, string>;
  result: CalcResult<object>;
  outputs: Array<{ label: string; value: string; unit: string }>;
  tables: ResultTable[];
  profileName: string;
}

function formatRaw(raw: unknown): string {
  if (typeof raw === 'number') return fmt(raw, Number.isInteger(raw) ? 0 : 3);
  if (typeof raw === 'boolean') return raw ? 'да' : 'нет';
  return String(raw ?? '');
}

interface FieldRow {
  label: string;
  value: string;
  unit: string;
  /** Строка списка выводится с отступом и без собственной единицы. */
  nested?: boolean;
}

/**
 * Разбор значений формы в строки «показатель — значение — единица».
 *
 * Общий для текста и CSV: иначе в одной выгрузке единица попадала бы в
 * значение, а в другой — в отдельную колонку.
 */
function fieldRows(
  fields: CalcFieldSpec[],
  values: FormValues,
  units: Record<string, string>,
): FieldRow[] {
  const rows: FieldRow[] = [];

  for (const field of fields) {
    // Заголовок группы — оформление формы, а не данные расчёта.
    if (field.kind === 'section') continue;

    if (field.kind === 'list') {
      const items = Array.isArray(values[field.name]) ? (values[field.name] as FormValues[]) : [];
      rows.push({ label: field.label, value: String(items.length), unit: 'строк' });

      items.forEach((item, index) => {
        const parts = field.fields.map((sub) => {
          const unit = sub.kind === 'number' ? (units[`${field.name}.${sub.name}`] ?? sub.unit) : '';
          return `${sub.label} ${formatRaw(item[sub.name])}${unit ? ` ${unit}` : ''}`;
        });
        rows.push({
          label: `  ${index + 1})`,
          value: parts.join('; '),
          unit: '',
          nested: true,
        });
      });
      continue;
    }

    if (field.kind === 'toggle') {
      rows.push({ label: field.label, value: values[field.name] === true ? 'да' : 'нет', unit: '' });
      continue;
    }

    const raw = values[field.name];
    if (raw === null || raw === undefined || raw === '') continue;

    if (field.kind === 'select') {
      const options = field.optionsFor ? field.optionsFor(values) : field.options;
      const option = options.find((o) => o.value === String(raw));
      rows.push({ label: field.label, value: option?.label ?? String(raw), unit: '' });
      continue;
    }

    rows.push({
      label: field.label,
      value: formatRaw(raw),
      unit: field.kind === 'number' ? (units[field.name] ?? field.unit) : '',
    });
  }

  return rows;
}

function fieldLine(row: FieldRow): string {
  if (row.nested) return `${row.label} ${row.value}`;
  return `${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`;
}

/** Читаемый текстовый отчёт — то, что уходит в буфер обмена. */
export function buildTextReport(input: ReportInput): string {
  const { meta, result } = input;
  const lines: string[] = [];

  lines.push(`${meta.title} (§${meta.spec})`);
  lines.push(`Профиль: ${input.profileName}`);
  lines.push(new Date().toLocaleString('ru-RU'));
  lines.push('');

  lines.push('ИСХОДНЫЕ ДАННЫЕ');
  lines.push(...fieldRows(input.fields, input.values, input.fieldUnits).map(fieldLine));
  lines.push('');

  if (input.outputs.length > 0) {
    lines.push('РЕЗУЛЬТАТ');
    for (const out of input.outputs) {
      lines.push(`${out.label}: ${out.value}${out.unit ? ` ${out.unit}` : ''}`);
    }
    lines.push('');
  }

  if (result.steps.length > 0) {
    lines.push('РАСЧЁТ (метрические единицы)');
    for (const step of result.steps) {
      lines.push(`${step.label}`);
      lines.push(`  ${step.formula}`);
      lines.push(`  ${step.substitution} = ${step.result}`);
    }
    lines.push('');
  }

  for (const table of input.tables) {
    lines.push(table.title.toUpperCase());
    lines.push(table.columns.join(' | '));
    for (const row of table.rows) lines.push(row.join(' | '));
    lines.push('');
  }

  if (result.notes.length > 0) {
    lines.push('ЗАМЕЧАНИЯ');
    for (const note of result.notes) {
      const mark = note.severity === 'error' ? '[!]' : note.severity === 'warning' ? '[~]' : '[i]';
      lines.push(`${mark} ${note.message}`);
      if (note.why) lines.push(`    почему: ${note.why}`);
      if (note.fix) lines.push(`    как исправить: ${note.fix}`);
    }
    lines.push('');
  }

  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/** Экранирование по RFC 4180 — точка с запятой как разделитель для Excel. */
function csvCell(value: string): string {
  const needsQuotes = /[";\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(';');
}

export function buildCsvReport(input: ReportInput): string {
  const { meta, result } = input;
  const rows: string[] = [];

  rows.push(csvRow(['Калькулятор', `${meta.title} (§${meta.spec})`]));
  rows.push(csvRow(['Профиль', input.profileName]));
  rows.push(csvRow(['Дата', new Date().toLocaleString('ru-RU')]));
  rows.push('');

  rows.push(csvRow(['Раздел', 'Показатель', 'Значение', 'Единица']));

  for (const row of fieldRows(input.fields, input.values, input.fieldUnits)) {
    rows.push(csvRow(['Исходные данные', row.label.trim(), row.value, row.unit]));
  }

  for (const out of input.outputs) {
    rows.push(csvRow(['Результат', out.label, out.value, out.unit]));
  }

  for (const step of result.steps) {
    rows.push(csvRow(['Расчёт', step.label, `${step.formula}  →  ${step.substitution}`, step.result]));
  }

  for (const table of input.tables) {
    rows.push('');
    rows.push(csvRow([table.title, ...table.columns]));
    for (const row of table.rows) rows.push(csvRow(['', ...row]));
  }

  if (result.notes.length > 0) {
    rows.push('');
    rows.push(csvRow(['Замечания', 'Что не так', 'Почему', 'Как исправить']));
    for (const note of result.notes) {
      rows.push(csvRow([note.severity, note.message, note.why ?? '', note.fix ?? '']));
    }
  }

  rows.push('');
  rows.push(csvRow(['', DISCLAIMER]));

  return rows.join('\r\n');
}

export type { ReportInput };
