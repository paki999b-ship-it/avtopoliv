import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  barToMwc,
  buildSystemCurve,
  findOperatingPoint,
  fitPumpCurve,
  fmt,
  pumpHeadAt,
  systemHeadAt,
} from '@irrigo/core';
import type { PumpCurvePoint } from '@irrigo/core';
import { Badge, Card, NoteCard } from '@irrigo/ui';
import type { FormValues } from '../calculators/types.js';

/**
 * График §5.11: паспортная кривая насоса против характеристики системы.
 *
 * Кривых конкретных насосов в приложении нет и не будет (§5.11, §8 ТЗ) —
 * пользователь вводит две-три точки из паспорта своего насоса, движок
 * аппроксимирует их параболой и ищет пересечение с характеристикой системы.
 * Точка пересечения и есть то, что система выдаст в реальности.
 *
 * Палитра: две категориальные линии на поверхности `--iw-surface-2`. Пара
 * проверена валидатором (разделимость при дальтонизме ΔE 18,3 при пороге 8,
 * контраст к поверхности выше 3:1) и взята из токенов темы, поэтому график
 * остаётся читаемым и в светлой теме. Опознание линий не держится на цвете:
 * под графиком есть легенда, а под ней — те же значения таблицей.
 */

const PUMP_COLOR = 'rgb(var(--iw-accent-strong))';
const SYSTEM_COLOR = 'rgb(var(--iw-warn))';
const INK_MUTED = 'rgb(var(--iw-text-muted))';
const INK_DIM = 'rgb(var(--iw-text-dim))';
const GRID = 'rgb(var(--iw-border))';
const SURFACE = 'rgb(var(--iw-surface-2))';

interface ChartRow {
  q: number;
  pump: number | null;
  system: number | null;
}

function readPoint(values: FormValues, qKey: string, hKey: string): PumpCurvePoint | null {
  const q = values[qKey];
  const h = values[hKey];
  if (typeof q !== 'number' || !Number.isFinite(q)) return null;
  if (typeof h !== 'number' || !Number.isFinite(h)) return null;
  return { flowM3h: q, headM: h };
}

