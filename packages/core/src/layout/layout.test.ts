import { describe, expect, it } from 'vitest';
import {
  angleInSector,
  boundingBox,
  distanceToPolygonEdge,
  headCovers,
  pointInPolygon,
  polygonArea,
  rectangle,
} from './geometry.js';
import type { LayoutHead, LayoutPlan } from './geometry.js';
import { coverage, drySpots, irrigableArea } from './coverage.js';
import { compareWithReference, evaluateLayout } from './checks.js';
import { round } from '../format.js';

/**
 * Тренажёр раскладки: геометрия, покрытие и замечания.
 *
 * Расчёт покрытия ведётся выборкой по сетке, поэтому главная проверка —
 * сходимость с аналитически известными площадями: квадрат, круг, сектор.
 * Если выборка сходится с ними, она сойдётся и на реальном участке.
 */

const head = (over: Partial<LayoutHead> & { id: string }): LayoutHead => ({
  position: { x: 0, y: 0 },
  radiusM: 5,
  startDeg: 0,
  sweepDeg: 360,
  emitterClass: 'spray',
  flowLph: 500,
  ...over,
});

const plan = (over: Partial<LayoutPlan> = {}): LayoutPlan => ({
  boundary: rectangle(0, 0, 10, 10),
  obstacles: [],
  plantings: [],
  sourceFlowM3h: 5,
  ...over,
});

describe('Геометрия плана', () => {
  it('считает площадь прямоугольника и треугольника', () => {
    expect(polygonArea(rectangle(0, 0, 10, 6))).toBe(60);
    expect(
      polygonArea({ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }] }),
    ).toBe(6);
  });

  it('площадь не зависит от направления обхода', () => {
    const forward = rectangle(0, 0, 5, 4);
    const backward = { points: [...forward.points].reverse() };
    expect(polygonArea(backward)).toBe(polygonArea(forward));
  });

  it('определяет точку внутри, снаружи и на границе', () => {
    const square = rectangle(0, 0, 10, 10);
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    // Точка на кромке считается внутренней: иначе край участка вдоль забора
    // выпадал бы из расчёта покрытия целиком.
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 10 }, square)).toBe(true);
  });

  it('работает с невыпуклым L-образным контуром', () => {
    const lShape = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 10 },
        { x: 0, y: 10 },
      ],
    };

    expect(polygonArea(lShape)).toBe(64);
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    // Вырезанный угол снаружи, хотя и внутри габаритного прямоугольника.
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false);
  });

  it('считает габаритный прямоугольник', () => {
    expect(boundingBox(rectangle(2, 3, 5, 4))).toEqual({
      minX: 2,
      minY: 3,
      maxX: 7,
      maxY: 7,
    });
  });

  it('считает расстояние до кромки, включая точки внутри', () => {
    const square = rectangle(0, 0, 10, 10);
    expect(distanceToPolygonEdge({ x: 5, y: 5 }, square)).toBe(5);
    expect(distanceToPolygonEdge({ x: 0.05, y: 5 }, square)).toBeCloseTo(0.05, 6);
  });
});

describe('Сектор дождевателя', () => {
  it('полный круг покрывает любой угол', () => {
    for (const deg of [0, 90, 180, 270, 359]) {
      expect(angleInSector(deg, 0, 360)).toBe(true);
    }
  });

  it('сектор 90° покрывает свой квадрант и не покрывает соседний', () => {
    expect(angleInSector(45, 0, 90)).toBe(true);
    expect(angleInSector(135, 0, 90)).toBe(false);
    // Сектор, переходящий через ноль.
    expect(angleInSector(350, 315, 90)).toBe(true);
    expect(angleInSector(20, 315, 90)).toBe(true);
    expect(angleInSector(180, 315, 90)).toBe(false);
  });

  it('голова покрывает точку по расстоянию и по сектору одновременно', () => {
    const h = head({ id: 'h', position: { x: 0, y: 0 }, radiusM: 5, startDeg: 0, sweepDeg: 90 });

    expect(headCovers(h, { x: 3, y: 3 })).toBe(true);
    // В секторе, но за радиусом.
    expect(headCovers(h, { x: 8, y: 1 })).toBe(false);
    // В радиусе, но вне сектора.
    expect(headCovers(h, { x: -3, y: -3 })).toBe(false);
    // Точка ровно под головой покрыта при любом секторе.
    expect(headCovers(h, { x: 0, y: 0 })).toBe(true);
  });
});

