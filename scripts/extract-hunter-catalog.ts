/**
 * Извлечение таблиц производительности из каталога Hunter, издание 41 (RU)
 * в таблицу `equipment_nozzles` (ТЗ §8 п.1, §7).
 *
 * Запуск:  node scripts/extract-hunter-catalog.ts
 * Выход:   content/reference/hunter-nozzles.json
 *          content/reference/hunter-nozzles-qa.md  (отчёт о сверке)
 *
 * ── Структура таблиц каталога ──────────────────────────────────────────────
 * На странице стоят рядом 1–3 блока. У каждого блока колонки:
 *   [Давление бар] [кПа] [Радиус м] [Поток м³/ч] [Поток л/мин] [Инт.□] [Инт.△]
 * Колонка давления есть либо у каждого блока (таблицы роторов), либо одна
 * общая слева (таблицы MP Rotator и форсунок Pro). Слева от блоков — колонка
 * ключа строки: номер насадки с цветом (роторы) или сектор (MP Rotator, Pro).
 *
 * ── Проверка интенсивности (ключевой момент §8 п.1 ТЗ) ─────────────────────
 * Каталожная интенсивность воспроизводится формулой
 *     PR□ = q · (360 / сектор) / R²      PR△ = PR□ / 0,866
 * при шаге «радиус в радиус» (S = R). Для таблиц роторов, где колонки сектора
 * нет, тождество выполняется при секторе 180° — это и есть правило ТЗ
 * «интенсивность в каталоге приводится для сектора 180°, для 360° делить на 2».
 *
 * Формула применяется к КАЖДОЙ извлечённой строке. Строка, где расчёт не
 * сходится с напечатанным значением, попадает в отчёт как расхождение и не
 * считается проверенной. Это заменяет выборочный просмотр сплошной сверкой.
 *
 * ── Какая колонка расхода опорная ──────────────────────────────────────────
 * Каталог печатает расход дважды: в м³/ч и в л/мин. Ни одна из колонок не
 * надёжна сама по себе. У м³/ч всего два знака после запятой — для мелких
 * форсунок 0,04 м³/ч это ±12 % неопределённости. В л/мин знаков больше, но на
 * отдельных страницах текстовый слой PDF отдаёт по этой колонке искажённые
 * значения (стр. 27), а на других — по колонке м³/ч (стр. 29, «3,08» читается
 * как «30,8»).
 *
 * Поэтому строка проверяется по ОБЕИМ колонкам, и засчитывается, если хотя бы
 * одна из них сходится с двумя напечатанными интенсивностями. Это три
 * независимых печатных числа против двух — совпадение случайным не бывает.
 * В выгрузку попадает та колонка, которая сошлась; какая именно — записано в
 * поле `flowSource`.
 *
 * ── Дополнительный инвариант ───────────────────────────────────────────────
 * Треугольная раскладка всегда даёт интенсивность выше квадратной ровно в
 * 1/0,866 = 1,155 раза. Строка, где это нарушено, помечается как сбой разбора.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outDir = path.join(projectRoot, 'content', 'reference');

const pdfText: typeof import('./lib/pdf-text.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'pdf-text.mjs')).href
);
const { toRows, rowText } = pdfText;

/*
 * Каталог лежит в `/content` частями, поэтому страницы читаются через
 * читалку со сквозной нумерацией полос издания: спецификации ниже задают
 * номер полосы каталога, а не лист внутри файла-части.
 */
const catalogLib: typeof import('./lib/hunter-catalog.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'hunter-catalog.mjs')).href
);
const { openCatalog } = catalogLib;

/** Множитель площади треугольной раскладки. */
const TRIANGULAR_FACTOR = 0.866;

type Archetype = 'rotor' | 'sector';

interface PageSpec {
  page: number;
  archetype: Archetype;
  /** Семейство дождевателей — попадает в поле `model`. */
  family: string;
  /** Класс оборудования для связи с расчётным движком. */
  emitterClass: 'rotor' | 'spray' | 'rotary_nozzle';
  /** Подпись каждого блока слева направо — попадает в поле `nozzle`. */
  blocks: string[];
  /**
   * Сектор, к которому отнесена каталожная интенсивность, если колонки
   * сектора в таблице нет. По умолчанию 180° (правило ТЗ §8 п.1).
   * Значение задаётся на блок: на одной странице базовый сектор у соседних
   * таблиц может различаться (стр. 37: I-90-ADV — 180°, I-90-36V — 360°).
   */
  assumedSectorDeg?: number[];
  /** Сколько колонок интенсивности в блоке: 2 (обычно) или 0. */
  prColumns?: 0 | 2;
}

