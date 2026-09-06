import { VALVE_CABLE, fmt, valveCableDrop } from '@irrigo/core';
import type { CalcDefinition, ResultTable } from '../types.js';
import { num, optNum, str } from '../lib.js';

/**
 * §5.12. Падение напряжения на клапанном кабеле 24 В AC.
 *
 * Второй режим — общий (нулевой) провод по сумме токов одновременно открытых
 * клапанов и подбор трансформатора с запасом 30 %. Оба режима считает движок:
 * общий провод — это тот же расчёт с суммарным током.
 */

const SECTIONS = [
  { value: '0.5', label: '0,5 мм²' },
  { value: '0.75', label: '0,75 мм²' },
  { value: '1', label: '1,0 мм²' },
  { value: '1.5', label: '1,5 мм²' },
  { value: '2.5', label: '2,5 мм²' },
];

const CURRENT_MODES = [
  {
    value: 'inrush',
    label: `Пусковой ток ${fmt(VALVE_CABLE.inrushCurrentA.max, 2)} А (считать по нему)`,
  },
  { value: 'holding', label: `Ток удержания ${fmt(VALVE_CABLE.holdingCurrentA.max, 2)} А` },
  { value: 'custom', label: 'Свой ток из паспорта соленоида' },
];

function currentOf(values: Record<string, unknown>): number {
  const mode = String(values['currentMode'] ?? 'inrush');
  if (mode === 'holding') return VALVE_CABLE.holdingCurrentA.max;
  if (mode === 'custom') {
    const raw = values['currentA'];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error('Укажите ток соленоида.');
    }
    return raw;
  }
  return VALVE_CABLE.inrushCurrentA.max;
}

export const valveCableCalculator: CalcDefinition = {
  key: 'valve-cable',

  fields: [
    {
      kind: 'select',
      name: 'mode',
      label: 'Что считаем',
      options: [
        { value: 'valve', label: 'Жила до одного клапана' },
        { value: 'common', label: 'Общий (нулевой) провод и трансформатор' },
      ],
    },
    {
      kind: 'number',
      name: 'lengthM',
      label: 'Длина трассы в одну сторону',
      unit: 'м',
      quantity: 'length',
      min: 0,
      hint: 'Формула уже учитывает, что ток идёт туда и обратно',
    },
    { kind: 'select', name: 'crossSection', label: 'Сечение жилы', options: SECTIONS },
    {
      kind: 'select',
      name: 'currentMode',
      label: 'Ток соленоида',
      options: CURRENT_MODES,
      visibleIf: (v) => v['mode'] !== 'common',
    },
    {
      kind: 'number',
      name: 'currentA',
      label: 'Ток соленоида',
      unit: 'А',
      min: 0.01,
      visibleIf: (v) => v['mode'] !== 'common' && v['currentMode'] === 'custom',
    },
    {
      kind: 'number',
      name: 'simultaneousValves',
      label: 'Клапанов открыто одновременно',
      unit: 'шт',
      min: 1,
      max: 12,
      hint: 'Обычно один зонный плюс мастер-клапан',
      visibleIf: (v) => v['mode'] === 'common',
    },
    {
      kind: 'number',
      name: 'supplyVoltageV',
      label: 'Напряжение источника',
      unit: 'В',
      optional: true,
      min: 1,
      hint: 'По умолчанию 24 В',
    },
  ],

  defaults: {
    mode: 'valve',
    lengthM: 120,
    crossSection: '1',
    currentMode: 'inrush',
    currentA: 0.35,
    simultaneousValves: 2,
    supplyVoltageV: null,
  },

  run: ({ values }) => {
    const common = str(values, 'mode', 'valve') === 'common';
    const perValve = common ? VALVE_CABLE.inrushCurrentA.max : currentOf(values);
    const count = common ? num(values, 'simultaneousValves') : 1;

    return valveCableDrop({
      lengthM: num(values, 'lengthM'),
      crossSectionMm2: Number(str(values, 'crossSection', '1')),
      currentA: perValve * count,
      supplyVoltageV: optNum(values, 'supplyVoltageV'),
    });
  },

  outputs: [
    {
      name: 'dropV',
      label: 'Падение напряжения',
      unit: 'В',
      digits: 2,
      tone: (r) => (r['acceptable'] === true ? 'ok' : 'danger'),
    },
    { name: 'dropPercent', label: 'Доля от питания', unit: '%', digits: 1 },
    { name: 'voltageAtValveV', label: 'Напряжение на клапане', unit: 'В', digits: 1 },
    {
      name: 'maxLengthM',
      label: 'Предельная длина при этом сечении',
      unit: 'м',
      quantity: 'length',
      digits: 0,
    },
    {
      name: 'requiredCrossSectionMm2',
      label: 'Минимальное сечение для этой длины',
      unit: 'мм²',
      digits: 2,
    },
  ],

  tables: (_result, values): ResultTable[] => {
    if (str(values, 'mode', 'valve') !== 'common') return [];

    const count = typeof values['simultaneousValves'] === 'number' ? values['simultaneousValves'] : 1;
    const load = VALVE_CABLE.inrushCurrentA.max * count;
    const voltage = typeof values['supplyVoltageV'] === 'number'
      ? values['supplyVoltageV']
      : VALVE_CABLE.nominalVoltage;
    const va = load * voltage;

    return [
      {
        title: 'Подбор трансформатора',
        note: 'Запас 30 % — по §5.12 ТЗ. Пусковой ток кратковременный, но трансформатор ' +
          'должен его выдерживать без просадки напряжения.',
        columns: ['Величина', 'Значение'],
        rows: [
          ['Клапанов одновременно', String(count)],
          ['Суммарный пусковой ток', `${fmt(load, 2)} А`],
          ['Нагрузка', `${fmt(va, 1)} В·А`],
          ['Трансформатор с запасом 30 %', `не менее ${fmt(va * 1.3, 0)} В·А`],
        ],
      },
    ];
  },

  explain: [
    'Соленоид клапана открывается пусковым током, а удерживается меньшим током. Считать ' +
      'кабель нужно по пусковому: если напряжения не хватит в момент открытия, клапан ' +
      'просто не откроется, сколько бы он потом ни держал.',
    'Допустимое падение — 10 % от 24 В, то есть 2,4 В. Это не формальность: ниже ' +
      'соленоид либо не поднимает шток, либо начинает дребезжать. Дребезг разрушает ' +
      'мембрану за один сезон, а симптом выглядит как «клапан гудит и не закрывается».',
    'Классическая ошибка — кабель 0,5 мм² на 150 метров. Сечение входит в формулу в ' +
      'знаменателе, поэтому переход с 0,5 на 1,0 мм² сразу удваивает предельную длину.',
    'Общий провод несёт сумму токов всех одновременно открытых клапанов, включая ' +
      'мастер-клапан. Его берут на ступень толще зонных жил — иначе он станет узким ' +
      'местом всей системы, причём проявится это только в жару при полной нагрузке.',
    'Расчёт и схема — да, выполнение работ — только квалифицированный электрик. ' +
      'Приложение не является допуском к работам.',
  ],

  historyTitle: (values, result) =>
    `${fmt(Number(values['lengthM'] ?? 0), 0)} м × ${str(values, 'crossSection', '1')} мм² → ${fmt(
      Number((result.values as { dropV?: number }).dropV ?? 0),
      2,
    )} В`,
};
