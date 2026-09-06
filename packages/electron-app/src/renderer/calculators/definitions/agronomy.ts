import {
  DU_DEFAULTS,
  PLANTS,
  SOILS,
  STRIP_NOZZLES,
  STRIP_RECOMMENDED_PRESSURE_BAR,
  fmt,
  headPrecipitationRate,
  irrigationRequirement,
  runTime,
  soilWaterHoldingNorm,
  stripNozzlePrecipitationRate,
  stripNozzleRow,
  waterBalance,
  zonePrecipitationRate,
} from '@irrigo/core';
import type {
  DuPreset,
  EmitterClass,
  LayoutPattern,
  PlantType,
  RunCycle,
  SoilType,
  SourceKind,
} from '@irrigo/core';
import type { CalcDefinition, ResultTable } from '../types.js';
import { bool, num, optNum, str } from '../lib.js';

/**
 * Калькуляторы §5.6–§5.10: интенсивность дождя, норма полива, время полива,
 * запас влаги и водный баланс участка.
 *
 * Справочные значения (впитывание почв, влагоёмкость, Kc, глубина корней)
 * берутся из таблиц движка, а не вводятся заново: у каждой строки там есть
 * поле `source`, и переписывать их в форму значило бы потерять источник.
 */

const CUSTOM = 'custom';

/** Подписи режимов калькулятора — используются в заголовке записи истории. */
const MODE_TITLES: Record<string, string> = {
  head: 'Голова',
  zone: 'Зона',
  strip: 'Полоса',
};

const STRIP_MODEL_OPTIONS = STRIP_NOZZLES.map((m) => ({
  value: m.model,
  label: `${m.model} — ${m.patternRu}`,
}));

/**
 * Давления берутся у первой модели: в техническом листе сетка давлений
 * одинакова для всей группы. Если она разойдётся, расчёт сообщит об этом
 * явно — строки для выбранной пары «модель + давление» просто не найдётся.
 */
const STRIP_PRESSURE_OPTIONS = STRIP_NOZZLES[0]!.rows.map((r) => ({
  value: String(r.pressureBar),
  label: `${fmt(r.pressureBar, 1)} бар${r.recommended ? ' — рекомендовано' : ''}`,
}));

const SOIL_OPTIONS = [
  ...SOILS.map((s) => ({ value: s.type, label: s.titleRu })),
  { value: CUSTOM, label: 'Задать вручную' },
];

const PLANT_OPTIONS = [
  ...PLANTS.map((p) => ({ value: p.type, label: p.titleRu })),
  { value: CUSTOM, label: 'Задать вручную' },
];

const DU_PRESETS: Array<{ value: DuPreset | typeof CUSTOM; label: string }> = [
  { value: 'spray', label: `Спреи — DU ${fmt(DU_DEFAULTS.spray.typical, 2)}` },
  { value: 'rotor', label: `Роторы — DU ${fmt(DU_DEFAULTS.rotor.typical, 2)}` },
  { value: 'rotary_nozzle', label: `Роторные сопла — DU ${fmt(DU_DEFAULTS.rotary_nozzle.typical, 2)}` },
  { value: 'drip', label: `Капельный полив — DU ${fmt(DU_DEFAULTS.drip.typical, 2)}` },
  { value: CUSTOM, label: 'Замеренный DU (тест «баночками»)' },
];

const EMITTER_OPTIONS: Array<{ value: EmitterClass; label: string }> = [
  { value: 'rotor', label: 'Роторы' },
  { value: 'spray', label: 'Спреи' },
  { value: 'rotary_nozzle', label: 'Роторные сопла' },
  { value: 'drip', label: 'Капельный полив' },
  { value: 'bubbler', label: 'Баблеры' },
  { value: 'micro_spray', label: 'Микродождевание' },
];

/** Впитывание выбранной почвы: середина диапазона из справочника движка. */
function soilInfiltration(values: Record<string, unknown>): number | undefined {
  const key = String(values['soilType'] ?? CUSTOM);
  if (key === CUSTOM) {
    const raw = values['soilInfiltrationMmH'];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  }
  const soil = SOILS.find((s) => s.type === (key as SoilType));
  if (!soil) return undefined;
  return (soil.infiltrationMinMmH + soil.infiltrationMaxMmH) / 2;
}

// ── §5.6. Интенсивность дождя ────────────────────────────────────────────────

