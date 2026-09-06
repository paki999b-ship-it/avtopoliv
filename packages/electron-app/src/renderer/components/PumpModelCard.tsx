import { useEffect, useState } from 'react';
import { Badge, Button, Card } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import { PUMP_TYPE_TITLES } from '@shared/reference.js';
import type { PumpDto } from '@shared/pumps.js';
import { errorText, invoke } from '../lib/bridge.js';
import { PumpCatalogChart } from './PumpCatalogChart.js';

/**
 * Карточка модели насоса в справочнике (§3.3, часть 2 задачи).
 *
 * Показывает ту же кривую, что и подбор в калькуляторе, тем же компонентом:
 * если бы справочник рисовал её по-своему, две картинки одной и той же машины
 * могли бы разойтись.
 *
 * Таблица точек приводится полностью — это и есть первоисточник, из которого
 * считается всё остальное.
 */
export function PumpModelCard({ pumpId, onClose }: { pumpId: number; onClose: () => void }) {
  const [pump, setPump] = useState<PumpDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPump(null);
    void invoke('pumps:get', pumpId)
      .then((data) => !cancelled && setPump(data))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [pumpId]);

  if (error) return <p className="text-[13px] text-danger mb-4">{error}</p>;
  if (!pump) return <p className="text-[13px] text-dim mb-4">Загрузка кривой…</p>;

  return (
    <Card
      className="mb-5"
      title={`${pump.brand} ${pump.model}`}
      subtitle={pump.altModel ? `Трёхфазное исполнение: ${pump.altModel}` : pump.series}
      actions={
        <div className="flex items-center gap-2">
          <Badge>{PUMP_TYPE_TITLES[pump.type] ?? pump.type}</Badge>
          {pump.digitized ? (
            <Badge tone="warn">кривая снята с графика</Badge>
          ) : (
            <Badge tone="ok">из таблицы каталога</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-[13px]">
        <Fact label="Мощность P2">
          {pump.powerKwMin ? `${fmt(pump.powerKwMin, 2)} кВт` : 'уточнить'}
        </Fact>
        <Fact label="Питание">{pump.voltage || 'уточнить'}</Fact>
        <Fact label="Q макс. по таблице">{fmt(pump.qMaxM3h, 1)} м³/ч</Fact>
        <Fact label="H макс. по таблице">{fmt(pump.hMaxM, 1)} м</Fact>
      </div>

      <PumpCatalogChart pump={pump} height={260} />

      <div className="mt-4 overflow-x-auto">
        <table className="text-[12px] border-collapse">
          <tbody>
            <tr className="border-b border-border/60">
              <th className="text-left py-1.5 pr-4 text-dim font-medium whitespace-nowrap">
                Q, м³/ч
              </th>
              {pump.curve.map((p) => (
                <td key={`q-${p.qM3h}`} className="py-1.5 px-2.5 iw-num text-right">
                  {fmt(p.qM3h, 1)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-left py-1.5 pr-4 text-dim font-medium whitespace-nowrap">
                H, м
              </th>
              {pump.curve.map((p) => (
                <td key={`h-${p.qM3h}`} className="py-1.5 px-2.5 iw-num text-right">
                  {fmt(p.hM, 1)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-dim mt-4 leading-relaxed">
        Источник: {pump.sourceFile}, стр. {pump.sourcePage}.
        {pump.digitizedNote ? ` Как снята кривая: ${pump.digitizedNote}` : ''} Значения между
        точками таблицы получены линейной интерполяцией — производитель их не публиковал.
        Перед заказом сверьте характеристику с актуальным каталогом.
      </p>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-dim">{label}</p>
      <p className="iw-num mt-0.5">{children}</p>
    </div>
  );
}
