/**
 * §5.10. Водный баланс участка и буферная ёмкость.
 *
 *   Потребность [л/сут] = Норма_брутто [мм] · Площадь [м²]
 *   Доступно  [л/сут] = Дебит [м³/ч] · Окно полива [ч] · 1000 · 0,8
 *   V_ёмкости ≥ Потребность − Дебит · Окно
 *   Время наполнения = V / Дебит
 *
 * Коэффициент 0,8 — правило «зона ≤ 80 % дебита источника».
 *
 * ПРИМЕЧАНИЕ О ДВУХ ФОРМУЛАХ ТЗ: формула доступного объёма содержит запас 0,8,
 * а формула объёма ёмкости — нет. Калькулятор считает оба варианта:
 * `tankVolumeStrictL` (буквально по ТЗ, без запаса) и `tankVolumeWithReserveL`
 * (с тем же запасом 0,8). К проектированию рекомендуется второй.
 * Решение зафиксировано в DECISIONS.md.
 *
 * §10 п.5 ТЗ: расчёт с отбором выше дебита скважины блокируется.
 */

import { SOURCE_UTILISATION } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange } from '../internal/build.js';
import type { CalcNote, CalcResult } from '../types.js';

export type SourceKind = 'well' | 'borehole' | 'mains' | 'pond' | 'tank';

export interface WaterBalanceInput {
  /** Норма брутто за полив, мм. */
  grossDepthMm: number;
  /** Поливаемая площадь, м². */
  irrigatedAreaM2: number;
  /** Дебит источника, м³/ч. */
  sourceFlowM3h: number;
  /** Окно полива, ч/сут. */
  windowHours: number;
  /** Число поливов в сутки. По умолчанию 1. */
  irrigationsPerDay?: number;
  sourceKind?: SourceKind;
}

export interface BalanceSuggestion {
  title: string;
  detail: string;
}

export interface WaterBalanceValues {
  /** Потребность, л/сут. */
  demandLPerDay: number;
  /** Физически доступно за окно без запаса, л/сут. */
  rawAvailableLPerDay: number;
  /** Доступно с запасом 0,8, л/сут. */
  availableLPerDay: number;
  balanceOk: boolean;
  /** Дефицит относительно доступного с запасом, л/сут. */
  deficitLPerDay: number;
  /** Объём ёмкости буквально по формуле ТЗ (без запаса), л. */
  tankVolumeStrictL: number;
  /** Объём ёмкости с тем же запасом 0,8 — рекомендуемый, л. */
  tankVolumeWithReserveL: number;
  /** Время наполнения рекомендуемой ёмкости, ч. */
  refillHours: number;
  /** Требуемое окно полива при текущем дебите, ч. */
  requiredWindowHours: number;
  /** Использование источника, доля. */
  utilisation: number;
  suggestions: BalanceSuggestion[];
}

