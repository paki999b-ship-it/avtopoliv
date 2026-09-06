import { dripLine, dripZonePrecipitationRate, fmt, pumpHead } from '@irrigo/core';
import type { CalcDefinition } from '../types.js';
import { bool, num, optNum, str } from '../lib.js';

/**
 * §5.11 «Полный требуемый напор и подбор насоса» и §5.14 «Капельная линия».
 *
 * Кривых конкретных насосов в приложении нет и не будет (§5.11, §8 ТЗ):
 * пользователь вводит две-три точки паспортной кривой, приложение строит
 * график и показывает пересечение с характеристикой системы.
 */

// ── §5.11. Требуемый напор и рабочая точка ───────────────────────────────────

export const pumpHeadCalculator: CalcDefinition = {
  key: 'pump-head',

  fields: [
    {
      kind: 'section',
      title: 'Шаг 1. Что должна выдать система',
      description:
        'Пять чисел, из которых складывается требуемый напор. Расчёт ведут по самой ' +
        '«тяжёлой» зоне — той, что требует больше всего напора, а не по сумме всех зон: ' +
        'зоны работают по очереди.',
    },
    {
      kind: 'number',
      name: 'flowM3h',
      label: 'Расход самой тяжёлой зоны',
      unit: 'м³/ч',
      quantity: 'flow',
      min: 0,
      hint: 'Сумма расходов голов одной зоны. Не сумма всех зон — они работают по очереди',
    },
    {
      kind: 'number',
      name: 'staticLiftM',
      label: 'Подъём по высоте',
      unit: 'м',
      quantity: 'length',
      hint: 'От зеркала воды до самой высокой головы. Каждые 10 м — это 1 бар',
      min: 0,
    },
    {
      kind: 'number',
      name: 'frictionLossM',
      label: 'Потери на трение в трубах',
      unit: 'м вод. ст.',
      min: 0,
      hint: 'Из калькулятора «Потери на трение» (§5.2) — по самой длинной ветке',
    },
    {
      kind: 'number',
      name: 'minorLossM',
      label: 'Потери на узле и фитингах',
      unit: 'м вод. ст.',
      optional: true,
      min: 0,
      hint: 'Из калькулятора «Местные потери» (§5.5): фильтр, клапан, редуктор, счётчик',
    },
    {
      kind: 'number',
      name: 'sprinklerPressureBar',
      label: 'Рабочее давление дождевателя',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
      hint: 'Из таблицы сопла: спреи около 2,1 бара, роторы 3–4,5. Обычно это самая большая часть напора',
    },

    {
      kind: 'section',
      title: 'Шаг 2. Допуски расчёта',
      description:
        'Оба поля можно оставить пустыми — тогда берутся значения по умолчанию: запас 10 % ' +
        'и КПД 0,6.',
    },
    {
      kind: 'number',
      name: 'safetyMarginPercent',
      label: 'Запас на износ и загрязнение',
      unit: '%',
      optional: true,
      min: 0,
      max: 50,
      hint: '10–15 % по §5.11. Больше — насос будет работать вне эффективной зоны',
    },
    {
      kind: 'number',
      name: 'efficiency',
      label: 'КПД насоса',
      unit: 'доля',
      optional: true,
      min: 0.2,
      max: 0.95,
      hint: '0,5–0,75 у бытовых насосов. Влияет только на мощность, не на напор',
    },

    {
      kind: 'section',
      title: 'Шаг 3. Проверить конкретный насос (необязательно)',
      description:
        'Подходящие модели из каталогов приложение подбирает само — для этого ничего ' +
        'вводить не нужно. Этот шаг для другого случая: у вас уже есть насос или его ' +
        'предложил поставщик, и надо увидеть, что он даст именно на вашей системе.',
    },
    {
      kind: 'toggle',
      name: 'useCurve',
      label: 'Построить кривую своего насоса по паспорту',
      hint: 'Кривых конкретных насосов приложение не выдумывает — точки берутся из паспорта вашей машины',
    },
    {
      kind: 'number',
      name: 'curveQ1',
      label: 'Точка 1 · расход',
      unit: 'м³/ч',
      quantity: 'flow',
      min: 0,
      hint: 'Обычно нулевой расход: напор при закрытом кране',
      visibleIf: (v) => v['useCurve'] === true,
    },
    {
      kind: 'number',
      name: 'curveH1',
      label: 'Точка 1 · напор',
      unit: 'м',
      quantity: 'length',
      min: 0,
      hint: 'Максимальный напор из паспорта, H_max',
      visibleIf: (v) => v['useCurve'] === true,
    },
    {
      kind: 'number',
      name: 'curveQ2',
      label: 'Точка 2 · расход',
      unit: 'м³/ч',
      quantity: 'flow',
      min: 0,
      hint: 'Из середины паспортной таблицы — ближе к вашему расходу',
      visibleIf: (v) => v['useCurve'] === true,
    },
    {
      kind: 'number',
      name: 'curveH2',
      label: 'Точка 2 · напор',
      unit: 'м',
      quantity: 'length',
      min: 0,
      visibleIf: (v) => v['useCurve'] === true,
    },
    {
      kind: 'number',
      name: 'curveQ3',
      label: 'Точка 3 · расход',
      unit: 'м³/ч',
      quantity: 'flow',
      optional: true,
      min: 0,
      hint: 'Третья точка уточняет форму кривой: возьмите её из правой части таблицы',
      visibleIf: (v) => v['useCurve'] === true,
    },
    {
      kind: 'number',
      name: 'curveH3',
      label: 'Точка 3 · напор',
      unit: 'м',
      quantity: 'length',
      optional: true,
      min: 0,
      visibleIf: (v) => v['useCurve'] === true,
    },
  ],

  defaults: {
    flowM3h: 4,
    staticLiftM: 12,
    frictionLossM: 6,
    minorLossM: 3,
    sprinklerPressureBar: 3,
    safetyMarginPercent: null,
    efficiency: null,
    useCurve: false,
    curveQ1: 0,
    curveH1: 55,
    curveQ2: 4,
    curveH2: 45,
    curveQ3: 8,
    curveH3: 25,
  },

  run: ({ values }) => {
    const margin = optNum(values, 'safetyMarginPercent');
    return pumpHead({
      flowM3h: num(values, 'flowM3h'),
      staticLiftM: num(values, 'staticLiftM'),
      frictionLossM: num(values, 'frictionLossM'),
      minorLossM: optNum(values, 'minorLossM'),
      sprinklerPressureBar: num(values, 'sprinklerPressureBar'),
      safetyMargin: margin === undefined ? undefined : margin / 100,
      efficiency: optNum(values, 'efficiency'),
    });
  },

  /*
   * Плиток четыре, а не шесть: слагаемые напора («давление дождевателя в
   * метрах», «напор без запаса») теперь разобраны карточкой ниже — там у них
   * есть и доля, и объяснение, что с ними делать. В плитках остаётся ответ.
   */
  outputs: [
    {
      name: 'requiredHeadM',
      label: 'Нужен напор',
      unit: 'м',
      digits: 1,
      hint: 'Столько насос должен давать при вашем расходе',
    },
    { name: 'requiredHeadBar', label: 'То же в барах', unit: 'бар', quantity: 'pressure', digits: 2 },
    {
      name: 'shaftPowerKw',
      label: 'Мощность на валу',
      unit: 'кВт',
      quantity: 'power',
      digits: 2,
      hint: 'Не путать с мощностью из паспорта: там указывают потребляемую',
    },
    { name: 'efficiency', label: 'Принятый КПД', digits: 2 },
  ],

  extraKey: 'pump-curve',

  explain: [
    'Калькулятор отвечает на три вопроса подряд. Первый: сколько напора нужно вашей ' +
      'системе. Второй: какие насосы из загруженных каталогов эту точку закрывают. ' +
      'Третий, необязательный: что даст конкретная машина, если она у вас уже есть.',
    'Требуемый напор складывается из четырёх слагаемых: подъём по высоте, потери на ' +
      'трение, местные потери и рабочее давление самого дождевателя. Плюс запас 10–15 % ' +
      'на то, что реальная система всегда чуть хуже расчётной. Разбор по слагаемым ' +
      'показан карточкой под плитками: обычно оказывается, что больше всего весит ' +
      'давление дождевателя, а вовсе не трение в трубах.',
    'Рабочее давление дождевателя урезать нельзя: сопло, рассчитанное на 3 бара, при ' +
      'двух даёт не «чуть меньше радиус», а рваную струю и провал равномерности. ' +
      'Единственное слагаемое, которое реально уменьшается, — потери на трение: ' +
      'больший диаметр магистрали или разделение зоны на две.',
    'Насос подбирают по рабочей точке, а не по максимальному напору из рекламы. ' +
      'Максимальный напор достигается при нулевом расходе — то есть при закрытом кране, ' +
      'когда система не поливает вообще. Это типовая ошибка §11 п.5.',
    'Расход берут по самой тяжёлой зоне, а не по сумме всех: зоны работают по очереди, ' +
      'и одновременно насос питает только одну.',
    'На графике рабочая точка — пересечение кривой насоса с характеристикой системы. ' +
      'Хорошо, когда она лежит в средней трети кривой: там у насоса максимальный КПД и ' +
      'наименьший износ. У левого края вода греется, у правого растёт риск кавитации.',
    'Для поверхностного насоса отдельно проверьте всасывание: высота больше 7–8 метров ' +
      'физически недостижима, а с учётом потерь на всасывающей линии практический предел ' +
      'ещё ниже. При сомнении ставьте погружной.',
  ],

  historyTitle: (values, result) =>
    `Q ${fmt(Number(values['flowM3h'] ?? 0), 2)} м³/ч, H ${fmt(
      Number((result.values as { requiredHeadM?: number }).requiredHeadM ?? 0),
      1,
    )} м`,
};

