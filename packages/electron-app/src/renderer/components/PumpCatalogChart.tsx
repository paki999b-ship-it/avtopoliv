import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmt, systemHeadAt } from '@irrigo/core';
import type { SystemCurve } from '@irrigo/core';
import { MAX_PUMP_CURVES_ON_CHART, SYSTEM_CURVE_COLOR, pumpCurveColor } from '@irrigo/ui';
import type { PumpDto, PumpMatchDto } from '@shared/pumps.js';
import { pumpTitle } from '../lib/format.js';

/**
 * График каталожных кривых Q–H (§5.11, часть 2 задачи).
 *
 * ── Почему ломаная, а не сглаживание ───────────────────────────────────────
 * Точек у каталожной кривой шесть-шестнадцать, и они сняты с напечатанной
 * таблицы. Сплайн между ними «дорисовал» бы напор, которого производитель не
 * публиковал, и на графике это выглядело бы как достоверные данные. Поэтому
 * `type="linear"` — ровно то же, что делает расчёт при интерполяции.
 *
 * ── Цвета ──────────────────────────────────────────────────────────────────
 * Цвет назначается по месту в отсортированном списке подходящих насосов, а не
 * случайно: при повторном расчёте с теми же данными первый насос снова будет
 * синим. Характеристика системы — нейтральный серый пунктир: она не одна из
 * кривых насосов, а то, с чем их сравнивают.
 */

const INK_MUTED = 'rgb(var(--iw-text-muted))';
const INK_DIM = 'rgb(var(--iw-text-dim))';
const GRID = 'rgb(var(--iw-border))';
const SURFACE = 'rgb(var(--iw-surface-2))';

interface Series {
  key: string;
  label: string;
  color: string;
}

interface ChartRow {
  q: number;
  [seriesKey: string]: number | null;
}

export interface PumpCatalogChartProps {
  /** Подобранные насосы — первые восемь попадут на график. */
  matches?: PumpMatchDto[];
  /** Одиночная кривая — режим карточки модели в справочнике. */
  pump?: PumpDto;
  /** Характеристика системы; без неё рисуются только кривые насосов. */
  system?: SystemCurve | null;
  /** Требуемая рабочая точка — выделенный маркер. */
  required?: { qM3h: number; hM: number } | null;
  height?: number;
}