/**
 * Страницы с таблицами производительности.
 * Подписи блоков выверены по заголовкам самих страниц каталога.
 */
const PAGE_SPECS: PageSpec[] = [
  { page: 17, archetype: 'rotor', family: 'PGJ', emitterClass: 'rotor', blocks: ['насадки PGJ'] },
  {
    page: 20,
    archetype: 'rotor',
    family: 'PGP-ADJ',
    emitterClass: 'rotor',
    blocks: ['синие форсунки PGP-ADJ-B', 'серые форсунки с малым углом PGP-ADJ'],
  },
  {
    page: 21,
    archetype: 'rotor',
    family: 'PGP-ADJ',
    emitterClass: 'rotor',
    blocks: ['красные форсунки PGP-ADJ (1)', 'красные форсунки PGP-ADJ (2)'],
  },
  {
    page: 25,
    archetype: 'rotor',
    family: 'PGP Ultra / I-20 / PRB',
    emitterClass: 'rotor',
    blocks: ['синие стандартные насадки', 'серые насадки с малым углом'],
  },
  {
    page: 26,
    archetype: 'rotor',
    family: 'PGP Ultra / I-20 / PRB',
    emitterClass: 'rotor',
    blocks: ['зелёные насадки с высоким расходом', 'чёрные насадки с коротким радиусом'],
  },
  {
    page: 27,
    archetype: 'rotor',
    family: 'PGP Ultra / I-20 / PRB',
    emitterClass: 'rotor',
    blocks: ['форсунки MPR-25', 'форсунки MPR-35'],
  },
  {
    page: 29,
    archetype: 'rotor',
    family: 'I-25',
    emitterClass: 'rotor',
    blocks: ['стандартные насадки I-25 (1)', 'стандартные насадки I-25 (2)'],
  },
  {
    page: 30,
    archetype: 'rotor',
    family: 'I-25',
    emitterClass: 'rotor',
    blocks: ['высокоскоростные насадки I-25 (1)', 'высокоскоростные насадки I-25 (2)'],
  },
  {
    page: 32,
    archetype: 'rotor',
    family: 'I-40',
    emitterClass: 'rotor',
    blocks: ['стандартные насадки I-40', 'высокоскоростные насадки I-40'],
  },
  {
    page: 33,
    archetype: 'rotor',
    family: 'I-40',
    emitterClass: 'rotor',
    blocks: ['двойные противонаправленные насадки I-40'],
    // Две струи в противоположные стороны дают полный круг.
    assumedSectorDeg: [360],
  },
  {
    page: 37,
    archetype: 'rotor',
    family: 'I-90',
    emitterClass: 'rotor',
    blocks: ['насадки I-90-ADV', 'насадки I-90-36V'],
    assumedSectorDeg: [180, 360],
  },
  {
    page: 53,
    archetype: 'sector',
    family: 'MP Rotator',
    emitterClass: 'rotary_nozzle',
    blocks: ['MP-1000', 'MP-2000', 'MP-3000'],
  },
  {
    page: 54,
    archetype: 'sector',
    family: 'MP Rotator',
    emitterClass: 'rotary_nozzle',
    blocks: ['MP-3500'],
  },
  {
    page: 55,
    archetype: 'sector',
    family: 'MP Rotator',
    emitterClass: 'rotary_nozzle',
    blocks: ['MP Corner'],
    // У этой таблицы нет колонок интенсивности: каталог печатает для
    // MP Corner одно общее значение над таблицей.
    prColumns: 0,
  },
  {
    page: 57,
    archetype: 'sector',
    family: 'MP Rotator',
    emitterClass: 'rotary_nozzle',
    blocks: ['MP-800SR', 'MP-815', 'MP-820'],
  },
  {
    page: 65,
    archetype: 'sector',
    family: 'PS Ultra + форсунка Pro',
    emitterClass: 'spray',
    blocks: ['радиус 2,4 м', 'радиус 3,0 м', 'радиус 3,7 м'],
  },
  {
    page: 66,
    archetype: 'sector',
    family: 'PS Ultra + форсунка Pro',
    emitterClass: 'spray',
    blocks: ['радиус 4,6 м', 'радиус 5,2 м'],
  },
  {
    page: 75,
    archetype: 'sector',
    family: 'Высокоэффективные форсунки Pro',
    emitterClass: 'spray',
    blocks: ['15A-HE, радиус 4,6 м', '17A-HE, радиус 5,2 м'],
  },
  {
    page: 77,
    archetype: 'sector',
    family: 'Форсунки Pro с фиксированным сектором',
    emitterClass: 'spray',
    blocks: ['радиус 1,5 м', 'радиус 2,4 м', 'радиус 3,0 м'],
  },
];

