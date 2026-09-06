/**
 * Замечания тренажёра раскладки — §3.4 ТЗ.
 *
 * Проверок шесть, и все они перечислены в задании: шаг больше радиуса,
 * смешанные классы оборудования, несогласованные сектора, расход выше дебита,
 * голова у самой кромки и полив на дорожку или за участок.
 *
 * Каждое замечание отдаётся в той же форме `CalcNote`, что и у калькуляторов:
 * что не так → почему → как исправить. Единая форма нужна, чтобы UI умел
 * показывать замечания одинаково везде.
 */

import { SOURCE_UTILISATION } from '../constants.js';
import { fmt, round } from '../format.js';
import type { CalcNote, EmitterClass } from '../types.js';
import { TYPICAL_PR_MM_H } from '../agronomy/precipitation-rate.js';
import { distance, distanceToPolygonEdge, pointInPolygon, polygonArea } from './geometry.js';
import type { LayoutHead, LayoutPlan } from './geometry.js';
import { coverage, drySpots } from './coverage.js';
import type { CoverageOptions, CoverageResult } from './coverage.js';

/** Минимальный отступ головы от кромки участка, м (§3.4). */
export const MIN_EDGE_CLEARANCE_M = 0.1;

/** Доля непокрытой площади, с которой раскладку считаем негодной. */
const UNCOVERED_LIMIT = 0.05;

/**
 * Пределы полива мимо цели.
 *
 * Полив за границу участка и полив по своим дорожкам — разные проблемы.
 * Первого полностью избежать нельзя: круглый факел не вписывается в прямой
 * угол, а на полосе шириной 3 м радиус заведомо больше её ширины. Второе —
 * всегда дефект проекта: мокрая плитка, залитая отмостка, лёд зимой.
 */
const WASTE_OUTSIDE_LIMIT = 0.25;

/**
 * Полив по препятствию меряется долей самого препятствия, а не долей участка.
 * Иначе мокрая насквозь дорожка на большом газоне выглядела бы мелочью, а
 * пара брызг на угол дома — проблемой. Совсем сухим препятствие в середине
 * участка не бывает: круглый факел соседних голов частично на него попадает.
 */
const WETTED_OBSTACLE_WARN = 0.4;
const WETTED_OBSTACLE_ERROR = 0.75;

const CLASS_LABEL: Record<EmitterClass, string> = {
  rotor: 'роторы',
  spray: 'спреи',
  rotary_nozzle: 'роторные сопла',
  strip: 'полосовые форсунки',
  drip: 'капельный полив',
  bubbler: 'баблеры',
  micro_spray: 'микродождеватели',
};

export interface LayoutSummary {
  headCount: number;
  /** Суммарный расход зоны, л/ч. */
  zoneFlowLph: number;
  zoneFlowM3h: number;
  /** Доля от дебита источника. */
  sourceUtilisation: number;
  /** Интенсивность дождя зоны по факту, мм/ч. */
  precipitationRateMmH: number;
  /** Классы оборудования, встреченные в зоне. */
  emitterClasses: EmitterClass[];
  /** Среднее расстояние до ближайшего соседа, м. */
  meanSpacingM: number | null;
  /** Отношение шага к радиусу, доля. */
  spacingToRadius: number | null;
}

export interface LayoutEvaluation {
  summary: LayoutSummary;
  coverage: CoverageResult;
  notes: CalcNote[];
  /** Раскладка годна: нет ошибок и непокрытая доля в пределах допуска. */
  passed: boolean;
  /** Оценка 0…1 — для сравнения с эталоном и записи в прогресс. */
  score: number;
}

/** Расстояние до ближайшей другой головы. */
function nearestNeighbourDistances(heads: LayoutHead[]): number[] {
  if (heads.length < 2) return [];

  return heads.map((head) => {
    let best = Number.POSITIVE_INFINITY;
    for (const other of heads) {
      if (other.id === head.id) continue;
      best = Math.min(best, distance(head.position, other.position));
    }
    return best;
  });
}