export const precipitationRateCalculator: CalcDefinition = {
  key: 'precipitation-rate',

  fields: [
    {
      kind: 'select',
      name: 'mode',
      label: 'Что считаем',
      options: [
        { value: 'head', label: 'PR по одной голове и шагу раскладки' },
        { value: 'zone', label: 'PR зоны по факту: суммарный расход на площадь' },
        { value: 'strip', label: 'PR полосовой форсунки: расход на прямоугольник' },
      ],
    },

    // Режим «по голове»
    {
      kind: 'number',
      name: 'flowLph',
      label: 'Расход одной головы',
      unit: 'л/ч',
      quantity: 'flowLph',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zone' && v['mode'] !== 'strip',
    },
    {
      kind: 'number',
      name: 'spacingM',
      label: 'Шаг между дождевателями в ряду',
      unit: 'м',
      quantity: 'length',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zone' && v['mode'] !== 'strip',
    },
    {
      kind: 'number',
      name: 'rowSpacingM',
      label: 'Шаг между рядами',
      unit: 'м',
      quantity: 'length',
      optional: true,
      hint: 'По умолчанию равен шагу в ряду',
      visibleIf: (v) => v['mode'] !== 'zone' && v['mode'] !== 'strip',
    },
    {
      kind: 'select',
      name: 'pattern',
      label: 'Схема раскладки',
      options: [
        { value: 'square', label: 'Квадрат: A = S · L' },
        { value: 'triangular', label: 'Треугольник: A = S · L · 0,866' },
      ],
      visibleIf: (v) => v['mode'] !== 'zone' && v['mode'] !== 'strip',
    },
    {
      kind: 'number',
      name: 'sectorDeg',
      label: 'Сектор полива',
      unit: '°',
      min: 1,
      max: 360,
      visibleIf: (v) => v['mode'] !== 'zone' && v['mode'] !== 'strip',
    },

    // Режим «зона по факту»
    {
      kind: 'number',
      name: 'totalFlowLph',
      label: 'Суммарный расход зоны',
      unit: 'л/ч',
      quantity: 'flowLph',
      min: 0,
      visibleIf: (v) => v['mode'] === 'zone',
    },
    {
      kind: 'number',
      name: 'zoneAreaM2',
      label: 'Поливаемая площадь зоны',
      unit: 'м²',
      quantity: 'area',
      min: 0,
      visibleIf: (v) => v['mode'] === 'zone',
    },
    {
      kind: 'select',
      name: 'emitterClass',
      label: 'Класс оборудования',
      options: EMITTER_OPTIONS,
      visibleIf: (v) => v['mode'] === 'zone',
    },
    {
      kind: 'select',
      name: 'soilType',
      label: 'Почва',
      hint: 'Нужна, чтобы проверить PR на сток',
      options: SOIL_OPTIONS,
      visibleIf: (v) => v['mode'] === 'zone',
    },
    {
      kind: 'number',
      name: 'soilInfiltrationMmH',
      label: 'Скорость впитывания',
      unit: 'мм/ч',
      quantity: 'precipitation',
      min: 0,
      visibleIf: (v) => v['mode'] === 'zone' && v['soilType'] === CUSTOM,
    },

    // Режим «полосовая форсунка»: модель и давление подставляют размер полосы
    // из технического листа, считать его руками не нужно.
    {
      kind: 'select',
      name: 'stripModel',
      label: 'Модель форсунки',
      options: STRIP_MODEL_OPTIONS,
      hint: 'Hunter, полосовые (strip pattern)',
      visibleIf: (v) => v['mode'] === 'strip',
    },
    {
      kind: 'select',
      name: 'stripPressureBar',
      label: 'Давление на форсунке',
      options: STRIP_PRESSURE_OPTIONS,
      hint: `Производитель рекомендует ${fmt(STRIP_RECOMMENDED_PRESSURE_BAR, 1)} бар`,
      visibleIf: (v) => v['mode'] === 'strip',
    },
  ],

  defaults: {
    mode: 'head',
    flowLph: 680,
    spacingM: 9,
    rowSpacingM: null,
    pattern: 'square',
    sectorDeg: 180,
    stripModel: 'SS-530',
    stripPressureBar: String(STRIP_RECOMMENDED_PRESSURE_BAR),
    totalFlowLph: 4200,
    zoneAreaM2: 120,
    emitterClass: 'spray',
    soilType: 'loam',
    soilInfiltrationMmH: 15,
  },

  run: ({ values }) => {
    if (str(values, 'mode', 'head') === 'strip') {
      const model = str(values, 'stripModel', 'SS-530');
      const pressure = Number(str(values, 'stripPressureBar', String(STRIP_RECOMMENDED_PRESSURE_BAR)));
      const row = stripNozzleRow(model, pressure);
      if (!row) {
        throw new Error(`Для ${model} нет строки при ${fmt(pressure, 1)} бар в техническом листе`);
      }

      return stripNozzlePrecipitationRate({
        flowLph: row.flowM3h * 1000,
        widthM: row.widthM,
        lengthM: row.lengthM,
      });
    }

    if (str(values, 'mode', 'head') === 'zone') {
      return zonePrecipitationRate({
        totalFlowLph: num(values, 'totalFlowLph'),
        zoneAreaM2: num(values, 'zoneAreaM2'),
        emitterClass: str(values, 'emitterClass', 'spray') as EmitterClass,
        soilInfiltrationMmH: soilInfiltration(values),
      });
    }

    return headPrecipitationRate({
      flowLph: num(values, 'flowLph'),
      spacingM: num(values, 'spacingM'),
      rowSpacingM: optNum(values, 'rowSpacingM'),
      pattern: str(values, 'pattern', 'square') as LayoutPattern,
      sectorDeg: num(values, 'sectorDeg'),
    });
  },

  outputs: [
    {
      name: 'precipitationRateMmH',
      label: 'Интенсивность дождя',
      unit: 'мм/ч',
      quantity: 'precipitation',
      digits: 1,
    },
    {
      name: 'areaPerHeadM2',
      label: 'Площадь на голову',
      unit: 'м²',
      quantity: 'area',
      digits: 2,
      hideIfNull: true,
    },
    {
      name: 'wettedAreaM2',
      label: 'Площадь полосы',
      unit: 'м²',
      quantity: 'area',
      digits: 2,
      hideIfNull: true,
    },
    {
      name: 'flowPerMetreLphM',
      label: 'Расход на метр полосы',
      unit: 'л/ч·м',
      digits: 1,
      hideIfNull: true,
      hint: 'По нему полосовые форсунки согласуются между собой',
    },
    {
      name: 'infiltrationRatio',
      label: 'PR к впитыванию',
      digits: 2,
      hideIfNull: true,
      hint: 'Больше 1 — вода не успевает впитываться',
      tone: (r) => (Number(r['infiltrationRatio']) > 1 ? 'danger' : 'ok'),
    },
  ],

  explain: [
    'Интенсивность дождя — это слой воды в миллиметрах, который зона подаёт за час. ' +
      'Один миллиметр равен одному литру на квадратный метр, поэтому формула проста: ' +
      'расход в литрах в час делённый на политую площадь в квадратных метрах.',
    'Главное практическое следствие: в одной зоне нельзя мешать классы оборудования. ' +
      'У роторов PR около 10–12 мм/ч, у спреев — 30–40. Поставив их вместе, вы получите ' +
      'либо болото под спреями, либо сушь под роторами — третьего не дано, и «настройкой ' +
      'времени» это не лечится.',
    'Сектор меняет PR: голова на 90° поливает вчетверо меньшую площадь тем же соплом. ' +
      'Поэтому производители делают комплекты согласованных сопел (matched precipitation ' +
      'rate), где сопло на 90° даёт четверть расхода полнокругового. Смешивать сопла ' +
      'из разных серий нельзя.',
    'Полосовая форсунка — отдельный случай: она поливает прямоугольник, а не сектор круга, ' +
      'поэтому площадь берётся прямо из технического листа (ширина × длина полосы), а шаг ' +
      'раскладки в расчёт не входит. С веерными и роторными соплами полосовые в одной зоне ' +
      'не сочетаются — по той же причине, что роторы со спреями. Между собой сочетаются: ' +
      'у семейства одинаковый расход на метр полосы, и угловые, боковые и центральная модели ' +
      'дают согласованную интенсивность.',
    'Если PR выше скорости впитывания почвы, вода уходит стоком: часть нормы не доходит ' +
      'до корней, зато размывает дорожки. Лечится не уменьшением времени, а режимом ' +
      'cycle & soak — расчёт в калькуляторе §5.8.',
  ],

  historyTitle: (values, result) =>
    `${MODE_TITLES[str(values, 'mode', 'head')] ?? 'Голова'}: PR ${fmt(
      Number((result.values as { precipitationRateMmH?: number }).precipitationRateMmH ?? 0),
      1,
    )} мм/ч`,
};

