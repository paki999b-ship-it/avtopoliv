import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Select, Stat, cx, pumpCurveColor } from '@irrigo/ui';
import { MAX_PUMP_CURVES_ON_CHART } from '@irrigo/ui';
import { barToMwc, buildSystemCurve, fmt } from '@irrigo/core';
import { PUMP_TYPE_TITLES } from '@shared/reference.js';
import type { PumpSelectionResult, PumpType } from '@shared/pumps.js';
import type { FormValues } from '../calculators/types.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize, pumpTitle } from '../lib/format.js';
import { PumpCatalogChart } from './PumpCatalogChart.js';

/**
 * Подбор насоса по загруженным каталогам (§5.11, часть 2 задачи).
 *
 * Блок появляется под результатом калькулятора требуемого напора: у него уже
 * есть и требуемая точка (Q; H с запасом), и составляющие характеристики
 * системы, так что подбор не требует вводить что-либо заново.
 *
 * Отдельный случай, который надо показать честно, — **пустая выдача**. Она
 * означает разное: каталогов может не быть в базе вовсе, а может быть так, что
 * ни один загруженный насос не покрывает требуемую точку. Поэтому пустой
 * график не рисуется, а пишется, что именно произошло и какие каталоги вообще
 * разобраны.
 */

const TYPE_OPTIONS: Array<{ value: PumpType | 'any'; label: string }> = [
  { value: 'any', label: 'Любой тип' },
  { value: 'surface', label: PUMP_TYPE_TITLES['surface']! },
  { value: 'submersible', label: PUMP_TYPE_TITLES['submersible']! },
  { value: 'multistage', label: PUMP_TYPE_TITLES['multistage']! },
  { value: 'booster_station', label: PUMP_TYPE_TITLES['booster_station']! },
];

interface Required {
  flowM3h: number;
  headM: number;
  staticHeadM: number;
  designLossM: number;
}

function requirementOf(values: FormValues, result: unknown): Required | null {
  const flow = Number(values['flowM3h']);
  const staticLift = Number(values['staticLiftM']);
  const friction = Number(values['frictionLossM']);
  const minor = typeof values['minorLossM'] === 'number' ? values['minorLossM'] : 0;
  const sprinklerBar = Number(values['sprinklerPressureBar']);

  const headM = Number(
    (result as { values?: { requiredHeadM?: number } } | undefined)?.values?.requiredHeadM,
  );

  if (![flow, staticLift, friction, sprinklerBar, headM].every((v) => Number.isFinite(v))) {
    return null;
  }
  if (flow <= 0 || headM <= 0) return null;

  return {
    flowM3h: flow,
    headM,
    // Статическая часть характеристики системы не зависит от расхода:
    // подъём плюс давление, которое должно остаться на дождевателе.
    staticHeadM: staticLift + barToMwc(sprinklerBar),
    designLossM: friction + minor,
  };
}