function summarize(plan: LayoutPlan, heads: LayoutHead[], cover: CoverageResult): LayoutSummary {
  const zoneFlowLph = heads.reduce((sum, h) => sum + h.flowLph, 0);
  const zoneFlowM3h = zoneFlowLph / 1000;

  const classes = [...new Set(heads.map((h) => h.emitterClass))];
  const spacings = nearestNeighbourDistances(heads);
  const meanSpacing =
    spacings.length === 0 ? null : spacings.reduce((s, v) => s + v, 0) / spacings.length;
  const meanRadius =
    heads.length === 0 ? 0 : heads.reduce((s, h) => s + h.radiusM, 0) / heads.length;

  return {
    headCount: heads.length,
    zoneFlowLph: round(zoneFlowLph, 0),
    zoneFlowM3h: round(zoneFlowM3h, 3),
    sourceUtilisation:
      plan.sourceFlowM3h > 0 ? round(zoneFlowM3h / plan.sourceFlowM3h, 3) : 0,
    // Интенсивность считается по политой площади, а не по площади участка:
    // иначе недополитый участок выглядел бы как зона с низкой интенсивностью.
    precipitationRateMmH:
      cover.coveredAreaM2 > 0 ? round(zoneFlowLph / cover.coveredAreaM2, 2) : 0,
    emitterClasses: classes,
    meanSpacingM: meanSpacing === null ? null : round(meanSpacing, 2),
    spacingToRadius:
      meanSpacing === null || meanRadius === 0 ? null : round(meanSpacing / meanRadius, 2),
  };
}

/** Полная оценка раскладки: сводка, покрытие и замечания. */
export function evaluateLayout(
  plan: LayoutPlan,
  heads: LayoutHead[],
  options: CoverageOptions = {},
): LayoutEvaluation {
  const cover = coverage(plan, heads, options);
  const summary = summarize(plan, heads, cover);
  const notes: CalcNote[] = [];

  if (heads.length === 0) {
    notes.push({
      severity: 'info',
      code: 'layout-empty',
      message: 'На плане ещё нет дождевателей',
      why: 'Расставьте головы из библиотеки — расчёт пойдёт сразу, по мере расстановки.',
    });
    return { summary, coverage: cover, notes, passed: false, score: 0 };
  }

  checkCoverage(cover, notes);
  checkSpacing(summary, heads, cover, notes);
  checkEmitterClasses(summary, notes);
  checkMatchedPrecipitation(heads, notes);
  checkSourceFlow(plan, summary, notes);
  checkEdgeClearance(plan, heads, notes);
  checkWaste(cover, notes);

  const hasError = notes.some((n) => n.severity === 'error');
  const passed = !hasError && cover.coverageRatio >= 1 - UNCOVERED_LIMIT;

  return { summary, coverage: cover, notes, passed, score: layoutScore(cover, notes) };
}

/** Доля перелива, при которой за него снимается весь отведённый балл. */
const WASTE_SCORE_ZERO = WASTE_OUTSIDE_LIMIT * 1.6;

/**
 * Оценка раскладки. Покрытие — большая часть веса, перелив — вторая,
 * замечания снимают остальное: ошибка дороже предупреждения, потому что
 * делает зону неработоспособной, а не просто неоптимальной.
 *
 * Шкала перелива привязана к тем же порогам, по которым выдаются замечания:
 * балл обнуляется там же, где перелив становится ошибкой. Иначе раскладка
 * теряла бы очки за то, на что движок даже не жалуется, — а на участке с
 * острыми углами перелив вообще неустраним.
 */
function layoutScore(cover: CoverageResult, notes: CalcNote[]): number {
  let score = cover.coverageRatio * 0.6;

  const wasteRatio =
    cover.irrigableAreaM2 > 0 ? cover.wastedAreaM2 / cover.irrigableAreaM2 : 0;
  score += 0.2 * (1 - Math.min(1, wasteRatio / WASTE_SCORE_ZERO));

  score += 0.2;
  for (const note of notes) {
    if (note.severity === 'error') score -= 0.12;
    else if (note.severity === 'warning') score -= 0.05;
  }

  return round(Math.max(0, Math.min(1, score)), 2);
}

