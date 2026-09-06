import { blowoutPlan, fmt, zoneCheck } from '@irrigo/core';
import type {
  BlowoutPipeMaterial,
  BlowoutZone,
  BlowoutZonePlan,
  EmitterClass,
  PipeMaterial,
  ZoneHead,
} from '@irrigo/core';
import type { CalcDefinition, ResultTable } from '../types.js';
import { itemNum, itemStr, list, num, optNum, str } from '../lib.js';

/**
 * §5.15 «Продувка на зиму» и §5.16 «Проверка зоны».
 *
 * Оба калькулятора работают со списками (зоны, головы), поэтому используют
 * поля-списки: набор строк задаёт пользователь, движок получает массив.
 */

const EMITTER_OPTIONS: Array<{ value: EmitterClass; label: string }> = [
  { value: 'rotor', label: 'Роторы' },
  { value: 'spray', label: 'Спреи' },
  { value: 'rotary_nozzle', label: 'Роторные сопла' },
  { value: 'drip', label: 'Капельный полив' },
  { value: 'bubbler', label: 'Баблеры' },
  { value: 'micro_spray', label: 'Микродождевание' },
];

// ── §5.15. Продувка на зиму ──────────────────────────────────────────────────

const BLOWOUT_MATERIALS: Array<{ value: BlowoutPipeMaterial; label: string }> = [
  { value: 'pe', label: 'Полиэтилен — до ~3,5 бар' },
  { value: 'pvc', label: 'ПВХ — до ~5,5 бар' },
  { value: 'unknown', label: 'Не знаю — держаться нижней границы' },
];

export const blowoutCalculator: CalcDefinition = {
  key: 'blowout',

  fields: [
    { kind: 'select', name: 'pipeMaterial', label: 'Материал трубопровода', options: BLOWOUT_MATERIALS },
    {
      kind: 'number',
      name: 'passMinutes',
      label: 'Длительность одного прохода',
      unit: 'мин',
      optional: true,
      min: 0.5,
      max: 5,
      hint: '1–2 мин на зону. По умолчанию 1,5',
    },
    {
      kind: 'number',
      name: 'passes',
      label: 'Число проходов',
      unit: '',
      optional: true,
      min: 1,
      max: 5,
      hint: 'По умолчанию 2',
    },
    {
      kind: 'list',
      name: 'zones',
      label: 'Зоны системы',
      addLabel: 'Добавить зону',
      minItems: 1,
      newItem: () => ({ name: '', flowM3h: 2, emitterClass: 'rotor', distanceM: 20 }),
      fields: [
        { kind: 'text', name: 'name', label: 'Название', placeholder: 'Зона 1 — газон' },
        { kind: 'number', name: 'flowM3h', label: 'Расход', unit: 'м³/ч', quantity: 'flow', min: 0 },
        { kind: 'select', name: 'emitterClass', label: 'Оборудование', options: EMITTER_OPTIONS },
        {
          kind: 'number',
          name: 'distanceM',
          label: 'Расстояние от точки продувки',
          unit: 'м',
          quantity: 'length',
          min: 0,
        },
      ],
    },
  ],

  defaults: {
    pipeMaterial: 'pe',
    passMinutes: null,
    passes: null,
    zones: [
      { name: 'Зона 1 — газон, роторы', flowM3h: 2.4, emitterClass: 'rotor', distanceM: 45 },
      { name: 'Зона 2 — газон, спреи', flowM3h: 1.8, emitterClass: 'spray', distanceM: 30 },
      { name: 'Зона 3 — цветник, капля', flowM3h: 0.4, emitterClass: 'drip', distanceM: 15 },
    ],
  },

  run: ({ values }) => {
    const zones: BlowoutZone[] = list(values, 'zones').map((item, index) => ({
      name: itemStr(item, 'name', `Зона ${index + 1}`),
      flowM3h: itemNum(item, 'flowM3h', 'Расход'),
      emitterClass: itemStr(item, 'emitterClass', 'rotor') as EmitterClass,
      distanceM: itemNum(item, 'distanceM', 'Расстояние от точки продувки'),
    }));

    return blowoutPlan({
      zones,
      pipeMaterial: str(values, 'pipeMaterial', 'unknown') as BlowoutPipeMaterial,
      passMinutes: optNum(values, 'passMinutes'),
      passes: optNum(values, 'passes'),
    });
  },

  outputs: [
    {
      name: 'requiredCfm',
      label: 'Производительность компрессора',
      unit: 'CFM',
      digits: 1,
      hint: 'По самой расходной зоне',
    },
    { name: 'requiredM3Min', label: 'То же в метрике', unit: 'м³/мин', digits: 2 },
    { name: 'requiredLMin', label: 'То же в л/мин', unit: 'л/мин', digits: 0 },
    {
      name: 'maxPressureBar',
      label: 'Предельное давление',
      unit: 'бар',
      quantity: 'pressure',
      digits: 1,
      tone: () => 'warn',
    },
    { name: 'totalMinutes', label: 'Вся продувка займёт', unit: 'мин', digits: 0 },
  ],

  tables: (result): ResultTable[] => {
    const plan = (result.values as { plan?: BlowoutZonePlan[] }).plan ?? [];
    if (plan.length === 0) return [];

    return [
      {
        title: 'План обхода',
        note: 'Порядок — от самой дальней зоны к ближней: так вытесняемая вода уходит через ' +
          'уже продутые участки, а не заливает их заново.',
        columns: ['№', 'Зона', 'Предел, бар', 'Проходов', 'Мин/проход', 'Примечание'],
        rows: plan.map((z) => [
          String(z.order),
          z.name,
          fmt(z.maxPressureBar, 1),
          String(z.passes),
          fmt(z.passMinutes, 1),
          z.note,
        ]),
      },
    ];
  },

  explain: [
    'Компрессор подбирают по самой расходной зоне, а не по средней: если он не продавит ' +
      'её, в ней останется вода, и разорвёт именно там.',
    'Давление — главное ограничение, и оно жёстче, чем кажется. Полиэтилен держит при ' +
      'продувке примерно до 3,5 бар, ПВХ — до 5,5. Спреи и капельные зоны продувают по ' +
      'нижней границе. «На всякий случай побольше» выбивает уплотнения и мембраны ' +
      'клапанов — это типовая ошибка §11 п.10.',
    'Продувают порциями по одной-две минуты в несколько проходов. Гонять воздух через ' +
      'ротор дольше нужного нельзя: подшипники в нём смазываются водой, и на сухом ' +
      'воздухе они перегреваются за считанные минуты.',
    'Техника безопасности не обсуждается: голову может выбить из грунта воздухом, ' +
      'поэтому защита глаз обязательна, а стоять над работающей головой нельзя. ' +
      'Капельные зоны часто проще слить самотёком через концевые заглушки, чем продувать.',
  ],

  historyTitle: (values, result) =>
    `${list(values, 'zones').length} зон → компрессор ${fmt(
      Number((result.values as { requiredCfm?: number }).requiredCfm ?? 0),
      1,
    )} CFM`,
};