describe('Расчёт покрытия сходится с аналитической площадью', () => {
  it('полнокруговая голова в центре: покрытая площадь близка к площади круга', () => {
    const p = plan({ boundary: rectangle(0, 0, 20, 20) });
    const h = head({ id: 'h', position: { x: 10, y: 10 }, radiusM: 5, flowLph: 1000 });

    const result = coverage(p, [h], { cellSizeM: 0.2 });
    const analytic = Math.PI * 25;

    expect(result.coveredAreaM2).toBeGreaterThan(analytic * 0.97);
    expect(result.coveredAreaM2).toBeLessThan(analytic * 1.03);
  });

  it('сектор 90° покрывает четверть круга', () => {
    const p = plan({ boundary: rectangle(0, 0, 20, 20) });
    const h = head({
      id: 'h',
      position: { x: 10, y: 10 },
      radiusM: 6,
      startDeg: 0,
      sweepDeg: 90,
    });

    const result = coverage(p, [h], { cellSizeM: 0.2 });
    const analytic = (Math.PI * 36) / 4;

    expect(result.coveredAreaM2).toBeGreaterThan(analytic * 0.95);
    expect(result.coveredAreaM2).toBeLessThan(analytic * 1.05);
  });

  it('мельче сетка — точнее результат', () => {
    const p = plan({ boundary: rectangle(0, 0, 20, 20) });
    const h = head({ id: 'h', position: { x: 10, y: 10 }, radiusM: 5 });
    const analytic = Math.PI * 25;

    const coarse = coverage(p, [h], { cellSizeM: 1 });
    const fine = coverage(p, [h], { cellSizeM: 0.2 });

    expect(Math.abs(fine.coveredAreaM2 - analytic)).toBeLessThan(
      Math.abs(coarse.coveredAreaM2 - analytic),
    );
  });

  it('поливаемая площадь — это контур минус препятствия', () => {
    const p = plan({
      boundary: rectangle(0, 0, 20, 10),
      obstacles: [{ kind: 'house', polygon: rectangle(0, 0, 5, 4) }],
    });

    expect(irrigableArea(p)).toBe(200 - 20);

    const result = coverage(p, [], { cellSizeM: 0.25 });
    expect(result.irrigableAreaM2).toBeGreaterThan(175);
    expect(result.irrigableAreaM2).toBeLessThan(185);
  });

  it('считает перекрытие двух голов', () => {
    const p = plan({ boundary: rectangle(0, 0, 20, 10) });
    const heads = [
      head({ id: 'a', position: { x: 7, y: 5 }, radiusM: 5 }),
      head({ id: 'b', position: { x: 13, y: 5 }, radiusM: 5 }),
    ];

    const result = coverage(p, heads, { cellSizeM: 0.2 });
    expect(result.overlapAreaM2).toBeGreaterThan(0);
    // Перекрытие не может быть больше покрытия.
    expect(result.overlapAreaM2).toBeLessThan(result.coveredAreaM2);
  });

  it('видит полив за границу участка', () => {
    const p = plan({ boundary: rectangle(0, 0, 10, 10) });
    // Голова в углу с полным кругом: три четверти факела уходят наружу.
    const h = head({ id: 'h', position: { x: 0.5, y: 0.5 }, radiusM: 5 });

    const result = coverage(p, [h], { cellSizeM: 0.25 });
    expect(result.wastedAreaM2).toBeGreaterThan(20);
  });

  it('пустая раскладка не покрывает ничего', () => {
    const result = coverage(plan(), [], { cellSizeM: 0.5 });
    expect(result.coveredAreaM2).toBe(0);
    expect(result.coverageRatio).toBe(0);
    expect(result.uncoveredAreaM2).toBeGreaterThan(90);
  });

  it('не принимает нулевой шаг сетки', () => {
    expect(() => coverage(plan(), [], { cellSizeM: 0 })).toThrow(/больше нуля/);
  });
});

