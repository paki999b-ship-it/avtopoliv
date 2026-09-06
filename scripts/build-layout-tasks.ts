/**
 * Сборка учебных заданий тренажёра раскладки (§3.4 ТЗ).
 *
 * Запуск:  node scripts/build-layout-tasks.ts
 * Выход:   content/layout/tasks.json
 *
 * ── Зачем скрипт, а не написанный вручную JSON ─────────────────────────────
 * §13 ТЗ требует, чтобы у каждого задания было поле `qa_verified = true`.
 * Проставить его руками — значит объявить решение проверенным, не проверив.
 * Здесь эталонные раскладки собираются генератором и тут же прогоняются через
 * расчётный движок: задание попадает в выгрузку, только если его эталон
 * действительно проходит проверки §3.4. Оценка и покрытие эталона пишутся в
 * `qaNotes`, так что проверку видно, а не нужно принимать на веру.
 *
 * Скрипт падает, если хоть один эталон не прошёл: сломанное задание не должно
 * попасть в приложение молча.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outDir = path.join(projectRoot, 'content', 'layout');

// Движок берётся из собранного `dist`, а не из исходников: Node не умеет
// разрешать импорты вида `./types.js`, которыми TypeScript ссылается на
// соседние модули. Перед запуском нужен `npm run build:core`.
const core: typeof import('@irrigo/core') = await import(
  pathToFileURL(path.join(projectRoot, 'packages', 'core', 'dist', 'index.js')).href
);

const {
  MIN_EDGE_CLEARANCE_M,
  distanceToPolygonEdge,
  evaluateLayout,
  pointInPolygon,
  polygonArea,
  rectangle,
  fmt,
  round,
} = core;

/** Требуемый отступ головы от кромки с запасом к минимуму из §3.4. */
const EDGE_CLEARANCE_M = MIN_EDGE_CLEARANCE_M * 1.5;

type LayoutPlan = import('@irrigo/core').LayoutPlan;
type LayoutHead = import('@irrigo/core').LayoutHead;
type LayoutPoint = import('@irrigo/core').LayoutPoint;
type EmitterClass = import('@irrigo/core').EmitterClass;

/** Точка внутри участка и не на препятствии. */
function isIrrigable(plan: LayoutPlan, point: LayoutPoint): boolean {
  if (!pointInPolygon(point, plan.boundary)) return false;
  return !plan.obstacles.some((o) => pointInPolygon(point, o.polygon));
}

/**
 * Подбор сектора головы по форме участка.
 *
 * Направления перебираются по кругу с шагом в градус; направление считается
 * «рабочим», если на половине радиуса в нём есть поливаемая площадь. Затем
 * берётся самая длинная непрерывная дуга рабочих направлений — это и есть
 * сектор, который надо раскрыть. Так угловая голова получает четверть круга,
 * краевая — половину, а внутренняя — полный круг, и всё это без ручной
 * расстановки углов в каждом задании.
 */
function autoSector(
  plan: LayoutPlan,
  position: LayoutPoint,
  radiusM: number,
): { startDeg: number; sweepDeg: number } {
  const probe = radiusM * 0.5;
  const usable: boolean[] = [];

  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    usable.push(
      isIrrigable(plan, {
        x: position.x + probe * Math.cos(rad),
        y: position.y + probe * Math.sin(rad),
      }),
    );
  }

  if (usable.every((u) => u)) return { startDeg: 0, sweepDeg: 360 };
  if (usable.every((u) => !u)) return { startDeg: 0, sweepDeg: 360 };

  let bestStart = 0;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  // Круг обходится дважды, чтобы поймать дугу, переходящую через ноль.
  for (let i = 0; i < 720; i += 1) {
    if (usable[i % 360]!) {
      if (currentStart < 0) currentStart = i;
      currentLength += 1;
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
      }
    } else {
      currentStart = -1;
      currentLength = 0;
    }
  }

  const sweep = Math.min(360, bestLength);
  // Небольшой раскрыв сверх найденной дуги: голова у кромки иначе не достаёт
  // до полосы за собой — сектор смотрит строго внутрь участка.
  const margin = sweep >= 355 ? 0 : 10;

  return {
    startDeg: ((bestStart - margin / 2) % 360 + 360) % 360,
    sweepDeg: Math.min(360, sweep + margin),
  };
}