export function PumpMatches({ values, result }: { values: FormValues; result: unknown }) {
  const requirement = requirementOf(values, result);
  const [type, setType] = useState<PumpType | 'any'>('any');
  const [data, setData] = useState<PumpSelectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requirement) {
      setData(null);
      return;
    }
    let cancelled = false;
    void invoke('pumps:select', {
      flowM3h: requirement.flowM3h,
      headM: requirement.headM,
      staticHeadM: requirement.staticHeadM,
      designLossM: requirement.designLossM,
      ...(type === 'any' ? {} : { type }),
    })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [
    requirement?.flowM3h,
    requirement?.headM,
    requirement?.staticHeadM,
    requirement?.designLossM,
    type,
  ]);

  if (!requirement) return null;

  const system = buildSystemCurve(
    requirement.staticHeadM,
    Math.max(0.01, requirement.flowM3h),
    requirement.designLossM,
  );

  const matches = data?.matches ?? [];
  const onChart = matches.slice(0, MAX_PUMP_CURVES_ON_CHART);

  return (
    <Card
      title="Какой насос подойдёт"
      subtitle={`Модели из каталогов, которые дают ${fmt(requirement.headM, 1)} м при ${fmt(requirement.flowM3h, 2)} м³/ч`}
      actions={
        <Select value={type} onChange={(e) => setType(e.target.value as PumpType | 'any')}>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      }
    >
      {error && <p className="text-[13px] text-danger mb-3">{error}</p>}

      {!data && !error && <p className="text-[13px] text-dim">Подбираю по каталогам…</p>}

      {data && matches.length === 0 && (
        <EmptyState
          title={
            data.catalogSize === 0
              ? 'Каталоги насосов не загружены'
              : 'Подходящих насосов в каталогах нет'
          }
          description={
            data.catalogSize === 0
              ? 'В базе нет ни одного насоса, поэтому подбирать не из чего. Каталоги собираются из PDF в /content скриптом extract-pump-catalogs.'
              : `Ни один из ${data.catalogSize} загруженных насосов не даёт ${fmt(
                  requirement.headM,
                  1,
                )} м при ${fmt(requirement.flowM3h, 2)} м³/ч в своём рабочем диапазоне: либо не хватает напора, ` +
                  `либо запас выше предела +${fmt((data.maxOverhead - 1) * 100, 0)} %, ` +
                  `либо ваш расход лежит у левого края кривой (меньше ${fmt(
                    data.minFlowShare * 100,
                    0,
                  )} % от паспортного максимума) — такой насос не своего класса. ` +
                  'Проверьте требуемую точку: часто дело в заниженном диаметре магистрали, а не в насосе.'
          }
        />
      )}

      {data && matches.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Найдено" value={String(matches.length)} hint={`из ${data.catalogSize}`} />
            <Stat
              label="Ближайший запас"
              value={`+${fmt(matches[0]!.marginM, 1)} м`}
              hint={`+${fmt(matches[0]!.marginRatio * 100, 0)} %`}
              tone="ok"
            />
            <Stat
              label="Предел запаса"
              value={`+${fmt((data.maxOverhead - 1) * 100, 0)} %`}
              hint={`и не левее ${fmt(data.minFlowShare * 100, 0)} % от Q_max кривой`}
            />
          </div>

          <PumpCatalogChart
            matches={matches}
            system={system}
            required={{ qM3h: requirement.flowM3h, hM: requirement.headM }}
          />

          {matches.length > onChart.length && (
            <p className="text-[12px] text-dim mt-1 mb-3">
              На графике — первые {onChart.length} по величине запаса; остальные{' '}
              {pluralize(matches.length - onChart.length, 'насос', 'насоса', 'насосов')} ниже
              списком.
            </p>
          )}

          <div className="flex flex-col gap-2 mt-4">
            {matches.map((match, index) => (
              <div
                key={match.pump.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-2"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0 mt-1"
                  style={{
                    background:
                      index < onChart.length ? pumpCurveColor(index) : 'rgb(var(--iw-text-dim))',
                  }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{pumpTitle(match.pump)}</span>
                    <Badge>{PUMP_TYPE_TITLES[match.pump.type] ?? match.pump.type}</Badge>
                    {match.pump.digitized && <Badge tone="warn">кривая снята с графика</Badge>}
                  </div>

                  <p className="text-[13px] text-muted mt-1">
                    В требуемой точке{' '}
                    <span className="iw-num text-fg">{fmt(match.headAtRequiredM, 1)} м</span> —
                    запас +{fmt(match.marginM, 1)} м ({fmt(match.marginRatio * 100, 0)} %). Ваш
                    расход — {fmt(match.flowShare * 100, 0)} % от паспортного максимума этой
                    машины.
                    {match.operatingPoint && (
                      <>
                        {' '}
                        Фактическая рабочая точка с этой системой:{' '}
                        <span className="iw-num text-fg">
                          {fmt(match.operatingPoint.qM3h, 2)} м³/ч
                        </span>{' '}
                        при{' '}
                        <span className="iw-num text-fg">
                          {fmt(match.operatingPoint.hM, 1)} м
                        </span>
                        .
                      </>
                    )}
                  </p>

                  <p className="text-[12px] text-dim mt-1">
                    {match.pump.powerKwMin
                      ? `P2 ${fmt(match.pump.powerKwMin, 2)} кВт · `
                      : 'мощность — уточнить по каталогу · '}
                    {match.pump.voltage} · {match.pump.sourceFile}, стр. {match.pump.sourcePage}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className={cx('text-[12px] text-dim mt-4 leading-relaxed')}>
            Характеристики взяты из каталога производителя и приведены для справки. Перед
            заказом сверьте кривую и рабочую точку с актуальной техкартой: издание каталога
            указано в строке источника. Проверьте также NPSH и высоту всасывания — по кривой
            Q–H они не видны.
          </p>
        </>
      )}

      {data && data.sources.length > 0 && (
        <details className="mt-4">
          <summary className="text-[12px] text-dim cursor-pointer hover:text-muted">
            Какие каталоги разобраны
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {data.sources.map((s) => (
              <li key={s.file} className="text-[12px] leading-relaxed">
                <span className={s.status === 'parsed' ? 'text-ok' : 'text-dim'}>
                  {s.status === 'parsed' ? '✓' : '·'}
                </span>{' '}
                <span className="text-muted">{s.file}</span> —{' '}
                {s.status === 'parsed'
                  ? `${pluralize(s.pumps, 'модель', 'модели', 'моделей')} со страниц каталога`
                  : s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