export function waterBalance(input: WaterBalanceInput): CalcResult<WaterBalanceValues> {
  const depth = requirePositive(input.grossDepthMm, 'Норма брутто');
  const area = requirePositive(input.irrigatedAreaM2, 'Поливаемая площадь');
  const flow = requirePositive(input.sourceFlowM3h, 'Дебит источника');
  const window = requireRange(input.windowHours, 0.25, 24, 'Окно полива');
  const perDay = requireRange(input.irrigationsPerDay ?? 1, 1, 4, 'Поливов в сутки');

  const log = new StepLog();
  const demand = depth * area * perDay;
  const raw = flow * window * 1000;
  const available = raw * SOURCE_UTILISATION;

  log.step(
    'Потребность участка',
    'Потребность [л/сут] = Норма_брутто [мм] · Площадь [м²] · поливов в сутки',
    `${fmt(depth, 1)} · ${fmt(area, 0)} · ${fmt(perDay, 0)}`,
    `${fmt(demand, 0)} л/сут (${fmt(demand / 1000, 2)} м³/сут)`,
  );
  log.step(
    'Доступно от источника',
    'Доступно [л/сут] = Дебит [м³/ч] · Окно [ч] · 1000 · 0,8',
    `${fmt(flow, 2)} · ${fmt(window, 1)} · 1000 · 0,8`,
    `${fmt(available, 0)} л/сут`,
  );

  const balanceOk = demand <= available;
  const deficit = Math.max(0, demand - available);
  const tankStrict = Math.max(0, demand - raw);
  const tankReserve = deficit;
  const refill = tankReserve > 0 ? tankReserve / 1000 / flow : 0;
  const requiredWindow = demand / (flow * 1000 * SOURCE_UTILISATION);
  const utilisation = demand / raw;

  log.step(
    'Баланс',
    'Потребность против доступного',
    `${fmt(demand, 0)} против ${fmt(available, 0)} л/сут`,
    balanceOk ? 'сходится' : `дефицит ${fmt(deficit, 0)} л/сут`,
  );
  log.step(
    'Использование источника',
    'k = Потребность / (Дебит · Окно · 1000)',
    `${fmt(demand, 0)} / ${fmt(raw, 0)}`,
    `${fmt(utilisation * 100, 0)} % дебита (предел 80 %)`,
  );

  const suggestions: BalanceSuggestion[] = [];

  if (!balanceOk) {
    log.step(
      'Буферная ёмкость (буквально по формуле ТЗ)',
      'V ≥ Потребность − Дебит · Окно · 1000',
      `${fmt(demand, 0)} − ${fmt(raw, 0)}`,
      `${fmt(tankStrict, 0)} л`,
    );
    log.step(
      'Буферная ёмкость с запасом 0,8 (рекомендуется)',
      'V ≥ Потребность − Дебит · Окно · 1000 · 0,8',
      `${fmt(demand, 0)} − ${fmt(available, 0)}`,
      `${fmt(tankReserve, 0)} л`,
    );
    log.step(
      'Время наполнения ёмкости',
      'T = V / Дебит',
      `${fmt(tankReserve / 1000, 2)} / ${fmt(flow, 2)}`,
      `${fmt(refill, 1)} ч`,
    );

    log.error(
      'balance-deficit',
      `Баланс не сходится: не хватает ${fmt(deficit, 0)} л/сут`,
      'Источник физически не отдаёт столько воды за отведённое окно. Если всё равно запустить систему, дальние зоны будут недополивать, а насос — работать на срыве.',
      'Выберите один из вариантов ниже.',
    );

    suggestions.push({
      title: `Буферная ёмкость от ${fmt(Math.ceil(tankReserve / 100) * 100, 0)} л`,
      detail: `Накопитель наполняется вне окна полива за ${fmt(refill, 1)} ч и отдаёт воду в пик. Самое надёжное решение для скважины со слабым дебитом.`,
    });
    suggestions.push({
      title: `Расширить окно полива до ${fmt(requiredWindow, 1)} ч`,
      detail:
        requiredWindow <= 8
          ? 'Реально: ночного окна обычно хватает, полив с 2:00 до 8:00 не мешает пользованию участком.'
          : `Окно ${fmt(requiredWindow, 1)} ч заходит в дневные часы — испарение вырастет, а на газоне появятся ожоги и болезни. Рассматривайте этот вариант только вместе с другими.`,
    });
    suggestions.push({
      title: 'Перевести часть площади на капельный полив',
      detail:
        'У капельных зон DU 0,85–0,90 против 0,70–0,80 у дождевателей, а испарения почти нет. Кустарники и цветники на капле экономят до трети общей потребности.',
    });
    suggestions.push({
      title: 'Сократить площадь газона',
      detail:
        'Газон — самый водоёмкий элемент участка (Kc 0,7–0,8 при мелких корнях). Замена части газона на отсыпку или почвопокровные снимает потребность быстрее любой другой меры.',
    });
  } else {
    log.info(
      'balance-ok',
      `Баланс сходится: запас ${fmt(available - demand, 0)} л/сут`,
      `Источник используется на ${fmt(utilisation * 100, 0)} % — правило «не выше 80 % дебита» соблюдено.`,
    );
  }

  if (input.sourceKind === 'borehole' || input.sourceKind === 'well') {
    const wellNote: CalcNote = {
      severity: utilisation > 1 ? 'error' : 'warning',
      code: 'well-limit',
      message: 'Скважина и колодец: отбор выше дебита недопустим',
      why: 'При откачке ниже динамического уровня насос хватает воздух и песок: подшипники выходят из строя за часы, а скважина заиливается и теряет дебит безвозвратно.',
      fix: 'Обязательны защита от сухого хода и подвес насоса выше фильтра. Дебит берите по паспорту прокачки, а не по первому замеру.',
    };
    log.notes.push(wellNote);
  }

  if (utilisation > 1) {
    log.error(
      'over-source-capacity',
      `Отбор ${fmt(utilisation * 100, 0)} % дебита — выше физической производительности источника`,
      'Это не «немного не хватит»: система не наберёт расчётный расход ни при каком насосе, потому что источник столько не отдаёт.',
      'Расчёт в таком виде нельзя закладывать в проект — сначала буферная ёмкость или сокращение потребности.',
    );
  }

  return {
    values: {
      demandLPerDay: round(demand, 0),
      rawAvailableLPerDay: round(raw, 0),
      availableLPerDay: round(available, 0),
      balanceOk,
      deficitLPerDay: round(deficit, 0),
      tankVolumeStrictL: round(tankStrict, 0),
      tankVolumeWithReserveL: round(tankReserve, 0),
      refillHours: round(refill, 2),
      requiredWindowHours: round(requiredWindow, 2),
      utilisation: round(utilisation, 3),
      suggestions,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