// ── §5.14. Капельная линия ───────────────────────────────────────────────────

export const dripLineCalculator: CalcDefinition = {
  key: 'drip-line',

  fields: [
    {
      kind: 'select',
      name: 'mode',
      label: 'Что считаем',
      options: [
        { value: 'line', label: 'Линия: расход, потери, разброс и равномерность' },
        { value: 'zonePr', label: 'Интенсивность капельной зоны, мм/ч' },
      ],
    },

    // Режим «линия»
    {
      kind: 'number',
      name: 'emitterFlowLph',
      label: 'Расход капельницы',
      unit: 'л/ч',
      quantity: 'flowLph',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'emitterSpacingM',
      label: 'Шаг капельниц',
      unit: 'м',
      quantity: 'length',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'lineLengthM',
      label: 'Длина линии',
      unit: 'м',
      quantity: 'length',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'innerDiameterMm',
      label: 'Внутренний диаметр трубки',
      unit: 'мм',
      quantity: 'diameter',
      min: 0,
      hint: 'У трубки 16 мм это обычно 13,6–14,2 мм',
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'inletPressureBar',
      label: 'Давление на входе в линию',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'nominalPressureBar',
      label: 'Номинальное давление капельницы',
      unit: 'бар',
      quantity: 'pressure',
      optional: true,
      min: 0,
      hint: 'То, при котором заявлен расход. Обычно 1,0 бар',
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'slopePercent',
      label: 'Уклон линии',
      unit: '%',
      optional: true,
      hint: 'Положительный — вверх по потоку, отрицательный — вниз',
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'toggle',
      name: 'compensating',
      label: 'Компенсированные капельницы',
      hint: 'Держат расход в своём рабочем диапазоне давления — диапазон берите из паспорта',
      visibleIf: (v) => v['mode'] !== 'zonePr',
    },
    {
      kind: 'number',
      name: 'compensationMinBar',
      label: 'Рабочий диапазон: минимум',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr' && v['compensating'] === true,
    },
    {
      kind: 'number',
      name: 'compensationMaxBar',
      label: 'Рабочий диапазон: максимум',
      unit: 'бар',
      quantity: 'pressure',
      min: 0,
      visibleIf: (v) => v['mode'] !== 'zonePr' && v['compensating'] === true,
    },

    // Режим «PR зоны»
    {
      kind: 'number',
      name: 'totalFlowLph',
      label: 'Суммарный расход капельной зоны',
      unit: 'л/ч',
      quantity: 'flowLph',
      min: 0,
      visibleIf: (v) => v['mode'] === 'zonePr',
    },
    {
      kind: 'number',
      name: 'plantedAreaM2',
      label: 'Площадь посадок',
      unit: 'м²',
      quantity: 'area',
      min: 0,
      visibleIf: (v) => v['mode'] === 'zonePr',
    },
  ],

  defaults: {
    mode: 'line',
    emitterFlowLph: 2,
    emitterSpacingM: 0.3,
    lineLengthM: 60,
    innerDiameterMm: 13.8,
    inletPressureBar: 1.5,
    nominalPressureBar: null,
    slopePercent: null,
    compensating: false,
    compensationMinBar: 0.6,
    compensationMaxBar: 3.5,
    totalFlowLph: 400,
    plantedAreaM2: 40,
  },

  run: ({ values }) => {
    if (str(values, 'mode', 'line') === 'zonePr') {
      return dripZonePrecipitationRate({
        totalFlowLph: num(values, 'totalFlowLph'),
        plantedAreaM2: num(values, 'plantedAreaM2'),
      });
    }

    const compensating = bool(values, 'compensating');

    return dripLine({
      emitterFlowLph: num(values, 'emitterFlowLph'),
      emitterSpacingM: num(values, 'emitterSpacingM'),
      lineLengthM: num(values, 'lineLengthM'),
      innerDiameterMm: num(values, 'innerDiameterMm'),
      inletPressureBar: num(values, 'inletPressureBar'),
      nominalPressureBar: optNum(values, 'nominalPressureBar'),
      slopePercent: optNum(values, 'slopePercent'),
      compensating,
      compensationRangeBar: compensating
        ? {
            min: num(values, 'compensationMinBar'),
            max: num(values, 'compensationMaxBar'),
          }
        : undefined,
    });
  },

  outputs: [
    { name: 'emitterCount', label: 'Капельниц на линии', unit: 'шт', digits: 0, hideIfNull: true },
    { name: 'lineFlowLph', label: 'Расход линии', unit: 'л/ч', quantity: 'flowLph', digits: 0, hideIfNull: true },
    { name: 'lineFlowM3h', label: 'То же в м³/ч', unit: 'м³/ч', quantity: 'flow', digits: 3, hideIfNull: true },
    {
      name: 'frictionLossBar',
      label: 'Потери по линии',
      unit: 'бар',
      quantity: 'pressure',
      digits: 3,
      hideIfNull: true,
    },
    {
      name: 'endPressureBar',
      label: 'Давление в конце линии',
      unit: 'бар',
      quantity: 'pressure',
      digits: 2,
      hideIfNull: true,
    },
    {
      name: 'flowFirstLph',
      label: 'Расход первой капельницы',
      unit: 'л/ч',
      quantity: 'flowLph',
      digits: 2,
      hideIfNull: true,
    },
    {
      name: 'flowLastLph',
      label: 'Расход последней',
      unit: 'л/ч',
      quantity: 'flowLph',
      digits: 2,
      hideIfNull: true,
    },
    {
      name: 'flowVariation',
      label: 'Разброс расхода',
      digits: 3,
      hideIfNull: true,
      hint: 'Для некомпенсированных — не более 0,10',
      tone: (r) => (r['acceptable'] === true ? 'ok' : 'danger'),
    },
    {
      name: 'emissionUniformity',
      label: 'Равномерность EU',
      digits: 2,
      hideIfNull: true,
      tone: (r) => (Number(r['emissionUniformity']) >= 0.9 ? 'ok' : Number(r['emissionUniformity']) >= 0.8 ? 'warn' : 'danger'),
    },
    {
      name: 'maxLineLengthM',
      label: 'Предельная длина линии',
      unit: 'м',
      quantity: 'length',
      digits: 0,
      hideIfNull: true,
    },
    {
      name: 'precipitationRateMmH',
      label: 'Интенсивность зоны',
      unit: 'мм/ч',
      quantity: 'precipitation',
      digits: 2,
      hideIfNull: true,
    },
  ],

  explain: [
    'У некомпенсированной капельницы расход зависит от давления примерно как корень: ' +
      'падение давления вдвое снижает расход примерно в полтора раза. Поэтому длинная ' +
      'линия поливает начало и конец по-разному.',
    'Отраслевой ориентир: разброс расхода по линии не больше 10 %, по блоку вместе с ' +
      'распределителем — не больше 20 %. За этими пределами равномерность считается ' +
      'неприемлемой, и удлинять линию «ещё немного» уже нельзя.',
    'Потери считаются с поправкой Кристиансена: расход по линии убывает с каждой ' +
      'капельницей, и считать потери по полному расходу на всю длину было бы завышением ' +
      'примерно втрое.',
    'Компенсированные капельницы держат расход постоянным в своём рабочем диапазоне ' +
      'давления и допускают заметно более длинные линии. Но диапазон надо брать из ' +
      'паспорта изделия, а не «по опыту»: у разных серий он разный, и ниже нижней ' +
      'границы компенсация просто перестаёт работать.',
    'Уклон работает в обе стороны: линия, идущая вниз по потоку, частично компенсирует ' +
      'потери на трение, а идущая вверх — складывается с ними.',
    'И отдельно про фильтр: капельному поливу нужна фильтрация не грубее 120 mesh ' +
      '(около 130 мкм). Фильтр 40 mesh для капли — это забитые эмиттеры к середине сезона.',
  ],

  historyTitle: (values, result) => {
    if (str(values, 'mode', 'line') === 'zonePr') {
      return `Капельная зона: PR ${fmt(
        Number((result.values as { precipitationRateMmH?: number }).precipitationRateMmH ?? 0),
        2,
      )} мм/ч`;
    }
    const v = result.values as { flowVariation?: number; acceptable?: boolean };
    return `Линия ${fmt(Number(values['lineLengthM'] ?? 0), 0)} м: разброс ${fmt(
      Number(v.flowVariation ?? 0) * 100,
      1,
    )} % — ${v.acceptable ? 'в норме' : 'выше предела'}`;
  },
};
