import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, NoteCard, NoteList, Stat, StepList, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type { CalcResult, CalculatorMeta } from '@irrigo/core';
import type { CalcHistoryEntry, Profile } from '@shared/types.js';
import type { CalcDefinition, FormValues, ResultTable } from '../calculators/types.js';
import { asRecord } from '../calculators/types.js';
import { IMPERIAL_NOTE, displayUnit, fromMetric, toMetric } from '../calculators/units-adapter.js';
import { buildCsvReport, buildTextReport } from '../calculators/report.js';
import { errorText, invoke } from '../lib/bridge.js';
import { formatDbTime, pluralize } from '../lib/format.js';
import { CalcForm } from './CalcForm.js';
import { PumpSection } from './PumpSection.js';

/** Разворачивание ключа вставки в компонент — см. `extraKey` в описании. */
const EXTRAS = { 'pump-curve': PumpSection } as const;

/**
 * Исполнитель калькулятора: форма слева, результат справа.
 *
 * Пересчёт идёт на каждое изменение — расчёты в движке дешёвые, а кнопка
 * «Посчитать» в инженерном калькуляторе только мешает подбирать значения.
 * Ошибка ввода не стирает результат молча, а показывается карточкой.
 */

interface CalcRunnerProps {
  meta: CalculatorMeta;
  definition: CalcDefinition;
  profile: Profile;
  /** Открыть связанный урок Академии (§3.2). */
  onOpenLesson: (lessonKey: string) => void;
  onSaved: () => void;
}