interface NozzleRow {
  brand: string;
  model: string;
  nozzle: string;
  sectorDeg: number;
  /** Сектор взят из таблицы (true) или принят равным 180° по правилу §8 (false). */
  sectorFromTable: boolean;
  pressureBar: number;
  pressureKpa: number;
  radiusM: number;
  flowM3h: number;
  flowLmin: number;
  /** Интенсивность при квадратной раскладке, мм/ч — как напечатано в каталоге. */
  prSquareMmH: number | null;
  /** Интенсивность при треугольной раскладке, мм/ч — как напечатано. */
  prTriangleMmH: number | null;
  emitterClass: string;
  sourcePage: number;
  /** Расчётная PR□ по формуле — для сверки. */
  checkPrSquare: number | null;
  /** Расчётная PR△ по формуле — для сверки. */
  checkPrTriangle: number | null;
  /** Какая колонка расхода сошлась с интенсивностями: «м³/ч» или «л/мин». */
  flowSource: 'm3h' | 'lmin' | null;
  /** Сошлись ли обе напечатанные интенсивности с расчётом. */
  verified: boolean;
  /** Причина, по которой строка не прошла сверку. */
  issue: string | null;
  source: string;
}

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

interface Block {
  index: number;
  /** Левая граница колонок с числами. */
  startX: number;
  /** Правая граница колонок с числами. */
  endX: number;
  /** Левая граница колонки подписи (номер насадки либо сектор). */
  keyStartX: number;
  /** Правая граница колонки подписи. */
  keyEndX: number;
  hasPressure: boolean;
}