export function PumpCatalogChart({
  matches,
  pump,
  system,
  required,
  height = 340,
}: PumpCatalogChartProps) {
  const model = useMemo(() => {
    const pumps: Array<{ pump: PumpDto; operating: { qM3h: number; hM: number } | null }> = pump
      ? [{ pump, operating: null }]
      : (matches ?? [])
          .slice(0, MAX_PUMP_CURVES_ON_CHART)
          .map((m) => ({ pump: m.pump, operating: m.operatingPoint }));

    if (pumps.length === 0) return null;

    const series: Series[] = pumps.map((p, i) => ({
      key: `p${p.pump.id}`,
      label: pumpTitle(p.pump),
      color: pumpCurveColor(i),
    }));

    // Общая сетка по расходу: объединение всех узловых точек кривых. Так
    // каждая ломаная проходит ровно через свои табличные точки, а не через
    // значения, посчитанные в чужих узлах.
    const qs = new Set<number>();
    for (const p of pumps) for (const point of p.pump.curve) qs.add(point.qM3h);
    if (required) qs.add(required.qM3h);

    const grid = [...qs].sort((a, b) => a - b);

    // Потолок для характеристики системы: полтора требуемых напора.
    const cap = required ? required.hM * 1.6 : null;

    const rows: ChartRow[] = grid.map((q) => {
      const row: ChartRow = { q };
      for (let i = 0; i < pumps.length; i += 1) {
        const curve = pumps[i]!.pump.curve;
        const first = curve[0]!;
        const last = curve[curve.length - 1]!;
        // За пределами каталожной таблицы кривой нет — там пусто, а не
        // продолжение линии.
        row[series[i]!.key] =
          q < first.qM3h || q > last.qM3h ? null : interpolate(curve, q);
      }
      if (system) {
        /*
         * Характеристика системы растёт как Q^1,852 и на правом краю кривой
         * мощного насоса уходит на сотни метров, растягивая вертикальную ось
         * так, что все кривые слипаются у самого низа. Выше требуемого напора
         * с большим запасом эта ветвь не несёт смысла — туда всё равно не
         * дотягивается ни один подходящий насос, — поэтому она обрывается.
         */
        const value = systemHeadAt(system, q);
        row['system'] = cap !== null && value > cap ? null : Number(value.toFixed(2));
      }
      return row;
    });

    return { rows, series, pumps };
  }, [matches, pump, system, required]);

  if (!model) return null;

  const { rows, series, pumps } = model;

  return (
    <div>
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 12, right: 24, bottom: 34, left: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="q"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: INK_DIM, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => fmt(v, 1)}
              label={{
                value: 'Q, м³/ч',
                position: 'insideBottom',
                offset: -22,
                fill: INK_MUTED,
                fontSize: 12,
              }}
            />
            <YAxis
              tick={{ fill: INK_DIM, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => fmt(v, 0)}
              label={{
                value: 'H, м',
                angle: -90,
                position: 'insideLeft',
                fill: INK_MUTED,
                fontSize: 12,
              }}
            />

            <Tooltip
              cursor={{ stroke: INK_DIM, strokeDasharray: '3 3' }}
              contentStyle={{
                background: SURFACE,
                border: `1px solid ${GRID}`,
                borderRadius: 8,
                fontSize: 13,
              }}
              labelStyle={{ color: INK_MUTED }}
              labelFormatter={(v: number) => `Q = ${fmt(v, 2)} м³/ч`}
              formatter={(value: number, name: string) => [`${fmt(value, 1)} м`, name]}
            />

            {system && (
              <Line
                name="Характеристика системы"
                dataKey="system"
                stroke={SYSTEM_CURVE_COLOR}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                type="linear"
                isAnimationActive={false}
              />
            )}

            {series.map((s) => (
              <Line
                key={s.key}
                name={s.label}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                // Точки показываются: это узлы каталожной таблицы, а не сглаженная линия.
                dot={{ r: 2, fill: s.color, strokeWidth: 0 }}
                activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                type="linear"
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}

            {/* Фактические рабочие точки — пересечения с характеристикой системы. */}
            {pumps.map((p, i) =>
              p.operating ? (
                <ReferenceDot
                  key={`op-${p.pump.id}`}
                  x={p.operating.qM3h}
                  y={p.operating.hM}
                  r={5}
                  fill={pumpCurveColor(i)}
                  stroke={SURFACE}
                  strokeWidth={2}
                  isFront
                />
              ) : null,
            )}

            {required && (
              <ReferenceDot
                x={required.qM3h}
                y={required.hM}
                r={6}
                fill="none"
                stroke={INK_MUTED}
                strokeWidth={2}
                isFront
                label={{ value: 'требуется', position: 'top', fill: INK_MUTED, fontSize: 11 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
       * Легенда разметкой, а не встроенная в Recharts: девять названий
       * переносятся на две строки и налезали на подпись оси. Здесь же она
       * переносится нормально и совпадает по виду с легендой второго графика.
       */}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 text-[12px]">
        {system && (
          <li className="flex items-center gap-2">
            <span
              className="w-4 h-0 border-t-2 border-dashed"
              style={{ borderColor: SYSTEM_CURVE_COLOR }}
              aria-hidden
            />
            <span className="text-muted">Характеристика системы</span>
          </li>
        )}
        {series.map((s2) => (
          <li key={s2.key} className="flex items-center gap-2">
            <span
              className="w-4 h-0.5 rounded-full"
              style={{ background: s2.color }}
              aria-hidden
            />
            <span className="text-muted">{s2.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Линейная интерполяция по каталожным точкам — та же, что в движке. */
function interpolate(curve: Array<{ qM3h: number; hM: number }>, q: number): number | null {
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (q > b.qM3h) continue;
    if (b.qM3h === a.qM3h) return b.hM;
    const t = (q - a.qM3h) / (b.qM3h - a.qM3h);
    return Number((a.hM + t * (b.hM - a.hM)).toFixed(2));
  }
  return curve[curve.length - 1]?.hM ?? null;
}