/** Значения по умолчанию заданы в метрике — переводим под систему профиля. */
function defaultsForSystem(definition: CalcDefinition, profile: Profile): FormValues {
  if (profile.unitSystem === 'metric') return structuredClone(definition.defaults);

  const converted: FormValues = structuredClone(definition.defaults);

  for (const field of definition.fields) {
    if (field.kind === 'number' && field.quantity) {
      const raw = converted[field.name];
      if (typeof raw === 'number') {
        converted[field.name] = round6(fromMetric(field.quantity, raw, profile.unitSystem));
      }
    }
    if (field.kind === 'list') {
      const rows = converted[field.name];
      if (!Array.isArray(rows)) continue;
      converted[field.name] = rows.map((row) => {
        const next: FormValues = { ...row };
        for (const sub of field.fields) {
          if (sub.kind === 'number' && sub.quantity && typeof next[sub.name] === 'number') {
            next[sub.name] = round6(
              fromMetric(sub.quantity, next[sub.name] as number, profile.unitSystem),
            );
          }
        }
        return next;
      });
    }
  }

  return converted;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Значения формы → метрика, которую понимает движок. */
function valuesToMetric(definition: CalcDefinition, values: FormValues, profile: Profile): FormValues {
  if (profile.unitSystem === 'metric') return values;

  const metric: FormValues = { ...values };

  for (const field of definition.fields) {
    if (field.kind === 'number' && field.quantity && typeof metric[field.name] === 'number') {
      metric[field.name] = toMetric(field.quantity, metric[field.name] as number, profile.unitSystem);
    }
    if (field.kind === 'list' && Array.isArray(metric[field.name])) {
      metric[field.name] = (metric[field.name] as FormValues[]).map((row) => {
        const next: FormValues = { ...row };
        for (const sub of field.fields) {
          if (sub.kind === 'number' && sub.quantity && typeof next[sub.name] === 'number') {
            next[sub.name] = toMetric(sub.quantity, next[sub.name] as number, profile.unitSystem);
          }
        }
        return next;
      });
    }
  }

  return metric;
}

interface DisplayOutput {
  label: string;
  value: string;
  unit: string;
  hint?: string;
  tone: 'default' | 'ok' | 'warn' | 'danger';
}

export function CalcRunner({
  meta,
  definition,
  profile,
  onOpenLesson,
  onSaved,
}: CalcRunnerProps) {
  const [values, setValues] = useState<FormValues>(() => defaultsForSystem(definition, profile));
  const [showExplain, setShowExplain] = useState(false);
  const [history, setHistory] = useState<CalcHistoryEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  // Смена калькулятора или системы единиц — форма собирается заново.
  useEffect(() => {
    setValues(defaultsForSystem(definition, profile));
    setShowExplain(false);
    setStatus(null);
  }, [definition, profile.unitSystem]);

  useEffect(() => {
    let cancelled = false;
    void invoke('calc:list', profile.id, definition.key)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id, definition.key]);

  const computed = useMemo(() => {
    try {
      const metric = valuesToMetric(definition, values, profile);
      return { result: definition.run({ values: metric }), error: null as string | null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [definition, values, profile.unitSystem]);

  const result: CalcResult<object> | null = computed.result;

  const outputs: DisplayOutput[] = useMemo(() => {
    if (!result) return [];
    const raw = asRecord(result.values);

    return definition.outputs.flatMap((spec) => {
      const value = raw[spec.name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        if (spec.hideIfNull || value === null || value === undefined) return [];
        return [
          {
            label: spec.label,
            value: String(value),
            unit: spec.unit ?? '',
            hint: spec.hint,
            tone: 'default' as const,
          },
        ];
      }

      const { unit, digits } = displayUnit(
        spec.quantity,
        spec.unit ?? '',
        profile.unitSystem,
        spec.digits,
      );
      const shown = fromMetric(spec.quantity, value, profile.unitSystem);

      return [
        {
          label: spec.label,
          value: fmt(shown, digits ?? spec.digits ?? 2),
          unit,
          hint: spec.hint,
          tone: spec.tone ? spec.tone(raw) : ('default' as const),
        },
      ];
    });
  }, [result, definition, profile.unitSystem]);

  const tables: ResultTable[] = useMemo(() => {
    if (!result || !definition.tables) return [];
    try {
      return definition.tables(result, values);
    } catch {
      return [];
    }
  }, [result, definition, values]);

  const fieldUnits = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of definition.fields) {
      if (field.kind === 'number') {
        map[field.name] = displayUnit(field.quantity, field.unit, profile.unitSystem).unit;
      }
      if (field.kind === 'list') {
        for (const sub of field.fields) {
          if (sub.kind === 'number') {
            map[`${field.name}.${sub.name}`] = displayUnit(
              sub.quantity,
              sub.unit,
              profile.unitSystem,
            ).unit;
          }
        }
      }
    }
    return map;
  }, [definition, profile.unitSystem]);

  const reportInput = result
    ? {
        meta,
        fields: definition.fields,
        values,
        fieldUnits,
        result,
        outputs: outputs.map((o) => ({ label: o.label, value: o.value, unit: o.unit })),
        tables,
        profileName: profile.name,
      }
    : null;

  async function saveToHistory() {
    if (!result) return;
    try {
      const entry = await invoke('calc:save', profile.id, {
        calculatorKey: definition.key,
        title: definition.historyTitle(values, result),
        inputs: values as Record<string, unknown>,
        outputs: asRecord(result.values),
      });
      setHistory([entry, ...history]);
      setStatus('Расчёт сохранён в историю профиля.');
      onSaved();
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function copyText() {
    if (!reportInput) return;
    try {
      await invoke('clipboard:write', buildTextReport(reportInput));
      setStatus('Расчёт скопирован в буфер обмена.');
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function exportCsv() {
    if (!reportInput) return;
    try {
      const outcome = await invoke(
        'calc:exportCsv',
        `${definition.key}-${new Date().toISOString().slice(0, 10)}.csv`,
        buildCsvReport(reportInput),
      );
      setStatus(outcome.saved ? `Сохранено: ${outcome.path}` : 'Сохранение отменено.');
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function removeEntry(id: number) {
    try {
      await invoke('calc:delete', profile.id, id);
      setHistory(history.filter((h) => h.id !== id));
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  const Extra = definition.extraKey ? EXTRAS[definition.extraKey] : null;

  return (
    <div className="grid xl:grid-cols-[minmax(380px,460px)_1fr] gap-5 items-start">
      {/* ── Ввод ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5">
        <Card title="Исходные данные" subtitle={`§${meta.spec}`}>
          {profile.unitSystem === 'imperial' && (
            <p className="text-[12px] text-dim mb-4 pb-4 border-b border-border">{IMPERIAL_NOTE}</p>
          )}
          <CalcForm
            fields={definition.fields}
            values={values}
            unitSystem={profile.unitSystem}
            onChange={setValues}
          />
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={!result} onClick={() => void saveToHistory()}>
            Сохранить в историю
          </Button>
          <Button variant="secondary" size="sm" disabled={!result} onClick={() => void copyText()}>
            Копировать
          </Button>
          <Button variant="secondary" size="sm" disabled={!result} onClick={() => void exportCsv()}>
            Экспорт в CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setValues(defaultsForSystem(definition, profile))}
          >
            Сбросить
          </Button>
        </div>

        {status && <p className="text-[13px] text-muted">{status}</p>}

        {history.length > 0 && (
          <Card
            title="История расчётов"
            subtitle={`${pluralize(history.length, 'запись', 'записи', 'записей')} в профиле`}
            actions={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void invoke('calc:clear', profile.id, definition.key).then(() => setHistory([]));
                }}
              >
                Очистить
              </Button>
            }
          >
            <ul className="flex flex-col gap-1">
              {history.slice(0, 10).map((entry) => (
                <li key={entry.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setValues(entry.inputs as FormValues)}
                    className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-surface-2 transition-colors"
                    title="Открыть расчёт с этими данными"
                  >
                    <span className="block text-[13px] truncate">{entry.title}</span>
                    <span className="block text-[11px] text-dim iw-num">
                      {formatDbTime(entry.createdAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEntry(entry.id)}
                    className="text-[12px] text-dim hover:text-danger px-2"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* ── Результат ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5">
        {computed.error && (
          <NoteCard
            note={{
              severity: 'warning',
              message: 'Расчёт не выполнен',
              why: computed.error,
              fix: 'Проверьте заполнение полей: движок не принимает нулевые и отрицательные значения там, где физического смысла у них нет.',
            }}
          />
        )}

        {result && outputs.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {outputs.map((output) => (
              <Stat
                key={output.label}
                label={output.label}
                value={output.value}
                unit={output.unit}
                tone={output.tone}
                hint={output.hint}
              />
            ))}
          </div>
        )}

        {result && result.notes.length > 0 && (
          <NoteList
            notes={result.notes.map((note) => ({
              severity: note.severity,
              message: note.message,
              why: note.why,
              fix: note.fix,
            }))}
          />
        )}

        {result && Extra && <Extra values={values} result={result} />}

        {tables.map((table) => (
          <Card key={table.title} title={table.title} subtitle={table.note} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-left text-dim border-b border-border">
                    {table.columns.map((column) => (
                      <th key={column} className="py-2.5 px-5 font-medium whitespace-nowrap">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr
                      key={index}
                      className={cx(
                        'border-b border-border/50 last:border-0',
                        index === table.highlightRow && 'bg-accent/10',
                      )}
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cx('py-2.5 px-5 align-top', cellIndex > 0 && 'iw-num')}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

        {/* §3.2: показывать формулу, подстановку и результат, а не только ответ. */}
        {result && result.steps.length > 0 && (
          <Card
            title="Как это посчитано"
            subtitle="Формула → подстановка → результат"
            actions={
              profile.unitSystem === 'imperial' ? <Badge>метрические единицы</Badge> : undefined
            }
          >
            <StepList steps={result.steps} />
          </Card>
        )}

        <Card
          title="Пояснение"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setShowExplain(!showExplain)}>
              {showExplain ? 'Свернуть' : 'Пояснить'}
            </Button>
          }
        >
          {showExplain ? (
            <div className="flex flex-col gap-3">
              {definition.explain.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="text-[14px] text-muted">
                  {paragraph}
                </p>
              ))}
              <div className="pt-2">
                <Button size="sm" variant="secondary" onClick={() => onOpenLesson(meta.lessonKey)}>
                  Открыть урок Академии →
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-dim">
              Что означает результат и что делать, если он плохой.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
