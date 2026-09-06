/**
 * Справочник почв (§3.3.3, §7 таблица `soils`).
 *
 * ── ИСТОЧНИКИ ──────────────────────────────────────────────────────────────
 * Скорость впитывания — FAO, Irrigation Water Management Training Manual,
 * «Irrigation Methods», Annex 2, Table 7 «Basic infiltration rates for various
 * soil types»: https://www.fao.org/4/s8684e/s8684e0a.htm
 *
 * Доступная влага — University of California ANR, Center for Landscape & Urban
 * Horticulture, «Soil Water Holding Characteristics» (таблица в дюймах воды на
 * фут грунта, пересчёт: 1 in/ft = 83,33 мм/м):
 * https://ucanr.edu/site/center-landscape-urban-horticulture/soil-water-holding-characteristics
 * Подтверждено вторым изданием UC ANR «Landscape Irrigation System Evaluation
 * and Management» (Appendix E, публикация 80223): для грубых почв 0,5–1,5 in/ft,
 * для тяжёлых 1,75–2,25 in/ft; допустимое истощение для ландшафтных растений —
 * около 50 % доступной влаги.
 *
 * ── ОГОВОРКА ПО ПЕСКУ ──────────────────────────────────────────────────────
 * FAO в Table 7 печатает для песка «less than 30 mm/hour» (проверено дословно).
 * Это противоречит и физике, и самой таблице: ряд идёт по убыванию от песка к
 * глине, а супесь в той же таблице получает 20–30 мм/ч. Песок не может
 * впитывать медленнее супеси. Приложение использует для песка 30–50 мм/ч,
 * то есть читает строку как «более 30». Решение зафиксировано в DECISIONS.md.
 *
 * Единицы:
 *   infiltration — установившаяся скорость впитывания, мм/ч
 *   awc — доступная растениям влага, мм на метр глубины почвы
 */

export type SoilType =
  | 'sand'
  | 'loamy_sand'
  | 'sandy_loam'
  | 'loam'
  | 'clay_loam'
  | 'clay'
  | 'peat';

export interface SoilSpec {
  type: SoilType;
  titleRu: string;
  /** Скорость впитывания, мм/ч. */
  infiltrationMinMmH: number;
  infiltrationMaxMmH: number;
  /** Доступная влага, мм/м. */
  awcMinMmPerM: number;
  awcMaxMmPerM: number;
  note: string;
  /** Источник значения скорости впитывания. */
  sourceInfiltration: string;
  /** Источник значения влагоёмкости. */
  sourceAwc: string;
  source: string;
  sourceStatus: 'verified' | 'to_verify';
}

const FAO_T7 =
  'FAO, Irrigation Water Management: Irrigation Methods, Annex 2, Table 7 «Basic infiltration rates for various soil types»';
const UC_ANR =
  'UC ANR, Center for Landscape & Urban Horticulture, «Soil Water Holding Characteristics» (пересчёт 1 in/ft = 83,33 мм/м)';

