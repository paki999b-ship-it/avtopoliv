import {
  HAZEN_WILLIAMS_C_LABEL,
  VELOCITY_LIMITS,
  flowVelocity,
  fmt,
  frictionLoss,
  minorLosses,
  selectPipeDiameter,
  waterHammer,
} from '@irrigo/core';
import type {
  DeviceKind,
  DeviceLoss,
  HammerMaterial,
  PipeMaterial,
  PipeOption,
  PipeStandard,
} from '@irrigo/core';
import type { CalcDefinition, ResultTable } from '../types.js';
import { itemNum, itemStr, list, num, optNum, str } from '../lib.js';

/** Материалы труб — подписи берутся из движка, чтобы не разойтись с ним. */
const MATERIALS = Object.entries(HAZEN_WILLIAMS_C_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const PIPE_STANDARDS: Array<{ value: PipeStandard; label: string }> = [
  { value: 'PE100 SDR11', label: 'ПЭ100 SDR11 (PN16)' },
  { value: 'PE100 SDR17', label: 'ПЭ100 SDR17 (PN10)' },
  { value: 'PVC PN10', label: 'ПВХ PN10 (SDR21)' },
  { value: 'PVC PN16', label: 'ПВХ PN16 (SDR13,6)' },
];

const ROLES = [
  { value: 'main', label: 'Магистраль' },
  { value: 'lateral', label: 'Ветка зоны' },
  { value: 'suction', label: 'Всасывающая линия (предел 1,2 м/с)' },
];

// ── §5.2. Потери на трение ───────────────────────────────────────────────────

export const frictionCalculator: CalcDefinition = {
  key: 'friction-loss',

  fields: [
    { kind: 'number', name: 'flowM3h', label: 'Расход', unit: 'м³/ч', quantity: 'flow', min: 0 },
    {
      kind: 'number',
      name: 'innerDiameterMm',
      label: 'Внутренний диаметр трубы',
      unit: 'мм',
      quantity: 'diameter',
      min: 0,
      hint: 'Именно внутренний, а не наружный: у ПЭ63 SDR17 это 55,4 мм',
    },
    { kind: 'number', name: 'lengthM', label: 'Длина участка', unit: 'м', quantity: 'length', min: 0 },
    { kind: 'select', name: 'material', label: 'Материал трубы', options: MATERIALS },
    {
      kind: 'number',
      name: 'waterTempC',
      label: 'Температура воды',
      unit: '°C',
      optional: true,
      hint: 'Нужна только для метода Дарси–Вейсбаха. По умолчанию 20 °C',
    },
  ],

  defaults: {
    flowM3h: 13,
    innerDiameterMm: 55.4,
    lengthM: 100,
    material: 'pe_new',
    waterTempC: null,
  },

  run: ({ values }) =>
    frictionLoss({
      flowM3h: num(values, 'flowM3h'),
      innerDiameterMm: num(values, 'innerDiameterMm'),
      lengthM: num(values, 'lengthM'),
      material: str(values, 'material', 'pe_new') as PipeMaterial,
      waterTempC: optNum(values, 'waterTempC'),
    }),

  outputs: [
    {
      name: 'headLossM',
      label: 'Потери напора',
      unit: 'м вод. ст.',
      digits: 2,
      hint: 'Хазен–Вильямс, §5.2',
    },
    { name: 'headLossBar', label: 'То же в барах', unit: 'бар', digits: 3 },
    {
      name: 'velocityMs',
      label: 'Скорость потока',
      unit: 'м/с',
      quantity: 'velocity',
      digits: 2,
      tone: (r) => {
        const v = Number(r['velocityMs']);
        if (v > VELOCITY_LIMITS.hardMax) return 'danger';
        if (v > VELOCITY_LIMITS.targetMax) return 'warn';
        return 'ok';
      },
    },
    {
      name: 'darcyHeadLossM',
      label: 'По Дарси–Вейсбаху',
      unit: 'м вод. ст.',
      digits: 2,
      hint: 'Второй метод для сверки',
    },
    {
      name: 'methodDeltaPercent',
      label: 'Расхождение методов',
      unit: '%',
      digits: 1,
      tone: (r) => (Math.abs(Number(r['methodDeltaPercent'])) > 25 ? 'warn' : 'default'),
    },
    { name: 'reynolds', label: 'Число Рейнольдса', digits: 0 },
  ],

  explain: [
    'Потери на трение — это давление, которое вода «съедает» по дороге. Они не зависят ' +
      'от того, куда труба идёт: важны расход, диаметр и шероховатость.',
    'Диаметр входит в формулу в степени 4,87 — то есть решает почти всё. Увеличение ' +
      'диаметра на один типоразмер обычно снижает потери в два-три раза, тогда как ' +
      'удвоение длины увеличивает их всего вдвое.',
    'Два метода дают разные числа, и это нормально: Хазен–Вильямс — эмпирическая формула, ' +
      'настроенная на воду в обычном диапазоне скоростей, Дарси–Вейсбах — физическая. ' +
      'Расхождение до 10–15 % не значит, что где-то ошибка. Если оно больше — вы, скорее ' +
      'всего, вышли за область применимости Хазена–Вильямса: очень малый диаметр или ' +
      'очень низкая скорость.',
    'Если потери вышли большими: увеличьте диаметр, сократите длину до самой дальней ' +
      'головы (закольцуйте магистраль), или разбейте зону на две с меньшим расходом.',
  ],

  historyTitle: (values) =>
    `Q ${fmt(Number(values['flowM3h'] ?? 0), 2)} м³/ч, d ${fmt(
      Number(values['innerDiameterMm'] ?? 0),
      1,
    )} мм, L ${fmt(Number(values['lengthM'] ?? 0), 0)} м`,
};

// ── §5.3. Скорость потока ────────────────────────────────────────────────────

export const velocityCalculator: CalcDefinition = {
  key: 'velocity',

  fields: [
    { kind: 'number', name: 'flowM3h', label: 'Расход', unit: 'м³/ч', quantity: 'flow', min: 0 },
    {
      kind: 'number',
      name: 'innerDiameterMm',
      label: 'Внутренний диаметр трубы',
      unit: 'мм',
      quantity: 'diameter',
      min: 0,
    },
    { kind: 'select', name: 'role', label: 'Назначение трубы', options: ROLES },
  ],

  defaults: { flowM3h: 5, innerDiameterMm: 40.8, role: 'lateral' },

  run: ({ values }) =>
    flowVelocity({
      flowM3h: num(values, 'flowM3h'),
      innerDiameterMm: num(values, 'innerDiameterMm'),
      role: str(values, 'role', 'lateral') as 'main' | 'lateral' | 'suction',
    }),

  outputs: [
    {
      name: 'velocityMs',
      label: 'Скорость',
      unit: 'м/с',
      quantity: 'velocity',
      digits: 2,
      tone: (r) => {
        const status = String(r['status']);
        if (status === 'over_limit') return 'danger';
        if (status === 'above_target') return 'warn';
        return 'ok';
      },
    },
    { name: 'limitMs', label: 'Предел для этой трубы', unit: 'м/с', quantity: 'velocity', digits: 1 },
  ],

  explain: [
    'Целевой коридор — 1,0–1,5 м/с. Ниже — труба взята с запасом и деньги потрачены зря; ' +
      'выше 2,0 м/с — шум, ускоренный износ и, главное, резко растущий риск гидроудара.',
    'Скорость и гидроудар связаны напрямую: скачок давления пропорционален изменению ' +
      'скорости. Полтора метра в секунду в стальной трубе при резком закрытии дают ' +
      'скачок порядка 18 бар — этого достаточно, чтобы разорвать фитинг.',
    'На всасывающей линии предел жёстче — 1,2 м/с. Там любое лишнее сопротивление ' +
      'приближает насос к кавитации, а кавитация убивает рабочее колесо за сезон.',
    'Скорость выше нормы лечится увеличением диаметра, а не «привыканием»: на трение ' +
      'уходит квадрат скорости, и вы платите за это давлением на каждом поливе.',
  ],

  historyTitle: (values) =>
    `Q ${fmt(Number(values['flowM3h'] ?? 0), 2)} м³/ч в d ${fmt(
      Number(values['innerDiameterMm'] ?? 0),
      1,
    )} мм`,
};

// ── §5.4. Подбор диаметра трубы ──────────────────────────────────────────────

function pipeRow(option: PipeOption): string[] {
  return [
    `${option.standard} Ø${fmt(option.odMm, 0)}`,
    fmt(option.idMm, 1),
    fmt(option.velocityMs, 2),
    fmt(option.headLossM, 2),
    option.withinTarget ? 'в целевом коридоре' : option.withinHardLimit ? 'допустимо' : 'выше предела',
  ];
}

export const pipeSizingCalculator: CalcDefinition = {
  key: 'pipe-sizing',

  fields: [
    { kind: 'number', name: 'flowM3h', label: 'Расход', unit: 'м³/ч', quantity: 'flow', min: 0 },
    { kind: 'select', name: 'standard', label: 'Сортамент', options: PIPE_STANDARDS },
    {
      kind: 'number',
      name: 'targetVelocityMs',
      label: 'Целевая скорость',
      unit: 'м/с',
      quantity: 'velocity',
      optional: true,
      hint: 'По умолчанию 1,5 м/с',
    },
    {
      kind: 'number',
      name: 'lengthM',
      label: 'Длина участка',
      unit: 'м',
      quantity: 'length',
      optional: true,
      hint: 'Нужна, чтобы посчитать потери у каждого варианта',
    },
    { kind: 'select', name: 'role', label: 'Назначение трубы', options: ROLES },
  ],

  defaults: {
    flowM3h: 8,
    standard: 'PE100 SDR17',
    targetVelocityMs: null,
    lengthM: 100,
    role: 'lateral',
  },

  run: ({ values }) =>
    selectPipeDiameter({
      flowM3h: num(values, 'flowM3h'),
      standard: str(values, 'standard', 'PE100 SDR17') as PipeStandard,
      targetVelocityMs: optNum(values, 'targetVelocityMs'),
      lengthM: optNum(values, 'lengthM'),
      role: str(values, 'role', 'lateral') as 'main' | 'lateral' | 'suction',
    }),

  outputs: [
    { name: 'requiredIdMm', label: 'Расчётный внутренний диаметр', unit: 'мм', quantity: 'diameter', digits: 1 },
  ],

  tables: (result): ResultTable[] => {
    const values = result.values as {
      options?: PipeOption[];
      recommended?: PipeOption | null;
    };
    const options = values.options ?? [];
    if (options.length === 0) return [];

    const recommendedIndex = options.findIndex((o) => o.key === values.recommended?.key);

    return [
      {
        title: 'Варианты сортамента',
        note: 'Подсвечен рекомендованный: первый, у которого скорость не выходит за предел.',
        columns: ['Труба', 'Внутр. Ø, мм', 'Скорость, м/с', 'Потери, м', 'Оценка'],
        rows: options.map(pipeRow),
        highlightRow: recommendedIndex >= 0 ? recommendedIndex : undefined,
      },
    ];
  },

  explain: [
    'Диаметр подбирают по скорости, а не «на глаз по расходу». Целевой коридор ' +
      '1,0–1,5 м/с даёт разумный компромисс между ценой трубы и потерями давления.',
    'Смотрите не только на рекомендованный вариант, но и на соседние. Часто следующий ' +
      'типоразмер вверх стоит на 20 % дороже, а потери снижает вдвое — на длинной ' +
      'магистрали это окупается сразу, потому что позволяет взять насос меньше.',
    'Внутренний диаметр у одного и того же наружного зависит от SDR: ПЭ63 SDR11 внутри ' +
      '51,4 мм, а SDR17 — 55,4 мм. Разница в потерях между ними — около полутора раз.',
    'Если ни один вариант не проходит, зона слишком большая. Делите её, а не ставьте ' +
      'трубу на пределе: труба на пределе означает, что запаса на будущее нет вообще.',
  ],

  historyTitle: (values, result) => {
    const recommended = (result.values as { recommended?: PipeOption | null }).recommended;
    return recommended
      ? `${fmt(Number(values['flowM3h'] ?? 0), 2)} м³/ч → ${recommended.standard} Ø${fmt(
          recommended.odMm,
          0,
        )}`
      : `${fmt(Number(values['flowM3h'] ?? 0), 2)} м³/ч — вариант не найден`;
  },
};

// ── §5.5. Местные потери ─────────────────────────────────────────────────────

const DEVICE_KINDS: Array<{ value: DeviceKind; label: string }> = [
  { value: 'valve', label: 'Клапан' },
  { value: 'filter', label: 'Фильтр' },
  { value: 'regulator', label: 'Редуктор давления' },
  { value: 'meter', label: 'Счётчик' },
  { value: 'check_valve', label: 'Обратный клапан' },
  { value: 'other', label: 'Другое' },
];

export const minorLossesCalculator: CalcDefinition = {
  key: 'minor-losses',

  fields: [
    {
      kind: 'number',
      name: 'frictionLossM',
      label: 'Потери на трение по трассе',
      unit: 'м вод. ст.',
      min: 0,
      hint: 'Из калькулятора §5.2',
    },
    {
      kind: 'number',
      name: 'fittingsSharePercent',
      label: 'Доля потерь на фитингах',
      unit: '%',
      optional: true,
      min: 0,
      max: 100,
      hint: 'При обычной раскладке 10–20 %. По умолчанию 15 %',
    },
    {
      kind: 'list',
      name: 'devices',
      label: 'Устройства узла',
      addLabel: 'Добавить устройство',
      minItems: 0,
      newItem: () => ({ name: '', kind: 'valve', lossBar: 0.2 }),
      fields: [
        { kind: 'text', name: 'name', label: 'Название', placeholder: 'Клапан 1"' },
        { kind: 'select', name: 'kind', label: 'Тип', options: DEVICE_KINDS },
        {
          kind: 'number',
          name: 'lossBar',
          label: 'Потери по паспорту',
          unit: 'бар',
          quantity: 'pressure',
          min: 0,
        },
      ],
    },
  ],

  defaults: {
    frictionLossM: 4,
    fittingsSharePercent: null,
    devices: [
      { name: 'Клапан 1"', kind: 'valve', lossBar: 0.2 },
      { name: 'Дисковый фильтр 120 mesh', kind: 'filter', lossBar: 0.25 },
    ],
  },

  run: ({ values }) => {
    const sharePercent = optNum(values, 'fittingsSharePercent');
    const devices: DeviceLoss[] = list(values, 'devices').map((item, index) => ({
      name: itemStr(item, 'name', `Устройство ${index + 1}`),
      kind: itemStr(item, 'kind', 'other') as DeviceKind,
      lossBar: itemNum(item, 'lossBar', 'Потери по паспорту'),
    }));

    return minorLosses({
      frictionLossM: num(values, 'frictionLossM'),
      fittingsShare: sharePercent === undefined ? undefined : sharePercent / 100,
      devices,
    });
  },

  outputs: [
    { name: 'fittingsLossM', label: 'Фитинги и повороты', unit: 'м вод. ст.', digits: 2 },
    { name: 'devicesLossM', label: 'Устройства узла', unit: 'м вод. ст.', digits: 2 },
    { name: 'totalMinorLossM', label: 'Все местные потери', unit: 'м вод. ст.', digits: 2 },
    { name: 'grandTotalM', label: 'Итого с трением', unit: 'м вод. ст.', digits: 2 },
    { name: 'totalMinorLossBar', label: 'Местные потери в барах', unit: 'бар', digits: 3 },
  ],

  tables: (result): ResultTable[] => {
    const breakdown =
      (result.values as { breakdown?: Array<{ name: string; lossM: number; lossBar: number }> })
        .breakdown ?? [];
    if (breakdown.length === 0) return [];

    return [
      {
        title: 'Разбивка по устройствам',
        columns: ['Устройство', 'Потери, бар', 'Потери, м вод. ст.'],
        rows: breakdown.map((b) => [b.name, fmt(b.lossBar, 3), fmt(b.lossM, 2)]),
      },
    ];
  },

  explain: [
    'Местные потери — это всё, что не труба: повороты, тройники, переходы, а также ' +
      'клапаны, фильтры, редукторы и счётчики. Первое считают долей от потерь на трение, ' +
      'второе — по паспортным данным конкретного изделия.',
    'Паспортные потери берите на свой расход, а не «типовые». У клапана 1" при 3 м³/ч ' +
      'потери около 0,2 бара, а при 6 м³/ч — уже под 0,6: график потерь нелинейный.',
    'Фильтр — отдельная история: паспортное значение приводится для чистого фильтра. ' +
      'К концу цикла загрязнения потери вырастают в два-три раза, и именно на грязном ' +
      'фильтре зона начинает «недоливать». Считайте с запасом на загрязнение.',
    'Сумма всех потерь не должна съедать больше 20–25 % рабочего давления дождевателя ' +
      '(§5.16). Если съедает — увеличивайте диаметр или делите зону.',
  ],

  historyTitle: (values, result) =>
    `${list(values, 'devices').length} устройств, итого ${fmt(
      Number((result.values as { grandTotalM?: number }).grandTotalM ?? 0),
      2,
    )} м`,
};

// ── §5.13. Гидроудар ─────────────────────────────────────────────────────────

const HAMMER_MATERIALS: Array<{ value: HammerMaterial; label: string }> = [
  { value: 'pe', label: 'Полиэтилен (волна 300–400 м/с)' },
  { value: 'pvc', label: 'ПВХ' },
  { value: 'steel', label: 'Сталь (волна 1000–1200 м/с)' },
];

export const waterHammerCalculator: CalcDefinition = {
  key: 'water-hammer',

  fields: [
    {
      kind: 'number',
      name: 'velocityChangeMs',
      label: 'Изменение скорости',
      unit: 'м/с',
      quantity: 'velocity',
      min: 0,
      hint: 'При полном закрытии — это вся рабочая скорость потока',
    },
    { kind: 'select', name: 'material', label: 'Материал трубопровода', options: HAMMER_MATERIALS },
    {
      kind: 'number',
      name: 'lengthM',
      label: 'Длина трубопровода',
      unit: 'м',
      quantity: 'length',
      optional: true,
      hint: 'Нужна, чтобы определить, быстрое ли закрытие',
    },
    {
      kind: 'number',
      name: 'closingTimeS',
      label: 'Время закрытия клапана',
      unit: 'с',
      optional: true,
      min: 0,
    },
    {
      kind: 'number',
      name: 'workingPressureBar',
      label: 'Рабочее давление в системе',
      unit: 'бар',
      quantity: 'pressure',
      optional: true,
      min: 0,
    },
  ],

  defaults: {
    velocityChangeMs: 1.5,
    material: 'pe',
    lengthM: 120,
    closingTimeS: 1,
    workingPressureBar: 3,
  },

  run: ({ values }) =>
    waterHammer({
      velocityChangeMs: num(values, 'velocityChangeMs'),
      material: str(values, 'material', 'pe') as HammerMaterial,
      lengthM: optNum(values, 'lengthM'),
      closingTimeS: optNum(values, 'closingTimeS'),
      workingPressureBar: optNum(values, 'workingPressureBar'),
    }),

  outputs: [
    {
      name: 'surgeBar',
      label: 'Скачок давления',
      unit: 'бар',
      quantity: 'pressure',
      digits: 1,
      tone: (r) => (Number(r['surgeBar']) > 6 ? 'danger' : Number(r['surgeBar']) > 3 ? 'warn' : 'ok'),
    },
    { name: 'surgeBarMin', label: 'Нижняя оценка', unit: 'бар', quantity: 'pressure', digits: 1 },
    { name: 'surgeBarMax', label: 'Верхняя оценка', unit: 'бар', quantity: 'pressure', digits: 1 },
    { name: 'surgeM', label: 'То же в метрах столба', unit: 'м', digits: 0 },
    {
      name: 'peakPressureBar',
      label: 'Пик с учётом рабочего',
      unit: 'бар',
      quantity: 'pressure',
      digits: 1,
      hideIfNull: true,
      tone: (r) => (Number(r['peakPressureBar']) > 10 ? 'danger' : 'warn'),
    },
    {
      name: 'phaseS',
      label: 'Фаза гидроудара',
      unit: 'с',
      digits: 2,
      hideIfNull: true,
      hint: 'Закрытие быстрее фазы — удар полный',
    },
  ],

  explain: [
    'Гидроудар — это цена за резкую остановку потока. Формула Жуковского прямая: ' +
      'скачок давления равен плотности воды, умноженной на скорость волны и на изменение ' +
      'скорости потока. Ни длина, ни диаметр в неё не входят.',
    'Скорость волны решает всё. В стали она около 1000–1200 м/с, в полиэтилене — ' +
      '300–400 м/с: пластик частично гасит удар за счёт упругости стенки. Полтора метра ' +
      'в секунду в стали дают около 18 бар, в ПЭ — около 5.',
    'Закрытие считается быстрым, если оно короче фазы 2L/c — времени, за которое волна ' +
      'успевает добежать до источника и вернуться. При медленном закрытии удар получается ' +
      'частичным и пропорционально меньшим.',
    'Что делать: держать скорость в пределах 1,5 м/с, ставить клапаны с регулировкой ' +
      'скорости закрытия, не открывать систему рывком после зимы, а при длинных ' +
      'магистралях — предусмотреть гаситель или воздушный клапан.',
  ],

  historyTitle: (values, result) =>
    `Δv ${fmt(Number(values['velocityChangeMs'] ?? 0), 2)} м/с → ${fmt(
      Number((result.values as { surgeBar?: number }).surgeBar ?? 0),
      1,
    )} бар`,
};
