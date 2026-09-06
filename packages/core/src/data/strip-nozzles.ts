/**
 * Полосовые форсунки Hunter (strip pattern nozzles) — §3.3.1, таблица
 * `equipment_nozzles`.
 *
 * ── ИСТОЧНИК ───────────────────────────────────────────────────────────────
 * Hunter Industries, технический лист «Strip Pattern Nozzles», метрическая
 * версия: CA-Cutsheet-Strip-Pattern-Nozzles-EM.pdf
 * https://www.hunterirrigation.com/sites/default/files/CA-Cutsheet-Strip-Pattern-Nozzles-EM.pdf
 * Сверено 30.08.2026.
 *
 * ── ПОЧЕМУ ДАННЫЕ ЗДЕСЬ, А НЕ В `/content` ─────────────────────────────────
 * Таблица нужна не только справочнику, но и калькулятору §5.6: выбор модели и
 * давления должен подставлять размер полосы прямо в расчёт, а калькуляторы
 * живут в renderer и в базу не ходят. Так же устроены сортамент труб и
 * справочник почв: измеренные значения лежат в движке, а производные —
 * интенсивность, расходы при скоростях — вычисляются, а не переписываются.
 *
 * ── ЧТО ЗДЕСЬ НЕ ХРАНИТСЯ ──────────────────────────────────────────────────
 * Интенсивность (PR). Она считается функцией `stripNozzlePrecipitationRate`
 * по §5.6: расход, делённый на площадь полосы. Хранить её рядом с исходными
 * данными значило бы завести второй источник правды об одном числе.
 */

export const STRIP_NOZZLE_SOURCE =
  'Hunter Industries. Cutsheet Strip Pattern Nozzles (метрическая версия), ' +
  'CA-Cutsheet-Strip-Pattern-Nozzles-EM.pdf';

export const STRIP_NOZZLE_SOURCE_URL =
  'https://www.hunterirrigation.com/sites/default/files/CA-Cutsheet-Strip-Pattern-Nozzles-EM.pdf';

export const STRIP_NOZZLE_COLLECTED_AT = '2026-08-30';

/** Рекомендованное производителем рабочее давление всей группы, бар. */
export const STRIP_RECOMMENDED_PRESSURE_BAR = 2.1;

/** Общие сведения о группе — показываются в карточке справочника. */
export const STRIP_NOZZLE_COMMON = {
  brand: 'Hunter',
  family: 'strip',
  familyTitle: 'Полосовые',
  inletThread: '1/2" внутренняя',
  sectorAdjustable: false,
  warrantyYears: 2,
  compatibility:
    'Стандартные корпуса спрея и стойки-адаптеры для кустарников. Рекомендуется корпус ' +
    'Pro-Spray PRS30 со встроенным регулятором давления на 2,1 бар: он держит рекомендованную ' +
    'рабочую точку и выравнивает интенсивность по зоне.',
  purpose:
    'Точный полив узких полос газона и цветников вдоль дорожек, подъездов и стен — там, ' +
    'где обычный сектор даёт перелив на твёрдое покрытие.',
} as const;

/** Форма полива: где стоит форсунка и куда уходит полоса. */
export type StripPattern =
  | 'left_corner'
  | 'right_corner'
  | 'side'
  | 'side_wide'
  | 'center'
  | 'end';

export interface StripNozzleRow {
  pressureBar: number;
  pressureKpa: number;
  /** Ширина полосы, м. */
  widthM: number;
  /** Длина полосы, м. */
  lengthM: number;
  flowM3h: number;
  /** Расход из того же листа в л/мин — вторая форма записи, служит сверкой. */
  flowLmin: number;
  /** Рекомендованная производителем рабочая точка. */
  recommended?: boolean;
}

export interface StripNozzleModel {
  model: string;
  pattern: StripPattern;
  patternRu: string;
  patternEn: string;
  description: string;
  rows: readonly StripNozzleRow[];
}

