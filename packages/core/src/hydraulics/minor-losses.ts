/**
 * §5.5. Местные потери.
 *
 * Два слагаемых:
 *   1) фитинги и повороты — 10–20 % от потерь на трение при обычной раскладке;
 *   2) паспортные потери на устройствах узла (клапан, фильтр, редуктор,
 *      счётчик, обратный клапан) — отдельными строками, значения вводит
 *      пользователь или берёт из справочника.
 */

import { fmt, round } from '../format.js';
import { StepLog, requireNonNegative, requireRange } from '../internal/build.js';
import type { CalcResult } from '../types.js';
import { barToMwc } from '../units.js';

export type DeviceKind = 'valve' | 'filter' | 'regulator' | 'meter' | 'check_valve' | 'other';

export interface DeviceLoss {
  name: string;
  kind: DeviceKind;
  /** Паспортные потери при рабочем расходе, бар. */
  lossBar: number;
  /** Откуда взято значение — обязательно для проектной трассируемости. */
  source?: string;
}

export interface MinorLossInput {
  /** Потери на трение по участку, м вод. ст. (из §5.2). */
  frictionLossM: number;
  /** Доля местных потерь на фитингах, 0,10–0,20. По умолчанию 0,15. */
  fittingsShare?: number;
  /** Устройства узла управления с паспортными потерями. */
  devices?: DeviceLoss[];
}

export interface MinorLossValues {
  fittingsLossM: number;
  devicesLossM: number;
  devicesLossBar: number;
  totalMinorLossM: number;
  totalMinorLossBar: number;
  /** Потери на трение + все местные, м вод. ст. */
  grandTotalM: number;
  breakdown: { name: string; lossM: number; lossBar: number; source?: string }[];
}

export function minorLosses(input: MinorLossInput): CalcResult<MinorLossValues> {
  const friction = requireNonNegative(input.frictionLossM, 'Потери на трение');
  const share = requireRange(input.fittingsShare ?? 0.15, 0, 1, 'Доля местных потерь');
  const devices = input.devices ?? [];

  const log = new StepLog();
  const fittings = friction * share;

  log.step(
    'Местные потери на фитингах',
    'h_фит = hf · k,  k = 0,10…0,20',
    `${fmt(friction, 2)} · ${fmt(share, 2)}`,
    `${fmt(fittings, 2)} м вод. ст.`,
  );

  const breakdown: MinorLossValues['breakdown'] = [];
  let devicesM = 0;
  for (const d of devices) {
    requireNonNegative(d.lossBar, `Потери на «${d.name}»`);
    const m = barToMwc(d.lossBar);
    devicesM += m;
    const row: MinorLossValues['breakdown'][number] = {
      name: d.name,
      lossM: round(m, 2),
      lossBar: round(d.lossBar, 3),
    };
    if (d.source) row.source = d.source;
    breakdown.push(row);
    log.step(
      `Потери на устройстве: ${d.name}`,
      'h = P [бар] · 10,2',
      `${fmt(d.lossBar, 2)} · 10,2`,
      `${fmt(m, 2)} м вод. ст.`,
    );
    if (!d.source) {
      log.warn(
        'device-no-source',
        `Для «${d.name}» не указан источник значения потерь`,
        'Потери на клапане и фильтре зависят от расхода и сильно различаются между моделями; цифра «по памяти» ломает весь расчёт напора.',
        'Возьмите значение из графика потерь в техкарте производителя при вашем расходе.',
      );
    }
  }

  const totalMinor = fittings + devicesM;
  const grand = friction + totalMinor;

  log.step(
    'Итого местные потери',
    'h_мест = h_фит + Σ h_устройств',
    `${fmt(fittings, 2)} + ${fmt(devicesM, 2)}`,
    `${fmt(totalMinor, 2)} м вод. ст.`,
  );
  log.step(
    'Всего потери по участку',
    'h_общ = hf + h_мест',
    `${fmt(friction, 2)} + ${fmt(totalMinor, 2)}`,
    `${fmt(grand, 2)} м вод. ст. (${fmt(grand / 10.2, 2)} бар)`,
  );

  if (devices.length === 0) {
    log.info(
      'no-devices',
      'Устройства узла управления не заданы',
      'Фильтр и клапан обычно съедают 0,2–0,5 бар каждый — это заметная часть бюджета давления.',
      'Добавьте фильтр, клапан зоны, редуктор и счётчик, если они есть в узле.',
    );
  }

  if (share > 0.2) {
    log.warn(
      'fittings-share-high',
      `Доля местных потерь ${fmt(share * 100, 0)} % выше обычных 10–20 %`,
      'Такая доля бывает при очень изломанной трассе с большим числом отводов и переходов.',
      'Если трасса обычная, вернитесь к 0,15; если действительно много поворотов — считайте отводы по эквивалентным длинам.',
    );
  }

  return {
    values: {
      fittingsLossM: round(fittings, 3),
      devicesLossM: round(devicesM, 3),
      devicesLossBar: round(devicesM / 10.2, 3),
      totalMinorLossM: round(totalMinor, 3),
      totalMinorLossBar: round(totalMinor / 10.2, 3),
      grandTotalM: round(grand, 3),
      breakdown,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