function checkCoverage(cover: CoverageResult, notes: CalcNote[]): void {
  if (cover.uncoveredAreaM2 <= cover.cellAreaM2) return;

  const spots = drySpots(cover);
  const biggest = spots[0];
  const share = 1 - cover.coverageRatio;

  notes.push({
    severity: share > UNCOVERED_LIMIT ? 'error' : 'warning',
    code: 'layout-uncovered',
    message:
      `Не политo ${fmt(cover.uncoveredAreaM2, 1)} м² — ` +
      `${fmt(share * 100, 1)} % площади, пятен: ${spots.length}`,
    why:
      'Сухие пятна не лечатся временем полива: вода туда не долетает независимо от того, ' +
      'сколько минут работает зона.' +
      (biggest ? ` Самое крупное — около ${fmt(biggest.areaM2, 1)} м².` : ''),
    fix: 'Сократите шаг между головами или добавьте головы в непокрытых местах.',
    lessonKey: 'design-layout',
  });
}

/**
 * Шаг между головами.
 *
 * Правило «шаг равен радиусу» — способ добиться сплошного покрытия, а не цель
 * сама по себе. Покрытие здесь измеряется напрямую, поэтому широкий шаг
 * отмечается только тогда, когда он действительно оставил сухие места:
 * угловые головы с большим радиусом стоят далеко друг от друга и при этом
 * закрывают участок целиком — придираться к ним не за что.
 */
function checkSpacing(
  summary: LayoutSummary,
  heads: LayoutHead[],
  cover: CoverageResult,
  notes: CalcNote[],
): void {
  if (summary.spacingToRadius === null || heads.length < 2) return;

  const ratio = summary.spacingToRadius;
  const coverageIsGood = cover.coverageRatio >= 1 - UNCOVERED_LIMIT;

  if (ratio > 1.15 && !coverageIsGood) {
    notes.push({
      severity: 'error',
      code: 'layout-spacing-too-wide',
      message: `Шаг составляет ${fmt(ratio * 100, 0)} % радиуса вместо 100 %`,
      why:
        'Правило перекрытия «голова в голову»: струя каждой головы должна доставать до ' +
        'соседней. У края струи интенсивность заметно ниже, чем у корпуса, и перекрытие ' +
        'её выравнивает. При большем шаге между головами остаются сухие кольца.',
      fix: 'Сократите шаг до радиуса, а на открытом ветреном месте — до 85–90 % радиуса.',
      lessonKey: 'design-layout',
    });
  } else if (ratio < 0.6) {
    notes.push({
      severity: 'warning',
      code: 'layout-spacing-too-tight',
      message: `Шаг всего ${fmt(ratio * 100, 0)} % радиуса — головы стоят слишком плотно`,
      why:
        'Избыточное перекрытие — это лишние головы, лишний расход зоны и лишние деньги. ' +
        'Равномерность при этом почти не растёт.',
      fix: 'Увеличьте шаг до радиуса и уберите лишние головы.',
      lessonKey: 'design-layout',
    });
  }
}

function checkEmitterClasses(summary: LayoutSummary, notes: CalcNote[]): void {
  if (summary.emitterClasses.length < 2) return;

  const ranges = summary.emitterClasses
    .map((c) => {
      const range = TYPICAL_PR_MM_H[c];
      return range ? `${CLASS_LABEL[c]} ${range.min}–${range.max} мм/ч` : CLASS_LABEL[c];
    })
    .join(', ');

  notes.push({
    severity: 'error',
    code: 'layout-mixed-classes',
    message: `В одной зоне смешаны классы оборудования: ${ranges}`,
    why:
      'У классов разная интенсивность дождя, а время полива в зоне одно на всех. ' +
      'За одинаковое время одна часть зоны получит втрое больше воды, чем другая, ' +
      'и настройкой это не выравнивается.',
    fix: 'Разнесите классы по разным зонам — каждой свой клапан и своё время полива.',
    lessonKey: 'basics-zones',
  });
}