/** Центр тяжести контура — направление, куда отодвигать головы от кромки. */
function centroid(points: LayoutPoint[]): LayoutPoint {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

/** Сдвигает точку внутрь участка, пока она не отойдёт от кромки на минимум. */
function pushInside(plan: LayoutPlan, point: LayoutPoint): LayoutPoint | null {
  if (distanceToPolygonEdge(point, plan.boundary) >= EDGE_CLEARANCE_M) return point;

  const target = centroid(plan.boundary.points);
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return point;

  for (let step = 1; step <= 10; step += 1) {
    const shift = (EDGE_CLEARANCE_M * step) / 2;
    const moved = {
      x: round(point.x + (dx / length) * shift, 2),
      y: round(point.y + (dy / length) * shift, 2),
    };
    if (
      isIrrigable(plan, moved) &&
      distanceToPolygonEdge(moved, plan.boundary) >= EDGE_CLEARANCE_M
    ) {
      return moved;
    }
  }

  return null;
}

/** Расход головы, пропорциональный сектору — согласованная интенсивность. */
function matchedFlow(fullCircleFlowLph: number, sweepDeg: number): number {
  return round((fullCircleFlowLph * sweepDeg) / 360, 0);
}

interface GridOptions {
  spacingM: number;
  radiusM: number;
  insetM: number;
  emitterClass: EmitterClass;
  /** Расход полнокруговой головы, л/ч. */
  fullCircleFlowLph: number;
  model: string;
}

/**
 * Раскладка по сетке: головы ставятся с шагом `spacingM`, начиная с отступа
 * `insetM` от габаритов участка. Точки вне поливаемой части отбрасываются.
 */
function gridLayout(plan: LayoutPlan, options: GridOptions): LayoutHead[] {
  const xs = plan.boundary.points.map((p) => p.x);
  const ys = plan.boundary.points.map((p) => p.y);
  const minX = Math.min(...xs) + options.insetM;
  const maxX = Math.max(...xs) - options.insetM;
  const minY = Math.min(...ys) + options.insetM;
  const maxY = Math.max(...ys) - options.insetM;

  const columns = Math.max(2, Math.round((maxX - minX) / options.spacingM) + 1);
  const rows = Math.max(2, Math.round((maxY - minY) / options.spacingM) + 1);

  const stepX = columns > 1 ? (maxX - minX) / (columns - 1) : 0;
  const stepY = rows > 1 ? (maxY - minY) / (rows - 1) : 0;

  const heads: LayoutHead[] = [];
  let index = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const raw = {
        x: round(minX + column * stepX, 2),
        y: round(minY + row * stepY, 2),
      };
      if (!isIrrigable(plan, raw)) continue;

      // На косой кромке точка сетки может оказаться вплотную к границе, хотя
      // от габаритов отступ выдержан. Сдвигаем её внутрь, к центру тяжести:
      // голова у самой кромки попадает под кромкорез и льёт за участок.
      const position = pushInside(plan, raw);
      if (position === null) continue;

      const sector = autoSector(plan, position, options.radiusM);
      index += 1;

      heads.push({
        id: `h${index}`,
        position,
        radiusM: options.radiusM,
        startDeg: round(sector.startDeg, 0),
        sweepDeg: round(sector.sweepDeg, 0),
        emitterClass: options.emitterClass,
        flowLph: matchedFlow(options.fullCircleFlowLph, sector.sweepDeg),
        model: options.model,
      });
    }
  }

  return heads;
}

interface TaskSpec {
  key: string;
  title: string;
  brief: string;
  difficulty: number;
  plan: LayoutPlan;
  grid: GridOptions;
  /** Чему учит задание — показывается после сравнения с эталоном. */
  lesson: string;
}

const L_SHAPE = {
  points: [
    { x: 0, y: 0 },
    { x: 18, y: 0 },
    { x: 18, y: 8 },
    { x: 8, y: 8 },
    { x: 8, y: 16 },
    { x: 0, y: 16 },
  ],
};

const TRIANGLE = {
  points: [
    { x: 0, y: 0 },
    { x: 18, y: 0 },
    { x: 0, y: 12 },
  ],
};