export function PumpCurveChart({ values, result }: { values: FormValues; result: unknown }) {
  const requiredHeadM = Number(
    (result as { values?: { requiredHeadM?: number } } | undefined)?.values?.requiredHeadM,
  );

  const model = useMemo(() => {
    if (values['useCurve'] !== true) return null;

    const points = [
      readPoint(values, 'curveQ1', 'curveH1'),
      readPoint(values, 'curveQ2', 'curveH2'),
      readPoint(values, 'curveQ3', 'curveH3'),
    ].filter((p): p is PumpCurvePoint => p !== null);

    if (points.length < 2) {
      return { error: 'Для графика нужны минимум две точки паспортной кривой.' } as const;
    }

    const designFlow = Number(values['flowM3h']);
    const staticLift = Number(values['staticLiftM']);
    const friction = Number(values['frictionLossM']);
    const minor = typeof values['minorLossM'] === 'number' ? values['minorLossM'] : 0;
    const sprinklerBar = Number(values['sprinklerPressureBar']);

    if (![designFlow, staticLift, friction, sprinklerBar].every((v) => Number.isFinite(v))) {
      return { error: 'Заполните расход, перепад, потери и давление дождевателя.' } as const;
    }

    try {
      const pump = fitPumpCurve(points);
      // Статическая часть характеристики системы: подъём плюс давление,
      // которое должно остаться на дождевателе. Она не зависит от расхода.
      const staticHead = staticLift + barToMwc(sprinklerBar);
      const system = buildSystemCurve(staticHead, designFlow, friction + minor);
      const operating = findOperatingPoint(pump, system);

      const maxQ = Math.max(
        ...points.map((p) => p.flowM3h),
        operating.flowM3h * 1.15,
        designFlow * 1.3,
      );

      const rows: ChartRow[] = [];
      const steps = 60;
      for (let i = 0; i <= steps; i += 1) {
        const q = (maxQ * i) / steps;
        const pumpH = pumpHeadAt(pump, q);
        rows.push({
          q: Number(q.toFixed(3)),
          pump: pumpH >= 0 ? Number(pumpH.toFixed(2)) : null,
          system: Number(systemHeadAt(system, q).toFixed(2)),
        });
      }

      return {
        rows,
        points,
        operating,
        designFlow,
        staticHead,
        requiredAtDesign: systemHeadAt(system, designFlow),
      } as const;
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) } as const;
    }
  }, [values]);

  if (!model) return null;

  if ('error' in model) {
    return (
      <Card title="Ваш насос на вашей системе">
        <NoteCard
          note={{
            severity: 'info',
            message: 'График не построен',
            why: model.error,
            fix: 'Возьмите две-три точки из паспортной кривой вашего насоса: обычно это напор при нулевом расходе и напор в одной-двух рабочих точках.',
          }}
        />
      </Card>
    );
  }

  const { rows, points, operating, designFlow, requiredAtDesign } = model;

  return (
    <Card
      title="Ваш насос на вашей системе"
      subtitle="Пересечение кривых — рабочая точка, то есть то, что получится в действительности"
      actions={
        operating.found ? (
          <Badge tone="ok">
            Рабочая точка {fmt(operating.flowM3h, 2)} м³/ч · {fmt(operating.headM, 1)} м
          </Badge>
        ) : (
          <Badge tone="danger">Пересечения нет</Badge>
        )
      }
    >
      <div className="h-80 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="q"
              type="number"
              domain={[0, 'dataMax']}
              tick={{ fill: INK_DIM, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => fmt(v, 1)}
              label={{
                value: 'Расход Q, м³/ч',
                position: 'insideBottom',
                offset: -16,
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
                value: 'Напор H, м',
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

            <Line
              name="Насос"
              dataKey="pump"
              stroke={PUMP_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              name="Система"
              dataKey="system"
              stroke={SYSTEM_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />

            {/* Требуемый напор с запасом. Он лежит выше характеристики
                системы ровно на величину запаса: сама характеристика — это
                физика, а запас — допуск расчёта, и смешивать их на одной
                линии было бы неправдой. */}
            {Number.isFinite(requiredHeadM) && (
              <ReferenceLine
                y={Number(requiredHeadM.toFixed(2))}
                stroke={INK_DIM}
                strokeDasharray="4 4"
                label={{
                  value: `требуемый напор с запасом ${fmt(requiredHeadM, 1)} м`,
                  position: 'insideTopLeft',
                  fill: INK_MUTED,
                  fontSize: 11,
                }}
              />
            )}

            {/* Введённые точки паспорта — чтобы видеть, как легла аппроксимация. */}
            {points.map((p) => (
              <ReferenceDot
                key={`pasport-${p.flowM3h}-${p.headM}`}
                x={p.flowM3h}
                y={p.headM}
                r={4}
                fill={PUMP_COLOR}
                stroke={SURFACE}
                strokeWidth={2}
                isFront
              />
            ))}

            {/* Расчётная точка: что требуется системе при проектном расходе. */}
            <ReferenceDot
              x={designFlow}
              y={Number(requiredAtDesign.toFixed(2))}
              r={5}
              fill={SYSTEM_COLOR}
              stroke={SURFACE}
              strokeWidth={2}
              isFront
              // Подписи двух точек стоят по разные стороны от своих маркеров:
              // при близких кривых они оказываются рядом и иначе наезжают
              // друг на друга.
              label={{
                value: 'система при расчётном расходе',
                position: 'bottom',
                offset: 12,
                fill: INK_MUTED,
                fontSize: 11,
              }}
            />

            {operating.found && (
              <ReferenceDot
                x={Number(operating.flowM3h.toFixed(2))}
                y={Number(operating.headM.toFixed(2))}
                r={7}
                fill={SURFACE}
                stroke={PUMP_COLOR}
                strokeWidth={3}
                isFront
                label={{
                  value: `рабочая ${fmt(operating.flowM3h, 2)} м³/ч · ${fmt(operating.headM, 1)} м`,
                  position: 'top',
                  offset: 12,
                  fill: INK_MUTED,
                  fontSize: 11,
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Легенда обязательна при двух и более рядах: опознание не должно
          держаться на одном цвете. */}
      <div className="flex flex-wrap items-center gap-5 mt-2 mb-4 text-[13px]">
        <span className="flex items-center gap-2">
          <span className="w-4 h-0.5 rounded-full" style={{ background: PUMP_COLOR }} aria-hidden />
          <span className="text-muted">Кривая насоса H(Q) по точкам паспорта</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="w-4 h-0.5 rounded-full" style={{ background: SYSTEM_COLOR }} aria-hidden />
          <span className="text-muted">Характеристика системы</span>
        </span>
        <span className="flex items-center gap-2">
          <span
            className="w-4 h-0 border-t border-dashed"
            style={{ borderColor: INK_DIM }}
            aria-hidden
          />
          <span className="text-muted">Требуемый напор с запасом</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <caption className="sr-only">
            Числовые значения графика: паспортные точки и рабочая точка
          </caption>
          <thead>
            <tr className="text-left text-dim border-b border-border">
              <th className="py-2 pr-4 font-medium">Точка</th>
              <th className="py-2 pr-4 font-medium">Расход, м³/ч</th>
              <th className="py-2 font-medium">Напор, м</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, index) => (
              <tr key={`row-${p.flowM3h}-${p.headM}`} className="border-b border-border/60">
                <td className="py-2 pr-4 text-muted">Паспорт, точка {index + 1}</td>
                <td className="py-2 pr-4 iw-num">{fmt(p.flowM3h, 2)}</td>
                <td className="py-2 iw-num">{fmt(p.headM, 1)}</td>
              </tr>
            ))}
            <tr className="border-b border-border/60">
              <td className="py-2 pr-4 text-muted">Система при расчётном расходе</td>
              <td className="py-2 pr-4 iw-num">{fmt(designFlow, 2)}</td>
              <td className="py-2 iw-num">{fmt(requiredAtDesign, 1)}</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Рабочая точка (пересечение)</td>
              <td className="py-2 pr-4 iw-num">
                {operating.found ? fmt(operating.flowM3h, 2) : '—'}
              </td>
              <td className="py-2 iw-num">{operating.found ? fmt(operating.headM, 1) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <NoteCard
          note={
            !operating.found
              ? {
                  severity: 'error',
                  message: 'Кривые не пересекаются',
                  why:
                    'Насос не создаёт напора, достаточного даже для статической части системы: ' +
                    'подъём плюс рабочее давление дождевателя. Полива не будет вовсе.',
                  fix: 'Нужен насос с бо́льшим напором, либо меньше геодезический перепад, либо дождеватели с меньшим рабочим давлением.',
                }
              : operating.flowM3h < designFlow
                ? {
                    severity: 'warning',
                    message: `Рабочая точка ниже расчётной: ${fmt(operating.flowM3h, 2)} вместо ${fmt(designFlow, 2)} м³/ч`,
                    why:
                      'Насос не вытянет проектный расход на эту систему. Зона получит меньше воды, ' +
                      'радиус дождевателей упадёт, и в раскладке появятся сухие пятна.',
                    fix: 'Увеличьте диаметр трубы (это сдвинет характеристику системы вниз) или возьмите насос с более пологой кривой.',
                  }
                : {
                    severity: 'success',
                    message: `Насос покрывает расчётный расход с запасом`,
                    why: `Пересечение при ${fmt(operating.flowM3h, 2)} м³/ч — выше проектных ${fmt(designFlow, 2)} м³/ч.`,
                    fix: 'Проверьте по паспорту, что эта точка лежит в средней трети кривой: там у насоса максимальный КПД и наименьший износ.',
                  }
          }
        />
      </div>
    </Card>
  );
}