/** Разбирает страницу и возвращает строки таблиц. */
async function extractPage(
  catalog: { items: (page: number) => Promise<unknown[]> },
  spec: PageSpec,
): Promise<NozzleRow[]> {
  const items = await catalog.items(spec.page);
  const rows = toRows(items);

  const header = rows.find(
    (r) =>
      r.items.some((i) => /Радиус/.test(i.str)) && r.items.some((i) => /Поток|Расход/.test(i.str)),
  );
  if (!header) throw new Error(`стр. ${spec.page}: не найден заголовок таблицы`);

  const radiusAnchors = header.items.filter((i) => /Радиус/.test(i.str)).map((i) => i.x);
  const pressureAnchors = header.items.filter((i) => /Давление/.test(i.str)).map((i) => i.x);
  if (radiusAnchors.length !== spec.blocks.length) {
    throw new Error(
      `стр. ${spec.page}: блоков в заголовке ${radiusAnchors.length}, в описании ${spec.blocks.length}`,
    );
  }

  // Левая граница блока берётся с запасом: числа колонки давления печатаются
  // чуть левее слова «Давление» в шапке.
  const LEFT_PAD = 16;
  // Колонка подписи. На страницах с двумя таблицами она своя у каждой из них
  // («Насадка» стоит в шапке дважды), на страницах MP Rotator и форсунок Pro —
  // одна общая слева («Сектор»).
  const keyAnchors = header.items.filter((i) => /Насадка|Сектор/.test(i.str)).map((i) => i.x);
  const perBlockKeys = keyAnchors.length === radiusAnchors.length;

  const blocks: Block[] = radiusAnchors.map((rx, idx) => {
    const own = pressureAnchors.find((px) => px < rx && (idx === 0 || px > radiusAnchors[idx - 1]!));
    const keyX = perBlockKeys ? keyAnchors[idx]! : (keyAnchors[0] ?? 0);
    return {
      index: idx,
      startX: (own ?? rx) - LEFT_PAD,
      endX: Number.POSITIVE_INFINITY,
      keyStartX: perBlockKeys ? keyX - 12 : 0,
      // При общей колонке подписи (таблицы MP Rotator и форсунок Pro) её
      // границы одни и те же для всех блоков — иначе в подпись правых блоков
      // попадут числа левых.
      keyEndX: perBlockKeys ? (own ?? rx) - LEFT_PAD : Number.NaN,
      hasPressure: own !== undefined,
    };
  });
  // Числовые колонки блока заканчиваются там, где начинается подпись следующего
  // блока: иначе номер насадки соседней таблицы попадает в этот блок лишним
  // числом и строка теряется целиком.
  for (let i = 0; i < blocks.length - 1; i++) {
    const next = blocks[i + 1]!;
    blocks[i]!.endX = perBlockKeys ? next.keyStartX : next.startX;
  }
  if (!perBlockKeys) {
    const sharedEnd = blocks[0]!.startX;
    for (const b of blocks) b.keyEndX = sharedEnd;
  }
  const prCols = spec.prColumns ?? 2;
  const expected = (b: Block) => (b.hasPressure ? 5 : 3) + prCols;

  const numsIn = (r: { items: { str: string; x: number }[] }, b: Block) =>
    r.items
      .filter((i) => i.x >= b.startX && i.x < b.endX)
      .map((i) => num(i.str))
      .filter((v): v is number => v !== null);

  // Строки данных: ниже заголовка, с ожидаемым числом колонок в первом блоке.
  const dataRows = rows.filter(
    (r) => r.y > header.y && numsIn(r, blocks[0]!).length === expected(blocks[0]!),
  );
  if (dataRows.length === 0) return [];

  // Группируем строки данных по насадке/сектору: новая группа начинается там,
  // где давление перестало расти.
  const groups: (typeof dataRows)[] = [];
  let prevBar = Number.POSITIVE_INFINITY;
  for (const r of dataRows) {
    const bar = numsIn(r, blocks[0]!)[0]!;
    if (bar <= prevBar) groups.push([]);
    prevBar = bar;
    groups.at(-1)!.push(r);
  }

  const out: NozzleRow[] = [];

  for (const group of groups) {
    // Подпись группы (номер насадки с цветом либо сектор) может стоять и на
    // строке данных, и отдельной строкой между ними — поэтому собираем её со
    // всех строк, попадающих в вертикальный диапазон группы.
    const yMin = group[0]!.y - 6;
    const yMax = group.at(-1)!.y + 6;

    /** Подпись группы для конкретного блока. */
    const keyFor = (b: Block): string => {
      const parts: string[] = [];
      for (const r of rows) {
        if (r.y < yMin || r.y > yMax) continue;
        for (const i of r.items) {
          if (i.x < b.keyStartX - 2 || i.x >= b.keyEndX - 2) continue;
          const t = i.str.trim();
          if (t && !parts.includes(t)) parts.push(t);
        }
      }
      return parts.join(' ').trim();
    };
    const keys = new Map(blocks.map((b) => [b.index, keyFor(b)]));
    // Базовый сектор задаётся на блок — вычисляется ниже, внутри цикла по блокам.

    for (const r of group) {
      const first = numsIn(r, blocks[0]!);
      const sharedBar = first[0]!;
      const sharedKpa = first[1]!;

      for (const b of blocks) {
        const v = numsIn(r, b);
        if (v.length !== expected(b)) continue;

        const key = keys.get(b.index) ?? '';
        const sectorMatch = key.match(/(\d{2,3})\s*°/);
        const sectorFromTable = sectorMatch !== null;
        const sectorDeg = sectorFromTable
          ? Number(sectorMatch[1])
          : (spec.assumedSectorDeg?.[b.index] ?? 180);

        let pressureBar: number;
        let pressureKpa: number;
        let radiusM: number;
        let flowM3h: number;
        let flowLmin: number;
        let prSq: number | null;
        let prTri: number | null;

        let rest: number[];
        if (b.hasPressure) {
          pressureBar = v[0]!;
          pressureKpa = v[1]!;
          rest = v.slice(2);
        } else {
          pressureBar = sharedBar;
          pressureKpa = sharedKpa;
          rest = v;
        }
        radiusM = rest[0]!;
        flowM3h = rest[1]!;
        flowLmin = rest[2]!;
        prSq = prCols === 2 ? rest[3]! : null;
        prTri = prCols === 2 ? rest[4]! : null;

        if (!(radiusM > 0)) continue;

        const flowFromLmin = flowLmin * 60;
        const flowFromM3h = flowM3h * 1000;
        const tol = (v: number) => 0.5 + 0.04 * v;

        /** Насколько хорошо расход согласуется с напечатанными PR. */
        const assess = (flowLh: number) => {
          if (!(flowLh > 0)) return null;
          const sq = (flowLh * (360 / sectorDeg)) / radiusM ** 2;
          const tri = sq / TRIANGULAR_FACTOR;
          if (prSq === null || prTri === null) return { sq, tri, ok: false, err: Infinity };
          const errSq = Math.abs(sq - prSq) - tol(sq);
          const errTri = Math.abs(tri - prTri) - tol(tri);
          return { sq, tri, ok: errSq <= 0 && errTri <= 0, err: Math.max(errSq, errTri) };
        };

        const byLmin = assess(flowFromLmin);
        const byM3h = assess(flowFromM3h);

        let flowSource: 'm3h' | 'lmin' | null = null;
        let flowLh = flowFromLmin > 0 ? flowFromLmin : flowFromM3h;
        let checkSq: number | null = null;
        let checkTri: number | null = null;
        let verified = false;
        let issue: string | null = null;

        if (prSq === null || prTri === null) {
          issue = 'в каталоге нет колонок интенсивности для этой таблицы';
          checkSq = byLmin ? Math.round(byLmin.sq * 100) / 100 : null;
          checkTri = byLmin ? Math.round(byLmin.tri * 100) / 100 : null;
        } else {
          // Берём ту колонку расхода, которая лучше сходится с интенсивностями.
          const best =
            byLmin && byM3h
              ? byLmin.err <= byM3h.err
                ? { a: byLmin, src: 'lmin' as const, lh: flowFromLmin }
                : { a: byM3h, src: 'm3h' as const, lh: flowFromM3h }
              : byLmin
                ? { a: byLmin, src: 'lmin' as const, lh: flowFromLmin }
                : byM3h
                  ? { a: byM3h, src: 'm3h' as const, lh: flowFromM3h }
                  : null;

          if (!best) {
            issue = 'не разобран расход';
          } else {
            checkSq = Math.round(best.a.sq * 100) / 100;
            checkTri = Math.round(best.a.tri * 100) / 100;
            if (best.a.ok) {
              verified = true;
              flowSource = best.src;
              flowLh = best.lh;
              const other = best.src === 'lmin' ? byM3h : byLmin;
              // Вторая колонка расходится сильнее округления — значит, в PDF
              // повреждена именно она; расход взят из сошедшейся.
              if (other && Math.abs(other.sq - best.a.sq) > 0.06 * best.a.sq + 0.5) {
                issue = `колонка ${best.src === 'lmin' ? 'м³/ч' : 'л/мин'} повреждена в тексте PDF; расход взят из колонки ${best.src === 'lmin' ? 'л/мин' : 'м³/ч'}`;
              }
            } else {
              issue = `расчёт не сходится ни по одной колонке расхода: PR□ ${prSq} против ${checkSq}, PR△ ${prTri} против ${checkTri}`;
            }
          }
        }

        out.push({
          brand: 'Hunter',
          model: spec.family,
          nozzle: `${spec.blocks[b.index]}${key ? `, ${key}` : ''}`,
          sectorDeg,
          sectorFromTable,
          pressureBar,
          pressureKpa,
          radiusM,
          flowM3h: Math.round((flowLh / 1000) * 1000) / 1000,
          flowLmin: Math.round((flowLh / 60) * 100) / 100,
          prSquareMmH: prSq,
          prTriangleMmH: prTri,
          emitterClass: spec.emitterClass,
          sourcePage: spec.page,
          checkPrSquare: checkSq,
          checkPrTriangle: checkTri,
          flowSource,
          verified,
          issue,
          source: `Каталог Hunter, издание 41 (RU), стр. ${spec.page}`,
        });
      }
    }
  }

  return out;
}

