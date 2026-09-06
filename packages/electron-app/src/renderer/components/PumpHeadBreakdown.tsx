import { Card, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type { HeadComponent } from '@irrigo/core';
import type { FormValues } from '../calculators/types.js';

/**
 * Из чего сложился требуемый напор (§5.11).
 *
 * Само число «нужен насос на 66 метров» не объясняет ничего: непонятно, велико
 * оно или нормально и за счёт чего его можно уменьшить. Разбор по слагаемым
 * отвечает на оба вопроса сразу — почти всегда выясняется, что половину
 * занимает рабочее давление дождевателя, которое урезать нельзя, а трение,
 * которое обычно и пытаются «полечить» насосом, занимает малую долю.
 *
 * Слагаемые считает движок (`pumpHead().values.breakdown`) — здесь только
 * вывод. Цветового кодирования нет намеренно: доли показаны длиной полосы,
 * подписи стоят рядом с числами, и опознание не держится на цвете.
 */

interface Result {
  values?: {
    breakdown?: HeadComponent[];
    requiredHeadM?: number;
    requiredHeadBar?: number;
    headBeforeMarginM?: number;
  };
}

export function PumpHeadBreakdown({ values, result }: { values: FormValues; result: unknown }) {
  const parts = (result as Result | undefined)?.values?.breakdown;
  const required = (result as Result | undefined)?.values?.requiredHeadM;
  const requiredBar = (result as Result | undefined)?.values?.requiredHeadBar;
  const flow = Number(values['flowM3h']);

  if (!parts || parts.length === 0 || !Number.isFinite(required ?? NaN)) return null;

  const max = Math.max(...parts.map((p) => p.share));

  return (
    <Card
      title="Из чего сложился требуемый напор"
      subtitle={
        Number.isFinite(flow)
          ? `Насос должен давать ${fmt(required!, 1)} м (${fmt(requiredBar ?? 0, 2)} бар) при ${fmt(flow, 2)} м³/ч`
          : `Требуется ${fmt(required!, 1)} м`
      }
    >
      <ul className="flex flex-col gap-3.5">
        {parts.map((part) => (
          <li key={part.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px]">{part.label}</span>
              <span className="text-[13px] shrink-0">
                <span className="iw-num">{fmt(part.headM, 1)}</span>
                <span className="text-dim"> м · </span>
                <span className="iw-num text-muted">{fmt(part.share * 100, 0)} %</span>
              </span>
            </div>

            {/* Доля показана длиной полосы. Самое крупное слагаемое занимает
                всю ширину, остальные — пропорционально ему: так разница между
                «половина напора» и «пять процентов» видна с одного взгляда. */}
            <div className="h-2 mt-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className={cx(
                  'h-full rounded-full',
                  // Запас — не физическая составляющая, а допуск расчёта,
                  // поэтому он отбит штриховкой, а не сплошной заливкой.
                  part.key === 'margin' ? 'bg-accent/40' : 'bg-accent',
                )}
                style={{ width: `${Math.max(2, (part.share / max) * 100)}%` }}
                aria-hidden
              />
            </div>

            <p className="text-[12px] text-dim mt-1.5 leading-relaxed">{part.lever}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