// ── §5.7. Норма полива ───────────────────────────────────────────────────────

export const irrigationRequirementCalculator: CalcDefinition = {
  key: 'irrigation-requirement',

  fields: [
    {
      kind: 'number',
      name: 'et0MmDay',
      label: 'ET0 — эталонная эвапотранспирация',
      unit: 'мм/сут',
      quantity: 'depth',
      min: 0,
      hint: 'Пиковое значение для вашего региона. Локальных метеоданных в приложении нет — уточняйте по месту',
    },
    {
      kind: 'select',
      name: 'plantType',
      label: 'Насаждения',
      options: PLANT_OPTIONS,
    },
    {
      kind: 'number',
      name: 'kc',
      label: 'Kc — коэффициент культуры',
      unit: '',
      min: 0.05,
      max: 2,
      visibleIf: (v) => v['plantType'] === CUSTOM,
    },
    {
      kind: 'number',
      name: 'effectiveRainMm',
      label: 'Эффективные осадки за период',
      unit: 'мм',
      quantity: 'depth',
      optional: true,
      min: 0,
    },
    { kind: 'select', name: 'duPreset', label: 'Равномерность полива', options: DU_PRESETS },
    {
      kind: 'number',
      name: 'du',
      label: 'Замеренный DU',
      unit: '',
      min: 0.2,
      max: 1,
      visibleIf: (v) => v['duPreset'] === CUSTOM,
    },
    {
      kind: 'number',
      name: 'periodDays',
      label: 'Период расчёта',
      unit: 'сут',
      optional: true,
      min: 1,
      hint: 'По умолчанию 1 — суточная норма',
    },
  ],

  defaults: {
    et0MmDay: 5,
    plantType: 'lawn',
    kc: 0.75,
    effectiveRainMm: null,
    duPreset: 'spray',
    du: 0.7,
    periodDays: null,
  },

  run: ({ values }) => {
    const plantKey = str(values, 'plantType', 'lawn');
    const plant = PLANTS.find((p) => p.type === (plantKey as PlantType));
    const kc = plant ? (plant.kcMin + plant.kcMax) / 2 : num(values, 'kc');

    const duPreset = str(values, 'duPreset', 'spray');
    const custom = duPreset === CUSTOM;

    return irrigationRequirement({
      et0MmDay: num(values, 'et0MmDay'),
      kc,
      effectiveRainMm: optNum(values, 'effectiveRainMm'),
      du: custom ? num(values, 'du') : undefined,
      duPreset: custom ? undefined : (duPreset as DuPreset),
      periodDays: optNum(values, 'periodDays'),
    });
  },

  outputs: [
    { name: 'etcMm', label: 'Потребность ETc', unit: 'мм', quantity: 'depth', digits: 1 },
    { name: 'nettoMm', label: 'Норма нетто', unit: 'мм', quantity: 'depth', digits: 1 },
    {
      name: 'bruttoMm',
      label: 'Норма брутто',
      unit: 'мм',
      quantity: 'depth',
      digits: 1,
      hint: 'Её и подаём',
    },
    { name: 'du', label: 'Принятый DU', digits: 2 },
    {
      name: 'scheduleMultiplier',
      label: 'Множитель графика',
      digits: 2,
      hint: '1 / DU',
      tone: (r) => (Number(r['scheduleMultiplier']) > 1.4 ? 'warn' : 'default'),
    },
    {
      name: 'uniformityLossMm',
      label: 'Перерасход из-за неравномерности',
      unit: 'мм',
      quantity: 'depth',
      digits: 1,
      tone: (r) => (Number(r['uniformityLossMm']) > 0 ? 'warn' : 'ok'),
    },
  ],

  explain: [
    'Норма нетто — сколько воды нужно растению: эталонная эвапотранспирация ET0, ' +
      'умноженная на коэффициент культуры Kc, минус то, что дал дождь. Подход ' +
      '«ET0 × Kc» описан в FAO Irrigation and Drainage Paper 56, эталон — трава 0,12 м.',
    'Норма брутто — сколько нужно подать, чтобы хватило даже самой обделённой четверти ' +
      'площади. Она больше нетто ровно во столько раз, во сколько равномерность DU ' +
      'меньше единицы.',
    'Отсюда прямая связь качества раскладки и счёта за воду. При DU 0,5 вы льёте вдвое ' +
      'больше нормы: три четверти участка получают перелив, чтобы последняя четверть ' +
      'получила своё. Отраслевой ориентир приемлемости — DU не ниже 0,70; хуже 0,60 — ' +
      'переделывать раскладку, а не добавлять минуты.',
    'Kc газона выше, чем у кустарников и деревьев, потому что у газона мелкие корни и ' +
      'сплошной испаряющий покров. Держать газон и кустарники в одной зоне — гарантированный ' +
      'перелив для одних и недолив для других.',
  ],

  historyTitle: (values, result) =>
    `ET0 ${fmt(Number(values['et0MmDay'] ?? 0), 1)} → брутто ${fmt(
      Number((result.values as { bruttoMm?: number }).bruttoMm ?? 0),
      1,
    )} мм`,
};