describe('Сухие пятна', () => {
  it('соседние непокрытые ячейки сливаются в одно пятно', () => {
    const p = plan({ boundary: rectangle(0, 0, 20, 10) });
    // Две головы по краям оставляют одно пятно посередине.
    const heads = [
      head({ id: 'a', position: { x: 3, y: 5 }, radiusM: 3 }),
      head({ id: 'b', position: { x: 17, y: 5 }, radiusM: 3 }),
    ];

    const spots = drySpots(coverage(p, heads, { cellSizeM: 0.5 }));
    expect(spots.length).toBeGreaterThan(0);
    // Пятна отсортированы от крупного к мелкому.
    for (let i = 1; i < spots.length; i += 1) {
      expect(spots[i]!.areaM2).toBeLessThanOrEqual(spots[i - 1]!.areaM2);
    }
    expect(spots[0]!.areaM2).toBeGreaterThan(50);
  });

  it('полностью покрытый участок не даёт пятен', () => {
    const p = plan({ boundary: rectangle(0, 0, 4, 4) });
    const h = head({ id: 'h', position: { x: 2, y: 2 }, radiusM: 10 });

    expect(drySpots(coverage(p, [h], { cellSizeM: 0.25 }))).toEqual([]);
  });
});

describe('Замечания тренажёра (§3.4)', () => {
  const codes = (notes: Array<{ code: string }>) => notes.map((n) => n.code);

  it('пустой план подсказывает, что делать, а не молчит', () => {
    const result = evaluateLayout(plan(), []);
    expect(codes(result.notes)).toContain('layout-empty');
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it('шаг больше радиуса — ошибка про сухие пятна', () => {
    const p = plan({ boundary: rectangle(0, 0, 30, 10) });
    const heads = [
      head({ id: 'a', position: { x: 3, y: 5 }, radiusM: 4 }),
      head({ id: 'b', position: { x: 15, y: 5 }, radiusM: 4 }),
      head({ id: 'c', position: { x: 27, y: 5 }, radiusM: 4 }),
    ];

    const result = evaluateLayout(p, heads, { cellSizeM: 0.5 });
    expect(codes(result.notes)).toContain('layout-spacing-too-wide');
    expect(codes(result.notes)).toContain('layout-uncovered');
    expect(result.passed).toBe(false);
  });

  it('широкий шаг не отмечается, если участок всё равно покрыт целиком', () => {
    // Угловые головы стоят в 11 м друг от друга при радиусе 9 — формально
    // «шаг больше радиуса», но сухих мест нет, и придираться не к чему.
    const p = plan({ boundary: rectangle(0, 0, 12, 12), sourceFlowM3h: 5 });
    const heads = [
      head({ id: '1', position: { x: 0.15, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 355, flowLph: 200 }),
      head({ id: '2', position: { x: 11.85, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 85, flowLph: 200 }),
      head({ id: '3', position: { x: 11.85, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 175, flowLph: 200 }),
      head({ id: '4', position: { x: 0.15, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 265, flowLph: 200 }),
    ];

    const result = evaluateLayout(p, heads, { cellSizeM: 0.25 });
    expect(result.summary.spacingToRadius).toBeGreaterThan(1.15);
    expect(codes(result.notes)).not.toContain('layout-spacing-too-wide');
  });

  it('смешанные классы оборудования — ошибка', () => {
    const p = plan();
    const heads = [
      head({ id: 'a', position: { x: 3, y: 5 }, emitterClass: 'rotor' }),
      head({ id: 'b', position: { x: 7, y: 5 }, emitterClass: 'spray' }),
    ];

    const note = evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes.find(
      (n) => n.code === 'layout-mixed-classes',
    );

    expect(note).toBeDefined();
    expect(note!.severity).toBe('error');
    expect(note!.message).toMatch(/ротор/);
    expect(note!.message).toMatch(/спре/);
  });

  it('несогласованные сектора: полнокруговое сопло на угловой голове', () => {
    const p = plan();
    const heads = [
      head({ id: 'full', position: { x: 5, y: 5 }, sweepDeg: 360, flowLph: 800 }),
      // Тот же расход на четверть круга — вчетверо больше воды на угол.
      head({ id: 'corner', position: { x: 2, y: 2 }, sweepDeg: 90, flowLph: 800 }),
    ];

    expect(codes(evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes)).toContain(
      'layout-unmatched-pr',
    );
  });

  it('согласованный комплект сопел замечания не вызывает', () => {
    const p = plan();
    const heads = [
      head({ id: 'full', position: { x: 5, y: 5 }, sweepDeg: 360, flowLph: 800 }),
      head({ id: 'half', position: { x: 2, y: 5 }, sweepDeg: 180, flowLph: 400 }),
      head({ id: 'quarter', position: { x: 2, y: 2 }, sweepDeg: 90, flowLph: 200 }),
    ];

    expect(codes(evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes)).not.toContain(
      'layout-unmatched-pr',
    );
  });

  it('расход зоны выше 80 % дебита — ошибка', () => {
    const p = plan({ sourceFlowM3h: 2 });
    const heads = [
      head({ id: 'a', position: { x: 3, y: 5 }, flowLph: 900 }),
      head({ id: 'b', position: { x: 7, y: 5 }, flowLph: 900 }),
    ];

    const note = evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes.find(
      (n) => n.code === 'layout-flow-over-source',
    );

    expect(note).toBeDefined();
    // 1,8 м³/ч против предела 1,6 м³/ч.
    expect(note!.message).toMatch(/1,80/);
  });

  it('голова у самой кромки — предупреждение', () => {
    const p = plan();
    const heads = [head({ id: 'edge', position: { x: 0.05, y: 5 }, radiusM: 6 })];

    expect(codes(evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes)).toContain(
      'layout-head-at-edge',
    );
  });

  it('голова на препятствии или за участком — ошибка', () => {
    const p = plan({
      obstacles: [{ kind: 'path', polygon: rectangle(4, 4, 2, 2) }],
    });

    const onPath = evaluateLayout(p, [head({ id: 'p', position: { x: 5, y: 5 } })], {
      cellSizeM: 0.5,
    });
    expect(codes(onPath.notes)).toContain('layout-head-on-obstacle');

    const outside = evaluateLayout(p, [head({ id: 'o', position: { x: 50, y: 50 } })], {
      cellSizeM: 0.5,
    });
    expect(codes(outside.notes)).toContain('layout-head-on-obstacle');
  });

  it('полив за границу участка отмечается отдельно', () => {
    const p = plan({ boundary: rectangle(0, 0, 10, 10) });
    const heads = [head({ id: 'corner', position: { x: 1, y: 1 }, radiusM: 6 })];

    expect(codes(evaluateLayout(p, heads, { cellSizeM: 0.25 }).notes)).toContain(
      'layout-watering-outside',
    );
  });

  it('полив по своей дорожке и полив за забор — разные замечания', () => {
    // Полив по дорожке — всегда дефект проекта, полив за границу неизбежен
    // частично: круглый факел не вписывается в прямой угол.
    const withPath = plan({
      boundary: rectangle(0, 0, 20, 12),
      obstacles: [{ kind: 'path', polygon: rectangle(0, 5, 20, 2) }],
    });
    const overPath = [head({ id: 'p', position: { x: 10, y: 2 }, radiusM: 7 })];

    const notes = evaluateLayout(withPath, overPath, { cellSizeM: 0.25 }).notes;
    expect(codes(notes)).toContain('layout-watering-obstacles');

    const cover = evaluateLayout(withPath, overPath, { cellSizeM: 0.25 }).coverage;
    expect(cover.wastedOnObstaclesM2).toBeGreaterThan(0);
    expect(cover.wastedAreaM2).toBe(
      round(cover.wastedOnObstaclesM2 + cover.wastedOutsideM2, 1),
    );
  });

  it('у каждого замечания есть и причина, и способ исправить (§5.16)', () => {
    const p = plan({ sourceFlowM3h: 1 });
    const heads = [
      head({ id: 'a', position: { x: 0.05, y: 5 }, emitterClass: 'rotor', flowLph: 900 }),
      head({ id: 'b', position: { x: 9, y: 5 }, emitterClass: 'spray', flowLph: 900, sweepDeg: 90 }),
    ];

    const notes = evaluateLayout(p, heads, { cellSizeM: 0.5 }).notes.filter(
      (n) => n.severity !== 'info',
    );

    expect(notes.length).toBeGreaterThan(2);
    for (const note of notes) {
      expect(note.why, note.code).toBeTruthy();
      expect(note.fix, note.code).toBeTruthy();
      expect(note.lessonKey, note.code).toBeTruthy();
    }
  });

  it('хорошая раскладка проходит и получает высокую оценку', () => {
    const p = plan({ boundary: rectangle(0, 0, 12, 12), sourceFlowM3h: 5 });
    // Сетка 6×6 м при радиусе 6 м — перекрытие «голова в голову».
    const heads = [
      head({ id: '1', position: { x: 0.15, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 355, flowLph: 200 }),
      head({ id: '2', position: { x: 11.85, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 85, flowLph: 200 }),
      head({ id: '3', position: { x: 11.85, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 175, flowLph: 200 }),
      head({ id: '4', position: { x: 0.15, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 265, flowLph: 200 }),
    ];

    const result = evaluateLayout(p, heads, { cellSizeM: 0.25 });
    expect(result.coverage.coverageRatio).toBeGreaterThan(0.95);
    expect(result.notes.filter((n) => n.severity === 'error')).toHaveLength(0);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('перелив снижает оценку постепенно, а не обрывом', () => {
    // Шкала перелива привязана к порогам замечаний: раскладка не должна
    // терять весь балл за то, на что движок ещё не жалуется.
    const p = plan({ boundary: rectangle(0, 0, 20, 20), sourceFlowM3h: 10 });

    const tidy = [head({ id: 'a', position: { x: 10, y: 10 }, radiusM: 9, flowLph: 400 })];
    const sloppy = [head({ id: 'b', position: { x: 2, y: 2 }, radiusM: 9, flowLph: 400 })];

    const tidyScore = evaluateLayout(p, tidy, { cellSizeM: 0.5 }).score;
    const sloppyScore = evaluateLayout(p, sloppy, { cellSizeM: 0.5 }).score;

    expect(sloppyScore).toBeLessThan(tidyScore);
    expect(sloppyScore).toBeGreaterThan(0);
  });

  it('сводка считает расход, загрузку источника и интенсивность', () => {
    const p = plan({ boundary: rectangle(0, 0, 12, 12), sourceFlowM3h: 4 });
    const heads = [
      head({ id: 'a', position: { x: 4, y: 6 }, radiusM: 6, flowLph: 1000 }),
      head({ id: 'b', position: { x: 8, y: 6 }, radiusM: 6, flowLph: 1000 }),
    ];

    const { summary } = evaluateLayout(p, heads, { cellSizeM: 0.25 });

    expect(summary.headCount).toBe(2);
    expect(summary.zoneFlowLph).toBe(2000);
    expect(summary.zoneFlowM3h).toBe(2);
    expect(summary.sourceUtilisation).toBe(0.5);
    expect(summary.meanSpacingM).toBe(4);
    expect(summary.spacingToRadius).toBeCloseTo(4 / 6, 2);
    expect(summary.precipitationRateMmH).toBeGreaterThan(0);
  });
});

describe('Сравнение с эталоном (§3.4)', () => {
  const p = plan({ boundary: rectangle(0, 0, 12, 12), sourceFlowM3h: 5 });

  const reference: LayoutHead[] = [
    head({ id: 'r1', position: { x: 0.15, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 355, flowLph: 200 }),
    head({ id: 'r2', position: { x: 11.85, y: 0.15 }, radiusM: 9, sweepDeg: 100, startDeg: 85, flowLph: 200 }),
    head({ id: 'r3', position: { x: 11.85, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 175, flowLph: 200 }),
    head({ id: 'r4', position: { x: 0.15, y: 11.85 }, radiusM: 9, sweepDeg: 100, startDeg: 265, flowLph: 200 }),
  ];

  it('слабая раскладка признаётся хуже эталона', () => {
    const weak = [head({ id: 'u1', position: { x: 6, y: 6 }, radiusM: 3, flowLph: 400 })];
    const result = compareWithReference(p, weak, reference, { cellSizeM: 0.5 });

    expect(result.verdict).toBe('worse');
    expect(result.userCoverage).toBeLessThan(result.referenceCoverage);
    expect(result.extraIssues.length).toBeGreaterThan(0);
  });

  it('повторение эталона признаётся сопоставимым', () => {
    const result = compareWithReference(p, reference, reference, { cellSizeM: 0.5 });

    expect(result.verdict).toBe('comparable');
    expect(result.userScore).toBe(result.referenceScore);
    expect(result.extraIssues).toEqual([]);
  });

  it('показывает только те замечания, которых у эталона нет', () => {
    const withMixedClasses = [
      ...reference,
      head({ id: 'extra', position: { x: 6, y: 6 }, emitterClass: 'rotor', flowLph: 100 }),
    ];

    const result = compareWithReference(p, withMixedClasses, reference, { cellSizeM: 0.5 });
    expect(result.extraIssues.map((n) => n.code)).toContain('layout-mixed-classes');
  });
});