/**
 * Согласованность сопел: расход должен быть пропорционален сектору.
 * Проверяется через приведённый расход — расход, пересчитанный на полный круг.
 */
function checkMatchedPrecipitation(heads: LayoutHead[], notes: CalcNote[]): void {
  const sectors = new Set(heads.map((h) => h.sweepDeg));
  if (sectors.size < 2) return;

  const normalised = heads.map((h) => ({
    head: h,
    perDegree: h.flowLph / Math.max(1, h.sweepDeg),
  }));

  const values = normalised.map((n) => n.perDegree);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min <= 0) return;

  const spread = max / min;
  if (spread <= 1.25) return;

  const worst = normalised.reduce((a, b) => (b.perDegree > a.perDegree ? b : a));

  notes.push({
    severity: 'error',
    code: 'layout-unmatched-pr',
    message: `Сопла не согласованы по секторам: расход на градус различается в ${fmt(spread, 1)} раза`,
    why:
      'Сопло на 90° должно давать четверть расхода полнокругового, иначе угол получает ' +
      'вчетверо больше воды при том же времени полива. ' +
      `Сильнее всех выбивается голова «${worst.head.model ?? worst.head.id}» ` +
      `(${fmt(worst.head.flowLph, 0)} л/ч на ${fmt(worst.head.sweepDeg, 0)}°).`,
    fix: 'Возьмите комплект сопел одной серии с согласованной интенсивностью.',
    lessonKey: 'design-matched-pr',
  });
}

function checkSourceFlow(plan: LayoutPlan, summary: LayoutSummary, notes: CalcNote[]): void {
  if (plan.sourceFlowM3h <= 0) return;

  const limit = plan.sourceFlowM3h * SOURCE_UTILISATION;
  if (summary.zoneFlowM3h <= limit) return;

  notes.push({
    severity: 'error',
    code: 'layout-flow-over-source',
    message:
      `Расход зоны ${fmt(summary.zoneFlowM3h, 2)} м³/ч превышает допустимые ` +
      `${fmt(limit, 2)} м³/ч (80 % дебита ${fmt(plan.sourceFlowM3h, 2)} м³/ч)`,
    why:
      'Отбор выше 80 % дебита ведёт к срыву подачи и работе насоса всухую, а скважину ' +
      'заиливает необратимо. Оставшиеся 20 % — не запас на будущее, а защита источника.',
    fix: 'Уберите часть голов из зоны и вынесите их в отдельную зону.',
    lessonKey: 'design-source',
  });
}

function checkEdgeClearance(plan: LayoutPlan, heads: LayoutHead[], notes: CalcNote[]): void {
  const tooClose: string[] = [];
  const onObstacle: string[] = [];

  for (const head of heads) {
    if (!pointInPolygon(head.position, plan.boundary)) {
      onObstacle.push(head.model ?? head.id);
      continue;
    }

    if (distanceToPolygonEdge(head.position, plan.boundary) < MIN_EDGE_CLEARANCE_M) {
      tooClose.push(head.model ?? head.id);
      continue;
    }

    if (plan.obstacles.some((o) => pointInPolygon(head.position, o.polygon))) {
      onObstacle.push(head.model ?? head.id);
    }
  }

  if (tooClose.length > 0) {
    notes.push({
      severity: 'warning',
      code: 'layout-head-at-edge',
      message: `Головы стоят ближе ${fmt(MIN_EDGE_CLEARANCE_M * 100, 0)} см к кромке: ${tooClose.length}`,
      why:
        'Голова у самой кромки попадает под кромкорез и колесо, а её факел уходит за ' +
        'границу участка.',
      fix: 'Отодвиньте головы от кромки на 10 см и более, сохранив перекрытие до края газона.',
      lessonKey: 'installation-heads',
    });
  }

  if (onObstacle.length > 0) {
    notes.push({
      severity: 'error',
      code: 'layout-head-on-obstacle',
      message: `Головы стоят на препятствии или за пределами участка: ${onObstacle.length}`,
      why: 'Дождеватель в дорожке или в постройке установить нельзя.',
      fix: 'Перенесите головы в поливаемую часть участка.',
      lessonKey: 'design-layout',
    });
  }
}