// ── §5.8. Время полива и cycle & soak ────────────────────────────────────────

export const runTimeCalculator: CalcDefinition = {
  key: 'run-time',

  fields: [
    {
      kind: 'number',
      name: 'grossDepthMm',
      label: 'Норма брутто за полив',
      unit: 'мм',
      quantity: 'depth',
      min: 0,
      hint: 'Из калькулятора §5.7 или §5.9',
    },
    {
      kind: 'number',
      name: 'precipitationRateMmH',
      label: 'Интенсивность дождя зоны',
      unit: 'мм/ч',
      quantity: 'precipitation',
      min: 0,
      hint: 'Из калькулятора §5.6',
    },
    { kind: 'select', name: 'soilType', label: 'Почва', options: SOIL_OPTIONS },
    {
      kind: 'number',
      name: 'soilInfiltrationMmH',
      label: 'Скорость впитывания',
      unit: 'мм/ч',
      quantity: 'precipitation',
      min: 0,
      visibleIf: (v) => v['soilType'] === CUSTOM,
    },
    {
      kind: 'number',
      name: 'slopePercent',
      label: 'Уклон участка',
      unit: '%',
      optional: true,
      min: 0,
      hint: 'Поправка применяется при уклоне выше 5 %',
    },
    {
      kind: 'number',
      name: 'slopeReductionPercent',
      label: 'Насколько уменьшить впитывание на склоне',
      unit: '%',
      optional: true,
      min: 0,
      max: 90,
      hint: '25–50 % по §5.8; по умолчанию 25 %',
      visibleIf: (v) => typeof v['slopePercent'] === 'number' && (v['slopePercent'] as number) > 5,
    },
    {
      kind: 'number',
      name: 'soakMinutes',
      label: 'Пауза между циклами',
      unit: 'мин',
      optional: true,
      min: 5,
      hint: '30–60 мин, по умолчанию 45',
    },
  ],

  defaults: {
    grossDepthMm: 8,
    precipitationRateMmH: 35,
    soilType: 'loam',
    soilInfiltrationMmH: 15,
    slopePercent: null,
    slopeReductionPercent: null,
    soakMinutes: null,
  },

  run: ({ values }) => {
    const reduction = optNum(values, 'slopeReductionPercent');
    return runTime({
      grossDepthMm: num(values, 'grossDepthMm'),
      precipitationRateMmH: num(values, 'precipitationRateMmH'),
      soilInfiltrationMmH: soilInfiltration(values),
      slopePercent: optNum(values, 'slopePercent'),
      slopeReduction: reduction === undefined ? undefined : reduction / 100,
      soakMinutes: optNum(values, 'soakMinutes'),
    });
  },

  outputs: [
    { name: 'totalRunMinutes', label: 'Время полива', unit: 'мин', digits: 0 },
    {
      name: 'totalElapsedMinutes',
      label: 'С учётом пауз',
      unit: 'мин',
      digits: 0,
      hint: 'Столько зона занимает в окне полива',
    },
    {
      name: 'effectiveInfiltrationMmH',
      label: 'Впитывание с поправкой',
      unit: 'мм/ч',
      quantity: 'precipitation',
      digits: 1,
      hideIfNull: true,
    },
  ],

  tables: (result): ResultTable[] => {
    const cycles = (result.values as { cycles?: RunCycle[] }).cycles ?? [];
    const needed = Boolean((result.values as { cycleAndSoakRequired?: boolean }).cycleAndSoakRequired);
    if (cycles.length <= 1) return [];

    return [
      {
        title: 'График cycle & soak',
        note: needed
          ? 'Интенсивность выше впитывания — норма подаётся порциями с паузами на впитывание.'
          : undefined,
        columns: ['Цикл', 'Полив, мин', 'Пауза, мин', 'Подано, мм'],
        rows: cycles.map((c) => [
          String(c.index),
          fmt(c.runMinutes, 1),
          c.soakMinutes > 0 ? fmt(c.soakMinutes, 0) : '—',
          fmt(c.depthMm, 2),
        ]),
      },
    ];
  },

  explain: [
    'Время полива — это норма, делённая на интенсивность. Всё остальное в этом ' +
      'калькуляторе про одно: что делать, когда почва не успевает принимать воду.',
    'Если интенсивность выше скорости впитывания, лишнее уходит стоком. Причём стекает ' +
      'не «немного», а вся разница: на суглинке с впитыванием 15 мм/ч спреи с PR 35 мм/ч ' +
      'отдают в почву меньше половины поданного.',
    'Решение — cycle & soak: разбить полив на два-три коротких цикла с паузой 30–60 минут. ' +
      'Суммарное время то же, но каждая порция успевает уйти в почву. Все современные ' +
      'контроллеры это умеют, надо только задать.',
    'На склоне круче 5 % впитывание падает ещё на четверть-половину: вода начинает ' +
      'двигаться вниз раньше, чем вглубь. Там cycle & soak обязателен почти всегда.',
    'И обратное правило: поливать реже и глубже лучше, чем каждый день по чуть-чуть. ' +
      'Ежедневный полив по десять минут держит влагу в верхних сантиметрах и воспитывает ' +
      'поверхностную корневую систему, которая гибнет при первой же пропущенной неделе.',
  ],

  historyTitle: (values, result) =>
    `${fmt(Number(values['grossDepthMm'] ?? 0), 1)} мм при PR ${fmt(
      Number(values['precipitationRateMmH'] ?? 0),
      0,
    )} → ${fmt(Number((result.values as { totalRunMinutes?: number }).totalRunMinutes ?? 0), 0)} мин`,
};

