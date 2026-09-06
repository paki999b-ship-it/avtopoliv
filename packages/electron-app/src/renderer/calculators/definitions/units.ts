import { convertAll, fmt, fmtSig, listUnits } from '@irrigo/core';
import type { UnitQuantity } from '@irrigo/core';
import type { CalcDefinition, ResultTable } from '../types.js';
import { num, str } from '../lib.js';

/**
 * §5.1. Конвертер единиц.
 *
 * Единственный калькулятор без «формулы» в привычном смысле: его результат —
 * таблица одного и того же количества в разных единицах. Соотношения берутся
 * из движка (`convertAll`), а не пишутся в UI повторно.
 */

const QUANTITIES: Array<{ value: UnitQuantity; label: string }> = [
  { value: 'pressure', label: 'Давление' },
  { value: 'flow', label: 'Расход' },
  { value: 'length', label: 'Длина' },
  { value: 'area', label: 'Площадь' },
  { value: 'volume', label: 'Объём' },
  { value: 'depth', label: 'Норма полива / осадки' },
  { value: 'precipitation', label: 'Интенсивность дождя' },
];

function quantityOf(value: string): UnitQuantity {
  const found = QUANTITIES.find((q) => q.value === value);
  return found ? found.value : 'pressure';
}

export const unitsCalculator: CalcDefinition = {
  key: 'units',

  fields: [
    {
      kind: 'select',
      name: 'quantity',
      label: 'Что переводим',
      options: QUANTITIES.map((q) => ({ value: q.value, label: q.label })),
    },
    { kind: 'number', name: 'value', label: 'Значение', unit: '' },
    {
      kind: 'select',
      name: 'fromUnit',
      label: 'Из единицы',
      options: listUnits('pressure').map((u) => ({ value: u.unit, label: u.label })),
      // Список единиц зависит от выбранной величины.
      optionsFor: (values) =>
        listUnits(quantityOf(String(values['quantity'] ?? 'pressure'))).map((u) => ({
          value: u.unit,
          label: u.label,
        })),
    },
  ],

  defaults: { quantity: 'pressure', value: 3, fromUnit: 'бар' },

  run: ({ values }) => {
    const quantity = quantityOf(str(values, 'quantity', 'pressure'));
    const value = num(values, 'value');
    const fromUnit = str(values, 'fromUnit', listUnits(quantity)[0]?.unit ?? '');

    const rows = convertAll(quantity, value, fromUnit);

    return {
      values: Object.fromEntries(rows.map((r) => [r.unit, r.value])),
      steps: rows
        .filter((r) => r.unit !== fromUnit)
        .map((r) => ({
          label: r.label,
          formula: `${fromUnit} → ${r.unit}`,
          substitution: `${fmt(value, 3)} ${fromUnit}`,
          result: `${fmtSig(r.value, 4)} ${r.unit}`,
        })),
      notes: [
        {
          severity: 'info',
          code: 'units-metric-first',
          message: 'Метрическая система — основная, имперская нужна для американских каталогов',
          why:
            'Каталоги Hunter, Rain Bird и Toro печатают радиус в футах, расход в GPM, ' +
            'давление в psi, а интенсивность в дюймах в час. Пересчёт «на глаз» ' +
            'в этой предметной области стабильно даёт ошибку в разы.',
        },
        {
          severity: 'info',
          code: 'units-mm-equals-litre',
          message: '1 мм осадков = 1 л/м²',
          why:
            'Это не совпадение, а определение: слой воды толщиной 1 мм на площади ' +
            '1 м² и есть один литр. Отсюда же и «PR [мм/ч] = q [л/ч] / A [м²]».',
        },
      ],
    };
  },

  outputs: [],

  tables: (_result, values): ResultTable[] => {
    const quantity = quantityOf(str(values, 'quantity', 'pressure'));
    const value = typeof values['value'] === 'number' ? values['value'] : 0;
    const fromUnit = str(values, 'fromUnit', listUnits(quantity)[0]?.unit ?? '');

    let rows: string[][];
    try {
      rows = convertAll(quantity, value, fromUnit).map((r) => [
        r.label,
        fmtSig(r.value, 5),
        r.unit,
      ]);
    } catch {
      return [];
    }

    return [
      {
        title: 'Во всех единицах',
        columns: ['Величина', 'Значение', 'Единица'],
        rows,
      },
    ];
  },

  explain: [
    'Перевод единиц — не формальность, а самая частая причина ошибок на порядок. ' +
      'Давление в 3 бара и 3 psi отличаются в 14,5 раза; расход 1 м³/ч и 1 GPM — в 4,4 раза.',
    'Держите в голове три опорных равенства: 1 бар ≈ 10,2 м водяного столба, ' +
      '1 м³/ч ≈ 16,7 л/мин, 1 мм осадков = 1 л/м². Через них выводится почти всё остальное.',
    'Десять метров высоты — это примерно один бар. Поэтому участок с перепадом 15 м ' +
      'теряет полтора бара только на подъёме, ещё до всяких потерь на трение.',
  ],

  historyTitle: (values) =>
    `${fmt(typeof values['value'] === 'number' ? values['value'] : 0, 2)} ${str(
      values,
      'fromUnit',
      '',
    )}`,
};

export { QUANTITIES as UNIT_QUANTITIES };