function checkWaste(cover: CoverageResult, notes: CalcNote[]): void {
  if (cover.irrigableAreaM2 <= 0) return;

  const wettedShare =
    cover.obstacleAreaM2 > 0 ? cover.wastedOnObstaclesM2 / cover.obstacleAreaM2 : 0;

  if (wettedShare > WETTED_OBSTACLE_WARN) {
    notes.push({
      severity: wettedShare > WETTED_OBSTACLE_ERROR ? 'error' : 'warning',
      code: 'layout-watering-obstacles',
      message:
        `Полив по дорожкам и постройкам: ${fmt(cover.wastedOnObstaclesM2, 1)} м² — ` +
        `${fmt(wettedShare * 100, 0)} % их площади`,
      why:
        'Мокрая плитка скользит и зеленеет, залитая отмостка ведёт к сырости в цоколе, ' +
        'а зимой на дорожке образуется лёд.',
      fix: 'Уменьшите сектор у голов, обращённых к покрытию, или отодвиньте их.',
      lessonKey: 'design-layout',
    });
  }

  const outsideRatio = cover.wastedOutsideM2 / cover.irrigableAreaM2;
  if (outsideRatio > WASTE_OUTSIDE_LIMIT) {
    notes.push({
      severity: outsideRatio > WASTE_OUTSIDE_LIMIT * 1.6 ? 'error' : 'warning',
      code: 'layout-watering-outside',
      message:
        `Полив за границу участка: ${fmt(cover.wastedOutsideM2, 1)} м² — ` +
        `${fmt(outsideRatio * 100, 0)} % от поливаемой площади`,
      why:
        'Часть воды уходит соседям и на улицу. Полностью убрать это нельзя — круглый ' +
        'факел не вписывается в прямой угол, — но такой перерасход уже заметен.',
      fix: 'Уменьшите радиус краевых голов или возьмите сопла с меньшей дальностью.',
      lessonKey: 'design-layout',
    });
  }
}

/** Сравнение раскладки пользователя с эталонным решением (§3.4). */
export interface LayoutComparison {
  userScore: number;
  referenceScore: number;
  userCoverage: number;
  referenceCoverage: number;
  userHeads: number;
  referenceHeads: number;
  userFlowM3h: number;
  referenceFlowM3h: number;
  /** Замечания, которые есть у пользователя и которых нет у эталона. */
  extraIssues: CalcNote[];
  verdict: 'better' | 'comparable' | 'worse';
}

export function compareWithReference(
  plan: LayoutPlan,
  userHeads: LayoutHead[],
  referenceHeads: LayoutHead[],
  options: CoverageOptions = {},
): LayoutComparison {
  const user = evaluateLayout(plan, userHeads, options);
  const reference = evaluateLayout(plan, referenceHeads, options);

  const referenceCodes = new Set(reference.notes.map((n) => n.code));
  const extraIssues = user.notes.filter(
    (n) => n.severity !== 'info' && !referenceCodes.has(n.code),
  );

  // Полоса «сопоставимо» шириной 0,05 нужна, чтобы разница в одну ячейку
  // сетки не объявлялась победой или поражением.
  const delta = user.score - reference.score;
  const verdict = delta > 0.05 ? 'better' : delta < -0.05 ? 'worse' : 'comparable';

  return {
    userScore: user.score,
    referenceScore: reference.score,
    userCoverage: user.coverage.coverageRatio,
    referenceCoverage: reference.coverage.coverageRatio,
    userHeads: userHeads.length,
    referenceHeads: referenceHeads.length,
    userFlowM3h: user.summary.zoneFlowM3h,
    referenceFlowM3h: reference.summary.zoneFlowM3h,
    extraIssues,
    verdict,
  };
}

/** Площадь насаждений по типам — для подписи на плане. */
export function plantingAreas(plan: LayoutPlan): Array<{ kind: string; areaM2: number }> {
  return plan.plantings.map((p) => ({
    kind: p.kind,
    areaM2: round(polygonArea(p.polygon), 1),
  }));
}