// ── §5.9. Норма за полив по запасу влаги ─────────────────────────────────────

export const soilWaterCalculator: CalcDefinition = {
  key: 'soil-water',

  fields: [
    { kind: 'select', name: 'plantType', label: 'Насаждения', options: PLANT_OPTIONS },
    {
      kind: 'number',
      name: 'rootDepthM',
      label: 'Глубина корневой зоны',
      unit: 'м',
      quantity: 'length',
      min: 0.05,
      max: 3,
      visibleIf: (v) => v['plantType'] === CUSTOM,
    },
    { kind: 'select', name: 'soilType', label: 'Почва', options: SOIL_OPTIONS },
    {
      kind: 'number',
      name: 'awcMmPerM',
      label: 'Доступная влага почвы',
      unit: 'мм/м',
      min: 0,
      visibleIf: (v) => v['soilType'] === CUSTOM,
    },
    {
      kind: 'number',
      name: 'mad',
      label: 'MAD — допустимое истощение',
      unit: 'доля',
      optional: true,
      min: 0.1,
      max: 0.9,
      hint: 'Для декоративного ландшафта обычно 0,5',
    },
    {
      kind: 'number',
      name: 'dailyNetDemandMmDay',
      label: 'Суточная потребность нетто',
      unit: 'мм/сут',
      quantity: 'depth',
      optional: true,
      min: 0,
      hint: 'Нужна, чтобы посчитать интервал между поливами',
    },
    {
      kind: 'number',
      name: 'du',
      label: 'Равномерность DU',
      unit: '',
      optional: true,
      min: 0.2,
      max: 1,
      hint: 'Чтобы сразу получить норму брутто',
    },
    {
      kind: 'number',
      name: 'etcMmDay',
      label: 'Фактическая ETc',
      unit: 'мм/сут',
      quantity: 'depth',
      optional: true,
      min: 0,
      hint: 'Включает поправку MAD по FAO-56: в жару истощать запас нельзя так же глубоко',
    },
  ],

  defaults: {
    plantType: 'lawn',
    rootDepthM: 0.2,
    soilType: 'loam',
    awcMmPerM: 160,
    mad: null,
    dailyNetDemandMmDay: 4,
    du: null,
    etcMmDay: null,
  },

  run: ({ values }) => {
    const plantKey = str(values, 'plantType', 'lawn');
    const plant = PLANTS.find((p) => p.type === (plantKey as PlantType));
    const rootDepth = plant ? (plant.rootDepthMinM + plant.rootDepthMaxM) / 2 : num(values, 'rootDepthM');

    const soilKey = str(values, 'soilType', 'loam');
    const soil = SOILS.find((s) => s.type === (soilKey as SoilType));
    const awc = soil ? (soil.awcMinMmPerM + soil.awcMaxMmPerM) / 2 : num(values, 'awcMmPerM');

    return soilWaterHoldingNorm({
      rootDepthM: rootDepth,
      awcMmPerM: awc,
      mad: optNum(values, 'mad'),
      dailyNetDemandMmDay: optNum(values, 'dailyNetDemandMmDay'),
      du: optNum(values, 'du'),
      etcMmDay: optNum(values, 'etcMmDay'),
    });
  },

  outputs: [
    { name: 'totalAvailableMm', label: 'Запас влаги в корневой зоне', unit: 'мм', quantity: 'depth', digits: 1 },
    { name: 'netDepthMm', label: 'Норма за полив (нетто)', unit: 'мм', quantity: 'depth', digits: 1 },
    {
      name: 'grossDepthMm',
      label: 'Норма за полив (брутто)',
      unit: 'мм',
      quantity: 'depth',
      digits: 1,
      hideIfNull: true,
    },
    { name: 'mad', label: 'Применённый MAD', digits: 2 },
    {
      name: 'intervalDays',
      label: 'Интервал между поливами',
      unit: 'сут',
      digits: 1,
      hideIfNull: true,
    },
  ],

  explain: [
    'Этот расчёт отвечает на вопрос «сколько за раз и как часто», исходя не из ' +
      'потребности растения, а из того, сколько воды почва вообще способна удержать ' +
      'в корневой зоне.',
    'Запас — это глубина корней, умноженная на влагоёмкость почвы. Расходовать его весь ' +
      'нельзя: чем суше почва, тем труднее корням её отбирать. Отсюда MAD — допустимое ' +
      'истощение, для декоративного ландшафта около 50 % доступной влаги.',
    'Интервал получается делением нормы на суточную потребность. Песок держит мало, ' +
      'поэтому поливать приходится часто и понемногу; глина держит много, но принимает ' +
      'медленно — там нужны редкие длинные поливы с cycle & soak.',
    'Поправка FAO-56 на ETc — важная деталь: в жару растение расходует запас быстрее, ' +
      'чем корни успевают его добирать, поэтому допустимое истощение снижается. Правильная ' +
      'реакция на жару — сократить интервал, а не увеличить норму за полив: лишняя вода ' +
      'просто уйдёт ниже корней.',
  ],

  historyTitle: (values, result) =>
    `${str(values, 'plantType', 'lawn')}: ${fmt(
      Number((result.values as { netDepthMm?: number }).netDepthMm ?? 0),
      1,
    )} мм за полив`,
};