// ── §5.16. Сводная проверка зоны ─────────────────────────────────────────────

const PIPE_MATERIALS = [
  { value: 'pe_new', label: 'ПНД/ПВХ новые (C = 150)' },
  { value: 'pe_used', label: 'ПНД бывшие в работе (C = 140)' },
  { value: 'steel_new', label: 'Сталь новая (C = 120)' },
  { value: 'steel_old', label: 'Сталь старая (C = 90–100)' },
];

export const zoneCheckCalculator: CalcDefinition = {
  key: 'zone-check',

  fields: [
    { kind: 'text', name: 'zoneName', label: 'Название зоны', placeholder: 'Зона 1 — газон перед домом' },
    {
      kind: 'number',
      name: 'zoneAreaM2',
      label: 'Поливаемая площадь зоны',
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
    },
    {
      kind: 'number',
      name: 'inletPressureBar',
      label: 'Давление на входе в зону',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
    },
    {
      kind: 'number',
      name: 'requiredHeadPressureBar',
      label: 'Рабочее давление дождевателя',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
      hint: 'Из техкарты сопла: у роторов обычно 2,5–3,5 бар, у спреев 2,1',
    },
    {
      kind: 'number',
      name: 'pipeInnerDiameterMm',
      label: 'Внутренний диаметр трубы зоны',
      unit: 'мм',
      quantity: 'diameter',
      min: 0,
    },
    {
      kind: 'number',
      name: 'pipeLengthM',
      label: 'Длина до самой дальней головы',
      unit: 'м',
      quantity: 'length',
      min: 0,
    },
    { kind: 'select', name: 'pipeMaterial', label: 'Материал трубы', options: PIPE_MATERIALS },
    {
      kind: 'number',
      name: 'elevationGainM',
      label: 'Превышение самой высокой головы',
      unit: 'м',
      quantity: 'length',
      optional: true,
      hint: 'Каждые 10 м высоты — минус 1 бар',
    },
    {
      kind: 'number',
      name: 'soilInfiltrationMmH',
      label: 'Скорость впитывания почвы',
      unit: 'мм/ч',
      quantity: 'precipitation',
      optional: true,
      min: 0,
    },
    {
      kind: 'number',
      name: 'cableLengthM',
      label: 'Длина клапанного кабеля',
      unit: 'м',
      quantity: 'length',
      optional: true,
      min: 0,
    },
    {
      kind: 'number',
      name: 'cableCrossSectionMm2',
      label: 'Сечение жилы',
      unit: 'мм²',
      optional: true,
      min: 0,
    },
    {
      kind: 'list',
      name: 'heads',
      label: 'Головы зоны',
      addLabel: 'Добавить головы',
      minItems: 1,
      newItem: () => ({ name: '', emitterClass: 'rotor', flowLph: 600, sectorDeg: 180, count: 1 }),
      fields: [
        { kind: 'text', name: 'name', label: 'Обозначение', placeholder: 'Ротор PGP, сопло 3.0' },
        { kind: 'select', name: 'emitterClass', label: 'Класс', options: EMITTER_OPTIONS },
        {
          kind: 'number',
          name: 'flowLph',
          label: 'Расход одной головы',
          unit: 'л/ч',
          quantity: 'flowLph',
          min: 0,
        },
        { kind: 'number', name: 'sectorDeg', label: 'Сектор', unit: '°', min: 1, max: 360 },
        { kind: 'number', name: 'count', label: 'Количество', unit: 'шт', min: 1 },
      ],
    },
  ],

  defaults: {
    zoneName: 'Зона 1',
    zoneAreaM2: 180,
    sourceFlowM3h: 3.5,
    inletPressureBar: 3.5,
    requiredHeadPressureBar: 2.8,
    pipeInnerDiameterMm: 40.8,
    pipeLengthM: 55,
    pipeMaterial: 'pe_new',
    elevationGainM: 2,
    soilInfiltrationMmH: 15,
    cableLengthM: 90,
    cableCrossSectionMm2: 1,
    heads: [
      { name: 'Ротор PGP, сопло 3.0, 180°', emitterClass: 'rotor', flowLph: 640, sectorDeg: 180, count: 4 },
    ],
  },

  run: ({ values }) => {
    // Строка списка описывает группу одинаковых голов — движку они нужны
    // поштучно, поэтому строка разворачивается по количеству.
    const heads: ZoneHead[] = [];
    list(values, 'heads').forEach((item, index) => {
      const count = itemNum(item, 'count', 'Количество');
      const head: Omit<ZoneHead, 'name'> & { name: string } = {
        name: itemStr(item, 'name', `Голова ${index + 1}`),
        emitterClass: itemStr(item, 'emitterClass', 'rotor') as EmitterClass,
        flowLph: itemNum(item, 'flowLph', 'Расход одной головы'),
        sectorDeg: itemNum(item, 'sectorDeg', 'Сектор'),
      };
      for (let i = 0; i < Math.max(1, Math.round(count)); i += 1) heads.push({ ...head });
    });

    return zoneCheck({
      zoneName: str(values, 'zoneName', 'Зона'),
      heads,
      zoneAreaM2: num(values, 'zoneAreaM2'),
      sourceFlowM3h: num(values, 'sourceFlowM3h'),
      inletPressureBar: num(values, 'inletPressureBar'),
      requiredHeadPressureBar: num(values, 'requiredHeadPressureBar'),
      pipeInnerDiameterMm: num(values, 'pipeInnerDiameterMm'),
      pipeLengthM: num(values, 'pipeLengthM'),
      pipeMaterial: str(values, 'pipeMaterial', 'pe_new') as PipeMaterial,
      elevationGainM: optNum(values, 'elevationGainM'),
      soilInfiltrationMmH: optNum(values, 'soilInfiltrationMmH'),
      cableLengthM: optNum(values, 'cableLengthM'),
      cableCrossSectionMm2: optNum(values, 'cableCrossSectionMm2'),
    });
  },

  outputs: [
    { name: 'headCount', label: 'Голов в зоне', unit: 'шт', digits: 0 },
    { name: 'zoneFlowM3h', label: 'Расход зоны', unit: 'м³/ч', quantity: 'flow', digits: 2 },
    {
      name: 'sourceUtilisation',
      label: 'Доля от дебита источника',
      digits: 2,
      tone: (r) => (Number(r['sourceUtilisation']) > 0.8 ? 'danger' : 'ok'),
    },
    {
      name: 'precipitationRateMmH',
      label: 'Интенсивность дождя',
      unit: 'мм/ч',
      quantity: 'precipitation',
      digits: 1,
    },
    {
      name: 'velocityMs',
      label: 'Скорость в трубе',
      unit: 'м/с',
      quantity: 'velocity',
      digits: 2,
      tone: (r) => (Number(r['velocityMs']) > 2 ? 'danger' : Number(r['velocityMs']) > 1.5 ? 'warn' : 'ok'),
    },
    { name: 'totalLossM', label: 'Суммарные потери', unit: 'м вод. ст.', digits: 2 },
    {
      name: 'lossShareOfWorkingPressure',
      label: 'Потери от рабочего давления',
      digits: 2,
      tone: (r) => (Number(r['lossShareOfWorkingPressure']) > 0.25 ? 'danger' : Number(r['lossShareOfWorkingPressure']) > 0.2 ? 'warn' : 'ok'),
    },
    {
      name: 'pressureAtFarthestHeadBar',
      label: 'Давление у дальней головы',
      unit: 'бар',
      quantity: 'pressure',
      digits: 2,
      tone: (r) => (r['passed'] === true ? 'ok' : 'warn'),
    },
    {
      name: 'cableDropV',
      label: 'Падение на кабеле',
      unit: 'В',
      digits: 2,
      hideIfNull: true,
      tone: (r) => (Number(r['cableDropV']) > 2.4 ? 'danger' : 'ok'),
    },
  ],

  tables: (result): ResultTable[] => {
    const issues =
      (result.values as {
        issues?: Array<{ severity: string; what: string; why: string; fix: string }>;
      }).issues ?? [];

    if (issues.length === 0) {
      return [
        {
          title: 'Замечаний нет',
          columns: ['Проверка', 'Результат'],
          rows: [['Все проверки §5.16', 'зона проходит']],
        },
      ];
    }

    return [
      {
        title: `Замечания: ${issues.length}`,
        note: 'Каждое — «что не так → почему → как исправить». Красные исправлять обязательно.',
        columns: ['Что не так', 'Почему', 'Как исправить'],
        rows: issues.map((i) => [i.what, i.why, i.fix]),
      },
    ];
  },

  explain: [
    'Это сводная проверка: она разом прогоняет зону по всем ограничениям §5.16 — расход ' +
      'против дебита, потери против рабочего давления, давление у дальней и самой высокой ' +
      'головы, скорость в трубе, однородность класса оборудования, интенсивность против ' +
      'впитывания и падение напряжения на кабеле.',
    'Проверять зону нужно целиком, а не по частям. Отдельные величины могут выглядеть ' +
      'приемлемо, а вместе не сходиться: скорость 1,8 м/с сама по себе допустима, но на ' +
      'длинной ветке она даёт потери, съедающие треть рабочего давления.',
    'Правило «зона не больше 80 % дебита» — жёсткое. Оставшиеся 20 % не запас на будущее, ' +
      'а защита источника: скважина, работающая на пределе, заиливается и теряет дебит ' +
      'необратимо.',
    'Смешанные классы оборудования в одной зоне — самая частая и самая дорогая ошибка. ' +
      'Роторы и спреи отличаются по интенсивности втрое, и никакой настройкой времени ' +
      'это не выравнивается.',
    'Если зона не проходит: сначала попробуйте увеличить диаметр трубы, затем разделить ' +
      'зону, и только потом — менять оборудование. Делить зону почти всегда дешевле, ' +
      'чем перекладывать магистраль.',
  ],

  historyTitle: (values, result) => {
    const v = result.values as { passed?: boolean; zoneFlowM3h?: number; issues?: unknown[] };
    const issues = Array.isArray(v.issues) ? v.issues.length : 0;
    return `${str(values, 'zoneName', 'Зона')}: ${fmt(Number(v.zoneFlowM3h ?? 0), 2)} м³/ч, ${
      v.passed ? 'без замечаний' : `замечаний ${issues}`
    }`;
  },
};
