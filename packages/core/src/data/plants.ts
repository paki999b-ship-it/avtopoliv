/**
 * Коэффициенты культуры Kc и глубина корневой зоны (§3.3.4, §5.7, §5.9).
 *
 * ИСТОЧНИК: значения Kc и глубины промачивания приведены в самом ТЗ
 * (§5.7 и §5.9) и восходят к методике FAO Irrigation and Drainage Paper 56
 * (Allen et al., 1998) — «ET0 × Kc», эталонная поверхность — трава 0,12 м.
 * Уточнение под конкретный регион и вид насаждений — по месту.
 */

export type PlantType = 'lawn' | 'shrubs' | 'trees' | 'flowers' | 'vegetables' | 'greenhouse';

export interface PlantSpec {
  type: PlantType;
  titleRu: string;
  kcMin: number;
  kcMax: number;
  /** Глубина корневой зоны для расчёта нормы за полив, м. */
  rootDepthMinM: number;
  rootDepthMaxM: number;
  note: string;
  source: string;
  sourceStatus: 'verified' | 'to_verify';
}

const SRC_TZ = 'ТЗ §5.7 и §5.9; методика FAO Irrigation and Drainage Paper 56 (Allen et al., 1998)';
const SRC_DERIVED =
  'Диапазон принят по аналогии с соседними категориями ТЗ §5.7 — требуется сверка';

export const PLANTS: PlantSpec[] = [
  {
    type: 'lawn',
    titleRu: 'Газон',
    kcMin: 0.7,
    kcMax: 0.8,
    rootDepthMinM: 0.15,
    rootDepthMaxM: 0.2,
    note: 'Самый требовательный элемент участка: мелкие корни и высокий Kc. Именно газон обычно определяет суммарную потребность в воде.',
    source: SRC_TZ,
    sourceStatus: 'verified',
  },
  {
    type: 'shrubs',
    titleRu: 'Кустарники',
    kcMin: 0.5,
    kcMax: 0.5,
    rootDepthMinM: 0.3,
    rootDepthMaxM: 0.4,
    note: 'Корни глубже газонных, расход воды заметно ниже. Держать кустарники в одной зоне с газоном — почти всегда перелив для одних и недолив для других.',
    source: SRC_TZ,
    sourceStatus: 'verified',
  },
  {
    type: 'trees',
    titleRu: 'Деревья',
    kcMin: 0.5,
    kcMax: 0.7,
    rootDepthMinM: 0.5,
    rootDepthMaxM: 0.8,
    note: 'Поливать редко и глубоко. Частый поверхностный полив выводит корни к поверхности и делает дерево неустойчивым.',
    source: SRC_TZ,
    sourceStatus: 'verified',
  },
  {
    type: 'flowers',
    titleRu: 'Цветники и однолетники',
    kcMin: 0.7,
    kcMax: 0.9,
    rootDepthMinM: 0.2,
    rootDepthMaxM: 0.3,
    note: 'Неглубокие корни при высоком расходе — обычно капельная линия или микроспринклеры.',
    source: SRC_DERIVED,
    sourceStatus: 'to_verify',
  },
  {
    type: 'vegetables',
    titleRu: 'Овощи (открытый грунт)',
    kcMin: 0.8,
    kcMax: 1.15,
    rootDepthMinM: 0.3,
    rootDepthMaxM: 0.5,
    note: 'Kc сильно меняется по фазам развития: от всходов к плодоношению разница почти в полтора раза.',
    source: SRC_TZ,
    sourceStatus: 'verified',
  },
  {
    type: 'greenhouse',
    titleRu: 'Теплица',
    kcMin: 0.9,
    kcMax: 1.2,
    rootDepthMinM: 0.3,
    rootDepthMaxM: 0.5,
    note: 'Осадков нет вообще, вся вода — поливная. Ошибка в норме проявляется за считаные дни.',
    source: SRC_TZ,
    sourceStatus: 'verified',
  },
];

export function findPlant(type: PlantType): PlantSpec {
  const p = PLANTS.find((x) => x.type === type);
  if (!p) throw new Error(`Неизвестный тип насаждений: ${type}`);
  return p;
}

export const plantKc = (type: PlantType) => {
  const p = findPlant(type);
  return (p.kcMin + p.kcMax) / 2;
};

export const plantRootDepthM = (type: PlantType) => {
  const p = findPlant(type);
  return (p.rootDepthMinM + p.rootDepthMaxM) / 2;
};