export const STRIP_NOZZLES: readonly StripNozzleModel[] = [
  {
    model: 'LCS-515',
    pattern: 'left_corner',
    patternRu: 'Левый угол',
    patternEn: 'Left Corner Strip',
    description: 'Форсунка стоит в углу, полоса уходит от неё вдоль кромки вправо.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 1.2, lengthM: 4.2, flowM3h: 0.1, flowLmin: 1.7 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 1.2, lengthM: 4.3, flowM3h: 0.13, flowLmin: 2.1 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 1.5, lengthM: 4.5, flowM3h: 0.15, flowLmin: 2.5, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 1.5, lengthM: 4.5, flowM3h: 0.16, flowLmin: 2.7 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 1.5, lengthM: 4.5, flowM3h: 0.17, flowLmin: 2.8 },
    ],
  },
  {
    model: 'RCS-515',
    pattern: 'right_corner',
    patternRu: 'Правый угол',
    patternEn: 'Right Corner Strip',
    description: 'Зеркальная пара к LCS-515: полоса уходит от угла влево.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 1.2, lengthM: 4.2, flowM3h: 0.1, flowLmin: 1.7 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 1.2, lengthM: 4.3, flowM3h: 0.13, flowLmin: 2.1 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 1.5, lengthM: 4.5, flowM3h: 0.15, flowLmin: 2.5, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 1.5, lengthM: 4.5, flowM3h: 0.16, flowLmin: 2.7 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 1.5, lengthM: 4.5, flowM3h: 0.17, flowLmin: 2.8 },
    ],
  },
  {
    model: 'SS-530',
    pattern: 'side',
    patternRu: 'Боковая полоса',
    patternEn: 'Side Strip',
    description:
      'Форсунка стоит на длинной стороне полосы и поливает её в обе стороны от себя.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 1.2, lengthM: 8.5, flowM3h: 0.21, flowLmin: 3.5 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 1.5, lengthM: 9.0, flowM3h: 0.25, flowLmin: 4.2 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 1.5, lengthM: 9.1, flowM3h: 0.3, flowLmin: 5.0, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 1.5, lengthM: 9.1, flowM3h: 0.33, flowLmin: 5.5 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 1.5, lengthM: 9.1, flowM3h: 0.34, flowLmin: 5.7 },
    ],
  },
  {
    model: 'SS-918',
    pattern: 'side_wide',
    patternRu: 'Боковая полоса, широкая',
    patternEn: 'Side Strip',
    description: 'Шире и короче, чем SS-530: для полос вдоль широких дорожек и клумб.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 2.4, lengthM: 5.2, flowM3h: 0.27, flowLmin: 4.5 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 2.7, lengthM: 5.5, flowM3h: 0.33, flowLmin: 5.5 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 2.7, lengthM: 5.5, flowM3h: 0.39, flowLmin: 6.5, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 2.7, lengthM: 5.5, flowM3h: 0.43, flowLmin: 7.1 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 2.7, lengthM: 5.5, flowM3h: 0.47, flowLmin: 7.9 },
    ],
  },
  {
    model: 'CS-530',
    pattern: 'center',
    patternRu: 'Центральная полоса',
    patternEn: 'Center Strip',
    description:
      'Форсунка стоит в середине полосы и поливает её на обе стороны — для длинных участков между двумя кромками.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 1.2, lengthM: 8.5, flowM3h: 0.21, flowLmin: 3.5 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 1.5, lengthM: 9.0, flowM3h: 0.25, flowLmin: 4.2 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 1.5, lengthM: 9.1, flowM3h: 0.3, flowLmin: 5.0, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 1.5, lengthM: 9.1, flowM3h: 0.33, flowLmin: 5.5 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 1.5, lengthM: 9.1, flowM3h: 0.34, flowLmin: 5.7 },
    ],
  },
  {
    model: 'ES-515',
    pattern: 'end',
    patternRu: 'Концевая полоса',
    patternEn: 'End Strip',
    description: 'Форсунка стоит на торце полосы и поливает её от себя — замыкает полосу.',
    rows: [
      { pressureBar: 1.0, pressureKpa: 100, widthM: 1.1, lengthM: 4.2, flowM3h: 0.1, flowLmin: 1.7 },
      { pressureBar: 1.5, pressureKpa: 150, widthM: 1.2, lengthM: 4.3, flowM3h: 0.13, flowLmin: 2.1 },
      { pressureBar: 2.1, pressureKpa: 210, widthM: 1.5, lengthM: 4.5, flowM3h: 0.15, flowLmin: 2.5, recommended: true },
      { pressureBar: 2.5, pressureKpa: 250, widthM: 1.5, lengthM: 4.5, flowM3h: 0.16, flowLmin: 2.7 },
      { pressureBar: 3.0, pressureKpa: 300, widthM: 1.5, lengthM: 4.5, flowM3h: 0.17, flowLmin: 2.8 },
    ],
  },
] as const;

export function stripNozzleModel(model: string): StripNozzleModel | undefined {
  return STRIP_NOZZLES.find((m) => m.model === model);
}

/** Строка производительности модели при заданном давлении. */
export function stripNozzleRow(model: string, pressureBar: number): StripNozzleRow | undefined {
  return stripNozzleModel(model)?.rows.find((r) => r.pressureBar === pressureBar);
}