export const SOILS: SoilSpec[] = [
  {
    type: 'sand',
    titleRu: 'Песок',
    // FAO печатает «less than 30»; см. оговорку в шапке файла.
    infiltrationMinMmH: 30,
    infiltrationMaxMmH: 50,
    // UC ANR, строка «Coarse sands, fine sands, loamy sands» — 0,75–1,25 in/ft.
    awcMinMmPerM: 63,
    awcMaxMmPerM: 104,
    note: 'Впитывает всё и сразу, но почти ничего не держит. Поливать часто и понемногу; интенсивность дождя здесь практически никогда не бывает избыточной.',
    sourceInfiltration: `${FAO_T7} (строка «sand»; прочитана как «более 30» — см. DECISIONS.md)`,
    sourceAwc: `${UC_ANR}, строка «Coarse sands, fine sands, loamy sands»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'loamy_sand',
    titleRu: 'Супесь',
    infiltrationMinMmH: 20,
    infiltrationMaxMmH: 30,
    awcMinMmPerM: 63,
    awcMaxMmPerM: 104,
    note: 'Компромисс между песком и суглинком; типична для подсыпного грунта под газон. По влагоёмкости источник объединяет супесь с песками.',
    sourceInfiltration: `${FAO_T7}, строка «sandy loam»`,
    sourceAwc: `${UC_ANR}, строка «Coarse sands, fine sands, loamy sands»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'sandy_loam',
    titleRu: 'Суглинок лёгкий',
    infiltrationMinMmH: 20,
    infiltrationMaxMmH: 30,
    // UC ANR, строка «Sandy loams, fine sandy loams» — 1,25–1,75 in/ft.
    awcMinMmPerM: 104,
    awcMaxMmPerM: 146,
    note: 'Самая удобная почва для полива: держит воду и принимает дождь спреев почти без стока.',
    sourceInfiltration: `${FAO_T7}, строка «sandy loam»`,
    sourceAwc: `${UC_ANR}, строка «Sandy loams, fine sandy loams»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'loam',
    titleRu: 'Суглинок средний',
    infiltrationMinMmH: 10,
    infiltrationMaxMmH: 20,
    // UC ANR, строка «Very fine sandy loams, loams, silt loams» — 1,50–2,30 in/ft.
    awcMinMmPerM: 125,
    awcMaxMmPerM: 192,
    note: 'Интенсивность спреев (25–50 мм/ч) уже выше впитывания — нужен режим cycle & soak.',
    sourceInfiltration: `${FAO_T7}, строка «loam»`,
    sourceAwc: `${UC_ANR}, строка «Very fine sandy loams, loams, silt loams»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'clay_loam',
    titleRu: 'Суглинок тяжёлый',
    infiltrationMinMmH: 5,
    infiltrationMaxMmH: 10,
    // UC ANR, строка «Clay loams, silty clay loams, sandy clay loams» — 1,75–2,50 in/ft.
    awcMinMmPerM: 146,
    awcMaxMmPerM: 208,
    note: 'Держит много воды, но принимает медленно. Полив редкий и длинный, обязательно циклами.',
    sourceInfiltration: `${FAO_T7}, строка «clay loam»`,
    sourceAwc: `${UC_ANR}, строка «Clay loams, silty clay loams, sandy clay loams»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'clay',
    titleRu: 'Глина',
    infiltrationMinMmH: 1,
    infiltrationMaxMmH: 5,
    // UC ANR, строка «Sandy clays, silty clays, clays» — 1,60–2,50 in/ft.
    awcMinMmPerM: 133,
    awcMaxMmPerM: 208,
    note: 'Любой дождеватель льёт быстрее, чем глина впитывает. Без циклов вода уходит стоком, а корни остаются сухими.',
    sourceInfiltration: `${FAO_T7}, строка «clay»`,
    sourceAwc: `${UC_ANR}, строка «Sandy clays, silty clays, clays»`,
    source: `${FAO_T7}; ${UC_ANR}`,
    sourceStatus: 'verified',
  },
  {
    type: 'peat',
    titleRu: 'Торф / органический грунт',
    infiltrationMinMmH: 15,
    infiltrationMaxMmH: 30,
    awcMinMmPerM: 200,
    awcMaxMmPerM: 300,
    note: 'Пересохший торф гидрофобен: вода скатывается, не смачивая. Не допускайте полного пересыхания.',
    sourceInfiltration: 'Типовые значения; в таблицах FAO и UC ANR органические грунты отсутствуют',
    sourceAwc: 'Типовые значения; в таблицах FAO и UC ANR органические грунты отсутствуют',
    source: 'Требуется сверка с почвенным справочником — см. DECISIONS.md',
    sourceStatus: 'to_verify',
  },
];

export function findSoil(type: SoilType): SoilSpec {
  const s = SOILS.find((x) => x.type === type);
  if (!s) throw new Error(`Неизвестный тип почвы: ${type}`);
  return s;
}

/** Среднее по диапазону — значение по умолчанию для калькуляторов. */
export const soilInfiltrationMmH = (type: SoilType) => {
  const s = findSoil(type);
  return (s.infiltrationMinMmH + s.infiltrationMaxMmH) / 2;
};

export const soilAwcMmPerM = (type: SoilType) => {
  const s = findSoil(type);
  return (s.awcMinMmPerM + s.awcMaxMmPerM) / 2;
};