const TASKS: TaskSpec[] = [
  {
    key: 'layout-rect-small',
    title: 'Прямоугольный газон 12 × 8',
    brief:
      'Простой прямоугольный газон без препятствий. Задача — закрыть его целиком, ' +
      'соблюдая перекрытие «голова в голову».',
    difficulty: 1,
    plan: {
      boundary: rectangle(0, 0, 12, 8),
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 12, 8) }],
      sourceFlowM3h: 3,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4,
      radiusM: 4.4,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 300,
      model: 'Роторное сопло 6 м',
    },
    lesson:
      'На прямоугольнике достаточно поставить головы по углам и по серединам длинных ' +
      'сторон с шагом, равным радиусу. Угловая голова получает четверть круга, ' +
      'краевая — половину, и расход у них пропорционален сектору.',
  },
  {
    key: 'layout-strip',
    title: 'Полоса вдоль дорожки 16 × 3',
    brief:
      'Узкая полоса газона между дорожкой и забором. Роторы сюда не подойдут — ' +
      'у них минимальный радиус больше ширины полосы.',
    difficulty: 2,
    plan: {
      boundary: rectangle(0, 0, 16, 3),
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 16, 3) }],
      sourceFlowM3h: 2.5,
      workingPressureBar: 2.1,
    },
    grid: {
      spacingM: 3,
      radiusM: 3.2,
      insetM: 0.15,
      emitterClass: 'spray',
      fullCircleFlowLph: 260,
      model: 'Спрей 3 м',
    },
    lesson:
      'Узкая полоса требует малого радиуса: спрей с радиусом до 5 м закрывает такую ' +
      'геометрию, а ротор лил бы на дорожку и за забор.',
  },
  {
    key: 'layout-square-medium',
    title: 'Квадратный газон 16 × 16',
    brief:
      'Открытый квадрат среднего размера. Проверьте, укладывается ли расход зоны ' +
      'в 80 % дебита источника.',
    difficulty: 2,
    plan: {
      boundary: rectangle(0, 0, 16, 16),
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 16, 16) }],
      sourceFlowM3h: 6.5,
      workingPressureBar: 3.5,
    },
    grid: {
      spacingM: 5.5,
      radiusM: 6,
      insetM: 0.15,
      emitterClass: 'rotor',
      fullCircleFlowLph: 520,
      model: 'Ротор 8 м',
    },
    lesson:
      'На большом газоне выгоднее роторы: они закрывают ту же площадь меньшим числом ' +
      'голов. Но расход зоны надо сверять с дебитом — правило 80 процентов.',
  },
  {
    key: 'layout-house',
    title: 'Газон вокруг дома',
    brief:
      'Дом стоит внутри участка. Поливать по нему нельзя, а газон вокруг должен быть ' +
      'закрыт целиком.',
    difficulty: 3,
    plan: {
      boundary: rectangle(0, 0, 20, 14),
      obstacles: [{ kind: 'house', polygon: rectangle(6, 4, 8, 6), label: 'Дом' }],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 20, 14) }],
      sourceFlowM3h: 4,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4.5,
      radiusM: 5,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 320,
      model: 'Роторное сопло 5 м',
    },
    lesson:
      'Препятствие в середине участка заставляет обходить его головами по периметру. ' +
      'Головы вплотную к стене дома дают сектор, смотрящий от неё.',
  },
  {
    key: 'layout-path',
    title: 'Дорожка вдоль газона',
    brief:
      'Мощёная дорожка идёт вдоль края участка. Поливать её не нужно: мокрая плитка ' +
      'скользит и зеленеет, а зимой на ней образуется лёд.',
    difficulty: 3,
    plan: {
      boundary: rectangle(0, 0, 18, 12),
      obstacles: [{ kind: 'path', polygon: rectangle(0, 0, 18, 2), label: 'Дорожка' }],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 18, 12) }],
      sourceFlowM3h: 4.5,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4.5,
      radiusM: 5,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 320,
      model: 'Роторное сопло 5 м',
    },
    lesson:
      'Дорожку вдоль края обходят сектором: головы ближнего ряда отворачивают факел ' +
      'от плитки. Полностью сухой она не будет — соседние головы частично достают, — ' +
      'но основной полив уходит на газон.',
  },
  {
    key: 'layout-l-shape',
    title: 'L-образный участок',
    brief:
      'Невыпуклый контур: вырезанный угол легко оставить сухим или наоборот залить ' +
      'соседний участок.',
    difficulty: 3,
    plan: {
      boundary: L_SHAPE,
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: L_SHAPE }],
      sourceFlowM3h: 4,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4.5,
      radiusM: 5,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 320,
      model: 'Роторное сопло 5 м',
    },
    lesson:
      'У невыпуклого контура внутренний угол требует отдельного внимания: там сходятся ' +
      'сразу две кромки, и сектор головы приходится подбирать точнее.',
  },
  {
    key: 'layout-triangle',
    title: 'Треугольный участок',
    brief:
      'Острые углы — худшая геометрия для дождевания: круг в них не вписывается ' +
      'без перелива за границу.',
    difficulty: 4,
    plan: {
      boundary: TRIANGLE,
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: TRIANGLE }],
      sourceFlowM3h: 3,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 2.8,
      radiusM: 3.2,
      insetM: 0.2,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 190,
      model: 'Роторное сопло 3 м',
    },
    lesson:
      'В остром угле полностью избежать полива за границу невозможно. Задача — ' +
      'свести его к минимуму, а не к нулю: круглый факел в угол не вписывается.',
  },
  {
    key: 'layout-weak-source',
    title: 'Слабый источник',
    brief:
      'Дебит скважины всего 1,8 м³/ч. Газон закрыть надо, но расход зоны не должен ' +
      'превысить 80 % дебита.',
    difficulty: 4,
    plan: {
      boundary: rectangle(0, 0, 14, 10),
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 14, 10) }],
      sourceFlowM3h: 2.4,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4.5,
      radiusM: 5,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 260,
      model: 'Роторное сопло 7 м',
    },
    lesson:
      'При слабом дебите выигрывают головы с большим радиусом и малым расходом: ' +
      'меньше голов на ту же площадь означает меньший расход зоны.',
  },
  {
    key: 'layout-terrace',
    title: 'Газон с террасой и деревом',
    brief:
      'Два препятствия разной формы. Дерево поливается отдельной зоной, а террасу ' +
      'мочить нельзя.',
    difficulty: 4,
    plan: {
      boundary: rectangle(0, 0, 18, 14),
      obstacles: [
        { kind: 'terrace', polygon: rectangle(0, 0, 6, 4), label: 'Терраса' },
        { kind: 'other', polygon: rectangle(12, 9, 3, 3), label: 'Дерево' },
      ],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 18, 14) }],
      sourceFlowM3h: 4.5,
      workingPressureBar: 3,
    },
    grid: {
      spacingM: 4.5,
      radiusM: 5,
      insetM: 0.15,
      emitterClass: 'rotary_nozzle',
      fullCircleFlowLph: 320,
      model: 'Роторное сопло 5 м',
    },
    lesson:
      'Препятствия у кромки и в середине ведут себя по-разному: у кромки они лишь ' +
      'урезают сектор, а в середине заставляют обходить их с нескольких сторон.',
  },
  {
    key: 'layout-large-lawn',
    title: 'Большой газон 26 × 18',
    brief:
      'Участок, где счёт голов и расхода становится определяющим. Проверьте загрузку ' +
      'источника и число голов.',
    difficulty: 5,
    plan: {
      boundary: rectangle(0, 0, 26, 18),
      obstacles: [],
      plantings: [{ kind: 'lawn', polygon: rectangle(0, 0, 26, 18) }],
      sourceFlowM3h: 10,
      workingPressureBar: 3.5,
    },
    grid: {
      spacingM: 6.5,
      radiusM: 7,
      insetM: 0.15,
      emitterClass: 'rotor',
      fullCircleFlowLph: 620,
      model: 'Ротор 9 м',
    },
    lesson:
      'На большой площади каждая лишняя голова — это расход, который придётся вычесть ' +
      'из дебита. Радиус побольше при том же расходе почти всегда выгоднее.',
  },
];