// ── §5.10. Водный баланс участка ─────────────────────────────────────────────

const SOURCE_KINDS: Array<{ value: SourceKind; label: string }> = [
  { value: 'borehole', label: 'Скважина' },
  { value: 'well', label: 'Колодец' },
  { value: 'mains', label: 'Водопровод' },
  { value: 'pond', label: 'Открытый водоём' },
  { value: 'tank', label: 'Накопительная ёмкость' },
];

export const waterBalanceCalculator: CalcDefinition = {
  key: 'water-balance',

  fields: [
    {
      kind: 'number',
      name: 'grossDepthMm',
      label: 'Норма брутто за полив',
      unit: 'мм',
      quantity: 'depth',
      min: 0,
    },
    {
      kind: 'number',
      name: 'irrigatedAreaM2',
      label: 'Поливаемая площадь',
      unit: 'м²',
      quantity: 'area',
      min: 0,
    },
    {
      kind: 'number',
      name: 'sourceFlowM3h',
      label: 'Дебит источника',
      unit: 'м³/ч',
      quantity: 'flow',
      min: 0,
      hint: 'Измеренный, а не заявленный при бурении',
    },
    { kind: 'select', name: 'sourceKind', label: 'Тип источника', options: SOURCE_KINDS },
    {
      kind: 'number',
      name: 'windowHours',
      label: 'Окно полива',
      unit: 'ч/сут',
      min: 0.25,
      max: 24,
      hint: 'Обычно ночь: с 3:00 до 7:00 — четыре часа',
    },
    {
      kind: 'number',
      name: 'irrigationsPerDay',
      label: 'Поливов в сутки',
      unit: '',
      optional: true,
      min: 1,
      max: 4,
    },
  ],

  defaults: {
    grossDepthMm: 8,
    irrigatedAreaM2: 600,
    sourceFlowM3h: 2.5,
    sourceKind: 'borehole',
    windowHours: 4,
    irrigationsPerDay: null,
  },

  run: ({ values }) =>
    waterBalance({
      grossDepthMm: num(values, 'grossDepthMm'),
      irrigatedAreaM2: num(values, 'irrigatedAreaM2'),
      sourceFlowM3h: num(values, 'sourceFlowM3h'),
      windowHours: num(values, 'windowHours'),
      irrigationsPerDay: optNum(values, 'irrigationsPerDay'),
      sourceKind: str(values, 'sourceKind', 'borehole') as SourceKind,
    }),

  outputs: [
    { name: 'demandLPerDay', label: 'Потребность', unit: 'л/сут', quantity: 'volume', digits: 0 },
    {
      name: 'availableLPerDay',
      label: 'Доступно с запасом 0,8',
      unit: 'л/сут',
      quantity: 'volume',
      digits: 0,
      tone: (r) => (r['balanceOk'] === true ? 'ok' : 'danger'),
    },
    {
      name: 'deficitLPerDay',
      label: 'Дефицит',
      unit: 'л/сут',
      quantity: 'volume',
      digits: 0,
      tone: (r) => (Number(r['deficitLPerDay']) > 0 ? 'danger' : 'ok'),
    },
    {
      name: 'tankVolumeWithReserveL',
      label: 'Рекомендуемая ёмкость',
      unit: 'л',
      quantity: 'volume',
      digits: 0,
      hint: 'С тем же запасом 0,8',
    },
    { name: 'refillHours', label: 'Время наполнения', unit: 'ч', digits: 1 },
    {
      name: 'requiredWindowHours',
      label: 'Требуемое окно полива',
      unit: 'ч',
      digits: 1,
      tone: (r) => (Number(r['requiredWindowHours']) > 8 ? 'warn' : 'default'),
    },
    {
      name: 'utilisation',
      label: 'Загрузка источника',
      digits: 2,
      tone: (r) => (Number(r['utilisation']) > 0.8 ? 'danger' : 'ok'),
    },
  ],

  tables: (result): ResultTable[] => {
    const suggestions =
      (result.values as { suggestions?: Array<{ title: string; detail: string }> }).suggestions ?? [];
    if (suggestions.length === 0) return [];

    return [
      {
        title: 'Как свести баланс',
        columns: ['Вариант', 'Что это значит'],
        rows: suggestions.map((s) => [s.title, s.detail]),
      },
    ];
  },

  explain: [
    'Водный баланс проверяет самое базовое: хватит ли источника на участок. Считать его ' +
      'нужно до раскладки, а не после — иначе проект придётся переделывать целиком.',
    'Коэффициент 0,8 в доступном объёме не «на всякий случай». Отбор выше 80 % дебита ' +
      'скважины ведёт к срыву подачи, работе насоса всухую и заиливанию фильтра. ' +
      'Скважина при этом деградирует необратимо: восстановить прежний дебит после ' +
      'такой эксплуатации обычно уже нельзя.',
    'Если баланс не сходится, вариантов ровно четыре, и все они перечислены в таблице: ' +
      'буферная ёмкость, более длинное окно полива, перевод части площади на капельный ' +
      'полив или сокращение площади газона. Газон здесь ключевой: он потребляет больше ' +
      'всех остальных насаждений вместе взятых.',
    'Буферная ёмкость — самое частое решение для скважины со слабым дебитом. Она ' +
      'накапливает воду медленно все сутки, а отдаёт быстро в окно полива; насос при ' +
      'этом работает в щадящем режиме.',
  ],

  historyTitle: (values, result) => {
    const ok = (result.values as { balanceOk?: boolean }).balanceOk === true;
    return `${fmt(Number(values['irrigatedAreaM2'] ?? 0), 0)} м² при ${fmt(
      Number(values['sourceFlowM3h'] ?? 0),
      2,
    )} м³/ч — ${ok ? 'баланс сходится' : 'дефицит'}`;
  },
};