async function main() {
  const catalog = await openCatalog();
  const all: NozzleRow[] = [];
  const perPage: { page: number; count: number; verified: number; noPr?: number; error?: string }[] = [];

  for (const spec of PAGE_SPECS) {
    try {
      const rows = await extractPage(catalog, spec);
      all.push(...rows);
      perPage.push({
        page: spec.page,
        count: rows.length,
        verified: rows.filter((r) => r.verified).length,
        noPr: rows.filter((r) => r.prSquareMmH === null).length,
      });
    } catch (e) {
      perPage.push({ page: spec.page, count: 0, verified: 0, noPr: 0, error: (e as Error).message });
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'hunter-nozzles.json'),
    JSON.stringify(
      {
        source: `Каталог Hunter, издание 41 (RU) — ${catalog.parts.length} части: ${catalog.parts
          .map((p) => p.file)
          .join(', ')}`,
        parts: catalog.parts,
        extractedAt: new Date().toISOString().slice(0, 10),
        rule: 'PR□ = q · (360/сектор) / R² при шаге «радиус в радиус»; PR△ = PR□ / 0,866. Для таблиц роторов сектор принят 180° (ТЗ §8 п.1).',
        rows: all,
      },
      null,
      2,
    ),
    'utf8',
  );

  const total = all.length;
  const verified = all.filter((r) => r.verified).length;
  const noPr = all.filter((r) => r.prSquareMmH === null).length;
  const checkable = total - noPr;
  const failures = all.filter((r) => !r.verified && r.prSquareMmH !== null);

  const report: string[] = [];
  report.push('# Сверка извлечения каталога Hunter Vol. 41 (RU)\n');
  report.push(`Извлечено строк: **${total}**`);
  report.push(`Из них с колонками интенсивности в каталоге: **${checkable}**`);
  report.push(
    `Прошли сплошную арифметическую сверку: **${verified}** из ${checkable} (${((verified / checkable) * 100).toFixed(1)} %)`,
  );
  report.push(`Без колонок интенсивности в самом каталоге (сверка неприменима): **${noPr}**\n`);
  report.push(
    'Сверка: `PR□ = q · (360/сектор) / R²`, `PR△ = PR□ / 0,866`. Расход берётся из той ' +
      'колонки (м³/ч или л/мин), которая сходится с обеими напечатанными интенсивностями.\n',
  );
  report.push('## По страницам\n');
  report.push('| Стр. | Строк | Сверено | Примечание |');
  report.push('|---|---|---|---|');
  for (const p of perPage) {
    const noPrCount = p.noPr ?? 0;
    const failed = p.count - p.verified - noPrCount;
    const note = p.error
      ? `ОШИБКА: ${p.error}`
      : noPrCount === p.count && p.count > 0
        ? 'в каталоге нет колонок интенсивности'
        : failed === 0
          ? 'все строки сходятся'
          : `расхождений: ${failed}`;
    report.push(`| ${p.page} | ${p.count} | ${p.verified} | ${note} |`);
  }
  if (failures.length > 0) {
    report.push('\n## Строки с расхождением\n');
    report.push('| Стр. | Модель | Насадка | Сектор | Бар | R, м | Q, м³/ч | PR□ кат. | PR□ расч. | PR△ кат. | PR△ расч. |');
    report.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const f of failures.slice(0, 120)) {
      report.push(
        `| ${f.sourcePage} | ${f.model} | ${f.nozzle} | ${f.sectorDeg}° | ${f.pressureBar} | ${f.radiusM} | ${f.flowM3h} | ${f.prSquareMmH} | ${f.checkPrSquare} | ${f.prTriangleMmH} | ${f.checkPrTriangle} |`,
      );
    }
  }
  await writeFile(path.join(outDir, 'hunter-nozzles-qa.md'), report.join('\n') + '\n', 'utf8');

  console.log(`Извлечено строк: ${total}`);
  console.log(
    `Сверено арифметически: ${verified} из ${checkable} (${((verified / checkable) * 100).toFixed(1)} %)`,
  );
  console.log(`Без колонок интенсивности в каталоге: ${noPr}`);
  for (const p of perPage) {
    console.log(
      `  стр. ${String(p.page).padStart(3)}: ${String(p.count).padStart(4)} строк, сверено ${String(p.verified).padStart(4)}${p.error ? `  ОШИБКА: ${p.error}` : ''}`,
    );
  }
}

await main();