/** Шаг сетки при проверке: мельче, чем в интерфейсе, — эталон должен быть надёжным. */
const QA_CELL_SIZE_M = 0.25;

/**
 * Проходная оценка задания. Должна совпадать с `LAYOUT_PASS_SCORE` в
 * репозитории тренажёра: эталон, не набирающий её, делает задание
 * непроходимым — ученику нечего превзойти.
 */
const PASS_SCORE = 0.75;

async function main() {
  const built: unknown[] = [];
  const failures: string[] = [];

  for (const task of TASKS) {
    const reference = gridLayout(task.plan, task.grid);
    const result = evaluateLayout(task.plan, reference, { cellSizeM: QA_CELL_SIZE_M });

    const errors = result.notes.filter((n) => n.severity === 'error');
    const warnings = result.notes.filter((n) => n.severity === 'warning');

    const qaVerified =
      errors.length === 0 &&
      result.coverage.coverageRatio >= 0.95 &&
      result.score >= PASS_SCORE;

    const qaNotes =
      `Эталон проверен расчётным движком при ячейке ${fmt(QA_CELL_SIZE_M, 2)} м: ` +
      `покрытие ${fmt(result.coverage.coverageRatio * 100, 1)} %, ` +
      `оценка ${fmt(result.score, 2)}, голов ${reference.length}, ` +
      `расход ${fmt(result.summary.zoneFlowM3h, 2)} м³/ч ` +
      `(${fmt(result.summary.sourceUtilisation * 100, 0)} % дебита), ` +
      `полив мимо цели ${fmt(result.coverage.wastedAreaM2, 1)} м². ` +
      (warnings.length > 0
        ? `Предупреждения: ${warnings.map((w) => w.code).join(', ')}.`
        : 'Предупреждений нет.');

    if (!qaVerified) {
      failures.push(
        `${task.key}: покрытие ${fmt(result.coverage.coverageRatio * 100, 1)} %, ` +
          `оценка ${fmt(result.score, 2)} при проходной ${fmt(PASS_SCORE, 2)}, ` +
          `ошибок ${errors.length}` +
          (errors.length > 0 ? ` (${errors.map((e) => e.code).join(', ')})` : ''),
      );
    }

    built.push({
      key: task.key,
      title: task.title,
      brief: task.brief,
      difficulty: task.difficulty,
      lesson: task.lesson,
      plan: task.plan,
      reference,
      qaVerified,
      qaNotes,
      qa: {
        coverageRatio: result.coverage.coverageRatio,
        score: result.score,
        heads: reference.length,
        zoneFlowM3h: result.summary.zoneFlowM3h,
        sourceUtilisation: result.summary.sourceUtilisation,
        wastedAreaM2: result.coverage.wastedAreaM2,
        warnings: warnings.map((w) => w.code),
      },
      areaM2: round(polygonArea(task.plan.boundary), 1),
    });

    console.log(
      `${qaVerified ? 'ok ' : 'ОШИБКА'} ${task.key}: ` +
        `покрытие ${fmt(result.coverage.coverageRatio * 100, 1)} %, ` +
        `оценка ${fmt(result.score, 2)}, голов ${reference.length}, ` +
        `расход ${fmt(result.summary.zoneFlowM3h, 2)} м³/ч, ` +
        `мимо ${fmt(result.coverage.wastedAreaM2, 1)} м²` +
        (warnings.length > 0 ? ` [${warnings.map((w) => w.code).join(', ')}]` : ''),
    );
  }

  if (failures.length > 0) {
    console.error('\nЭталонные решения не прошли проверку:');
    for (const line of failures) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'tasks.json'),
    `${JSON.stringify(
      {
        note:
          'Учебные задания тренажёра раскладки (§3.4 ТЗ). Собраны скриптом ' +
          'scripts/build-layout-tasks.ts: эталонные раскладки генерируются и тут же ' +
          'проверяются расчётным движком. Поле qaVerified вычислено, а не проставлено.',
        collectedAt: new Date().toISOString().slice(0, 10),
        qaCellSizeM: QA_CELL_SIZE_M,
        tasks: built,
      },
      null,
      1,
    )}\n`,
    'utf8',
  );

  console.log(`\nЗаданий собрано: ${built.length}, все эталоны прошли проверку.`);
}

await main();
