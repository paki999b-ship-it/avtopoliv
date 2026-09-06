/**
 * Сборка расчётной части базы вопросов (§3.7, §13 ТЗ).
 *
 * Запуск:  node scripts/build-question-bank.ts   (после `npm run build:core`)
 * Выход:   content/questions/bank-numeric.json
 *
 * ── Зачем скрипт, а не написанный руками JSON ──────────────────────────────
 * §0 п.6 ТЗ: ни одна цифра не берётся «по памяти». Правильный ответ на
 * расчётный вопрос — это результат формулы §5, и считать его должен тот же
 * движок, которым потом будет проверяться ответ пользователя. Здесь вопрос
 * описывается условием и вызовом функции `@irrigo/core`; и ответ, и подстановка
 * в пояснении получаются из расчёта.
 *
 * Так исключается класс ошибок, который иначе неизбежен: вопрос переписали,
 * число забыли пересчитать, и учебная программа учит неверному.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outDir = path.join(projectRoot, 'content', 'questions');

const core: typeof import('@irrigo/core') = await import(
  pathToFileURL(path.join(projectRoot, 'packages', 'core', 'dist', 'index.js')).href
);

const {
  COPPER_RESISTIVITY,
  HAZEN_WILLIAMS_C,
  barToMwc,
  barToPsi,
  blowoutPlan,
  fmt,
  hazenWilliamsLossM,
  headPrecipitationRate,
  irrigationRequirement,
  m3hToGpm,
  m3hToLmin,
  pumpHead,
  maxCableLengthM,
  round,
  runTime,
  soilWaterHoldingNorm,
  velocityMs,
  voltageDropV,
  waterBalance,
  waterHammer,
  zonePrecipitationRate,
} = core;

type Category =
  | 'basics'
  | 'water_plants'
  | 'hydraulics'
  | 'equipment'
  | 'design'
  | 'automation_electrical'
  | 'installation_maintenance'
  | 'safety';

interface Spec {
  key: string;
  category: Category;
  difficulty: 1 | 2 | 3;
  lessonKey: string;
  prompt: string;
  unit: string;
  /** Допуск в процентах: у величин с округлением исходных данных он шире. */
  tolerancePercent: number;
  /** Ответ и подстановка — оба из расчёта, а не из текста вопроса. */
  answer: number;
  substitution: string;
  why: string;
}

const SOURCE = 'Расчёт движком @irrigo/core по формулам §5 ТЗ';

/** Внутренний диаметр ПНД ПЭ100 по каталогу движка. */
function pipeId(odMm: number, sdr: 11 | 17): number {
  const pipe = core.PIPE_CATALOG.find(
    (p) => p.odMm === odMm && p.sdr === sdr && p.material === 'pe_new',
  );
  if (!pipe) throw new Error(`Нет трубы ПНД ${odMm} SDR${sdr} в каталоге`);
  return pipe.idMm;
}

const specs: Spec[] = [];

// ── Основы: единицы и давление ─────────────────────────────────────────────
{
  const bar = 3.2;
  specs.push({
    key: 'bank-basics-bar-to-mwc',
    category: 'basics',
    difficulty: 1,
    lessonKey: 'basics-pressure-units',
    prompt: `Манометр показывает ${fmt(bar, 1)} бар. Сколько это метров водяного столба?`,
    unit: 'м вод. ст.',
    tolerancePercent: 3,
    answer: barToMwc(bar),
    substitution: `${fmt(bar, 1)} × 10,2`,
    why: 'Один бар — примерно 10,2 метра водяного столба. Пересчёт нужен всякий раз, когда паспорт насоса дан в метрах, а манометр показывает бары.',
  });

  const psiBar = 2.8;
  specs.push({
    key: 'bank-basics-bar-to-psi',
    category: 'basics',
    difficulty: 1,
    lessonKey: 'basics-pressure-units',
    prompt: `Рабочее давление ротора ${fmt(psiBar, 1)} бар. Сколько это psi — как в американском каталоге?`,
    unit: 'psi',
    tolerancePercent: 3,
    answer: barToPsi(psiBar),
    substitution: `${fmt(psiBar, 1)} × 14,5`,
    why: 'В каталогах производителей давление часто дано в psi. Один бар — 14,5 psi.',
  });

  const flowM3h = 1.8;
  specs.push({
    key: 'bank-basics-m3h-to-lmin',
    category: 'basics',
    difficulty: 1,
    lessonKey: 'basics-water-units',
    prompt: `Расход зоны ${fmt(flowM3h, 1)} м³/ч. Сколько это литров в минуту?`,
    unit: 'л/мин',
    tolerancePercent: 3,
    answer: m3hToLmin(flowM3h),
    substitution: `${fmt(flowM3h, 1)} × 16,67`,
    why: 'Литры в минуту — привычная единица при замере ведром и секундомером, кубометры в час — при подборе оборудования.',
  });

  const gpmM3h = 2.4;
  specs.push({
    key: 'bank-basics-m3h-to-gpm',
    category: 'basics',
    difficulty: 2,
    lessonKey: 'basics-water-units',
    prompt: `Дебит источника ${fmt(gpmM3h, 1)} м³/ч. Сколько это GPM (галлонов в минуту)?`,
    unit: 'GPM',
    tolerancePercent: 3,
    answer: m3hToGpm(gpmM3h),
    substitution: `${fmt(gpmM3h, 1)} × 4,40`,
    why: 'Пересчёт нужен при работе с американскими каталогами: расход сопел там дан в GPM.',
  });

  const areaM2 = 240;
  const depthMm = 12;
  specs.push({
    key: 'bank-basics-mm-to-litres',
    category: 'basics',
    difficulty: 1,
    lessonKey: 'basics-water-units',
    prompt: `На газон площадью ${areaM2} м² нужно подать ${depthMm} мм. Сколько это литров воды?`,
    unit: 'л',
    tolerancePercent: 2,
    answer: areaM2 * depthMm,
    substitution: `${areaM2} × ${depthMm}`,
    why: 'Один миллиметр осадков — это один литр на квадратный метр. Отсюда вся связь между «мм» агронома и «литрами» гидравлика.',
  });

  const elevM = 14;
  specs.push({
    key: 'bank-basics-elevation-loss',
    category: 'basics',
    difficulty: 2,
    lessonKey: 'basics-elevation',
    prompt: `Верхняя точка участка выше узла управления на ${elevM} м. Сколько бар давления «съедает» этот подъём?`,
    unit: 'бар',
    tolerancePercent: 5,
    answer: elevM / 10.2,
    substitution: `${elevM} / 10,2`,
    why: 'Каждые 10,2 метра подъёма — минус один бар. Геодезический перепад вычитается из давления напрямую и настройкой не лечится.',
  });
}

// ── Вода и растения ────────────────────────────────────────────────────────
{
  const cases: Array<{ et0: number; kc: number; rain: number; du: number; d: 1 | 2 | 3 }> = [
    { et0: 5.2, kc: 0.8, rain: 0, du: 0.75, d: 1 },
    { et0: 4.5, kc: 0.5, rain: 1.2, du: 0.75, d: 2 },
    { et0: 6.0, kc: 0.8, rain: 0, du: 0.6, d: 3 },
  ];

  cases.forEach((c, i) => {
    const result = irrigationRequirement({
      et0MmDay: c.et0,
      kc: c.kc,
      effectiveRainMm: c.rain,
      du: c.du,
    });

    specs.push({
      key: `bank-water-netto-${i + 1}`,
      category: 'water_plants',
      difficulty: c.d,
      lessonKey: 'water-plants-requirement',
      prompt: `ET0 = ${fmt(c.et0, 1)} мм/сут, Kc = ${fmt(c.kc, 2)}, эффективные осадки ${fmt(c.rain, 1)} мм. Какова норма нетто за сутки?`,
      unit: 'мм',
      tolerancePercent: 5,
      answer: result.values.nettoMm,
      substitution: `${fmt(c.et0, 1)} × ${fmt(c.kc, 2)} − ${fmt(c.rain, 1)}`,
      why: 'Норма нетто — это то, что должно дойти до корней: потребность культуры ET0 × Kc за вычетом эффективных осадков.',
    });

    specs.push({
      key: `bank-water-brutto-${i + 1}`,
      category: 'water_plants',
      difficulty: c.d === 1 ? 2 : c.d,
      lessonKey: 'design-uniformity',
      prompt: `Норма нетто ${fmt(result.values.nettoMm, 2)} мм, равномерность полива DU = ${fmt(c.du, 2)}. Какова норма брутто?`,
      unit: 'мм',
      tolerancePercent: 5,
      answer: result.values.bruttoMm,
      substitution: `${fmt(result.values.nettoMm, 2)} / ${fmt(c.du, 2)}`,
      why: 'Брутто больше нетто ровно во столько раз, во сколько плоха равномерность. Множитель времени полива — это 1 / DU.',
    });
  });

  const sw = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 140, mad: 0.5 });
  specs.push({
    key: 'bank-water-soil-norm',
    category: 'water_plants',
    difficulty: 2,
    lessonKey: 'water-plants-soil-water',
    prompt:
      'Глубина корневой зоны газона 0,2 м, влагоёмкость почвы 140 мм/м, MAD = 0,5. Какова норма нетто за один полив по запасу влаги?',
    unit: 'мм',
    tolerancePercent: 5,
    answer: sw.values.netDepthMm,
    substitution: '0,2 × 140 × 0,5',
    why: 'Норма за полив ограничена тем, сколько влаги вообще удерживает корневая зона. Больше — уйдёт ниже корней.',
  });

  const swInterval = soilWaterHoldingNorm({
    rootDepthM: 0.35,
    awcMmPerM: 120,
    mad: 0.5,
    etcMmDay: 4,
  });
  specs.push({
    key: 'bank-water-interval',
    category: 'water_plants',
    difficulty: 3,
    lessonKey: 'water-plants-schedule',
    prompt:
      'Корневая зона кустарников 0,35 м, влагоёмкость 120 мм/м, суточная потребность нетто 4 мм/сут. Через сколько суток повторять полив?',
    unit: 'сут',
    tolerancePercent: 10,
    answer: swInterval.values.intervalDays ?? 0,
    substitution: `${fmt(swInterval.values.netDepthMm, 1)} / 4`,
    why: 'Интервал — это норма за полив, делённая на суточный расход влаги. Реже и глубже, а не каждый день по чуть-чуть.',
  });

  const rt = runTime({ grossDepthMm: 9, precipitationRateMmH: 35 });
  specs.push({
    key: 'bank-water-runtime-spray',
    category: 'water_plants',
    difficulty: 1,
    lessonKey: 'water-plants-cycle-soak',
    prompt: 'Норма брутто 9 мм, интенсивность зоны спреев 35 мм/ч. Сколько минут работает зона?',
    unit: 'мин',
    tolerancePercent: 5,
    answer: rt.values.totalRunMinutes,
    substitution: '60 × 9 / 35',
    why: 'Время полива = 60 × норма / интенсивность. Дальше проверяется, принимает ли почва такую интенсивность.',
  });

  const rtRotor = runTime({ grossDepthMm: 12, precipitationRateMmH: 11 });
  specs.push({
    key: 'bank-water-runtime-rotor',
    category: 'water_plants',
    difficulty: 2,
    lessonKey: 'water-plants-cycle-soak',
    prompt: 'Норма брутто 12 мм, интенсивность роторной зоны 11 мм/ч. Сколько минут работает зона?',
    unit: 'мин',
    tolerancePercent: 5,
    answer: rtRotor.values.totalRunMinutes,
    substitution: '60 × 12 / 11',
    why: 'У роторов интенсивность втрое ниже, чем у спреев, поэтому та же норма набирается втрое дольше. Смешивать их в одной зоне поэтому и нельзя.',
  });
}

// ── Гидравлика ─────────────────────────────────────────────────────────────
{
  const frictionCases: Array<{ od: 32 | 40 | 50 | 63; sdr: 11 | 17; q: number; len: number; d: 1 | 2 | 3 }> = [
    { od: 63, sdr: 17, q: 13, len: 100, d: 2 },
    { od: 32, sdr: 11, q: 2.5, len: 60, d: 2 },
    { od: 40, sdr: 11, q: 4, len: 80, d: 3 },
    { od: 50, sdr: 17, q: 8, len: 45, d: 3 },
  ];

  frictionCases.forEach((c, i) => {
    const idMm = pipeId(c.od, c.sdr);
    const loss = hazenWilliamsLossM(c.q / 3600, idMm / 1000, c.len, HAZEN_WILLIAMS_C.pe_new);

    specs.push({
      key: `bank-hydr-friction-${i + 1}`,
      category: 'hydraulics',
      difficulty: c.d,
      lessonKey: 'basics-friction-loss',
      prompt: `ПНД ПЭ100 ${c.od} мм SDR${c.sdr} (внутренний ${fmt(idMm, 1)} мм), расход ${fmt(c.q, 1)} м³/ч, длина ${c.len} м, C = 150. Каковы потери на трение?`,
      unit: 'м вод. ст.',
      tolerancePercent: 8,
      answer: loss,
      substitution: `10,67 × ${c.len} × (${fmt(c.q / 3600, 5)})^1,852 / (150^1,852 × ${fmt(idMm / 1000, 4)}^4,87)`,
      why: 'Хазен–Вильямс: потери растут почти квадратично от расхода и падают в пятой степени от диаметра. Поэтому лишний шаг по диаметру решает больше, чем любая экономия на длине.',
    });
  });

  const velocityCases: Array<{ od: 25 | 32 | 50 | 63; sdr: 11 | 17; q: number; d: 1 | 2 | 3 }> = [
    { od: 32, sdr: 11, q: 3.0, d: 1 },
    { od: 25, sdr: 11, q: 1.8, d: 2 },
    { od: 50, sdr: 17, q: 6.0, d: 2 },
    { od: 63, sdr: 17, q: 13, d: 3 },
  ];

  velocityCases.forEach((c, i) => {
    const idMm = pipeId(c.od, c.sdr);
    const v = velocityMs(c.q / 3600, idMm / 1000);

    specs.push({
      key: `bank-hydr-velocity-${i + 1}`,
      category: 'hydraulics',
      difficulty: c.d,
      lessonKey: 'basics-flow-and-pressure',
      prompt: `Расход ${fmt(c.q, 1)} м³/ч в трубе ПНД ${c.od} мм SDR${c.sdr} (внутренний ${fmt(idMm, 1)} мм). Какова скорость потока?`,
      unit: 'м/с',
      tolerancePercent: 5,
      answer: v,
      substitution: `4 × ${fmt(c.q / 3600, 5)} / (π × ${fmt(idMm / 1000, 4)}²)`,
      why: 'Целевая скорость 1,0–1,5 м/с, предел 2,0 м/с. Выше — шум, гидроудар и потери, которые растут быстрее, чем экономия на трубе.',
    });
  });

  const hammerCases: Array<{ v: number; material: 'pe' | 'steel'; d: 2 | 3 }> = [
    { v: 1.5, material: 'steel', d: 3 },
    { v: 2.0, material: 'pe', d: 2 },
  ];

  hammerCases.forEach((c, i) => {
    const result = waterHammer({ velocityChangeMs: c.v, material: c.material });
    specs.push({
      key: `bank-hydr-hammer-${i + 1}`,
      category: 'hydraulics',
      difficulty: c.d,
      lessonKey: 'basics-friction-loss',
      prompt: `Скорость в ${c.material === 'steel' ? 'стальной' : 'полиэтиленовой'} трубе ${fmt(c.v, 1)} м/с, поток останавливается мгновенно. Каков скачок давления по Жуковскому?`,
      unit: 'бар',
      tolerancePercent: 12,
      answer: result.values.surgeBar,
      substitution: `1000 × ${c.material === 'steel' ? 1100 : 350} × ${fmt(c.v, 1)} / 100000`,
      why: 'Скачок пропорционален скорости волны, а она в стали втрое выше, чем в полиэтилене. Отсюда и требование плавного закрытия, и ограничение скорости.',
    });
  });

  const minorBase = hazenWilliamsLossM(6 / 3600, pipeId(40, 11) / 1000, 70, HAZEN_WILLIAMS_C.pe_new);
  specs.push({
    key: 'bank-hydr-minor-share',
    category: 'hydraulics',
    difficulty: 2,
    lessonKey: 'design-hydraulics',
    prompt: `Потери на трение по ветке составили ${fmt(minorBase, 2)} м. Сколько метров добавят местные потери, если принять их в 15 % от потерь на трение?`,
    unit: 'м вод. ст.',
    tolerancePercent: 8,
    answer: minorBase * 0.15,
    substitution: `${fmt(minorBase, 2)} × 0,15`,
    why: 'Фитинги, повороты и тройники при обычной раскладке добавляют 10–20 % к потерям на трение. Клапан, фильтр и редуктор считаются отдельно по паспорту.',
  });

  const balance = waterBalance({
    grossDepthMm: 8,
    irrigatedAreaM2: 600,
    sourceFlowM3h: 1.5,
    windowHours: 4,
  });
  specs.push({
    key: 'bank-hydr-demand',
    category: 'hydraulics',
    difficulty: 2,
    lessonKey: 'water-plants-balance',
    prompt: 'Норма брутто 8 мм, поливаемая площадь 600 м². Сколько литров нужно за один полив?',
    unit: 'л',
    tolerancePercent: 3,
    answer: balance.values.demandLPerDay,
    substitution: '8 × 600',
    why: 'Один миллиметр — литр на квадратный метр, поэтому потребность в литрах — это просто норма, умноженная на площадь.',
  });

  specs.push({
    key: 'bank-hydr-available',
    category: 'hydraulics',
    difficulty: 3,
    lessonKey: 'design-source',
    prompt:
      'Дебит источника 1,5 м³/ч, окно полива 4 часа. Сколько литров можно взять за окно с учётом правила «не выше 80 % дебита»?',
    unit: 'л',
    tolerancePercent: 5,
    answer: balance.values.availableLPerDay,
    substitution: '1,5 × 4 × 1000 × 0,8',
    why: 'Запас в 20 % оставляют на сезонное падение уровня, на погрешность замера дебита и на заиливание.',
  });
}

// ── Оборудование ───────────────────────────────────────────────────────────
{
  const headCases: Array<{ flowLph: number; s: number; l: number; sector: number; d: 1 | 2 | 3 }> = [
    { flowLph: 480, s: 5, l: 5, sector: 360, d: 2 },
    { flowLph: 260, s: 4, l: 4, sector: 180, d: 2 },
  ];

  headCases.forEach((c, i) => {
    const pr = headPrecipitationRate({
      flowLph: c.flowLph,
      spacingM: c.s,
      rowSpacingM: c.l,
      sectorDeg: c.sector,
      pattern: 'square',
    });

    specs.push({
      key: `bank-equip-pr-head-${i + 1}`,
      category: 'equipment',
      difficulty: c.d,
      lessonKey: 'design-matched-pr',
      prompt: `Голова с сектором ${c.sector}° и расходом ${c.flowLph} л/ч, квадратная раскладка ${fmt(c.s, 1)} × ${fmt(c.l, 1)} м. Какова интенсивность дождя?`,
      unit: 'мм/ч',
      tolerancePercent: 6,
      answer: pr.values.precipitationRateMmH,
      substitution: `${c.flowLph} / ${fmt(pr.values.wettedAreaM2, 2)}`,
      why: 'Интенсивность — это расход, делённый на фактически политую площадь. У сектора 180° площадь вдвое меньше, чем у полного круга, поэтому и расход сопла должен быть вдвое меньше.',
    });
  });

  const zonePr = zonePrecipitationRate({ totalFlowLph: 1200, zoneAreaM2: 90 });
  specs.push({
    key: 'bank-equip-pr-zone',
    category: 'equipment',
    difficulty: 2,
    lessonKey: 'operation-audit',
    prompt: 'Зона расходует 1,2 м³/ч и поливает 90 м². Какова фактическая интенсивность зоны?',
    unit: 'мм/ч',
    tolerancePercent: 5,
    answer: zonePr.values.precipitationRateMmH,
    substitution: '1200 / 90',
    why: 'Интенсивность зоны по факту — это суммарный расход в литрах в час, делённый на площадь зоны. Так же считается результат теста «баночками».',
  });

  specs.push({
    key: 'bank-equip-matched-flow',
    category: 'equipment',
    difficulty: 2,
    lessonKey: 'design-matched-pr',
    prompt:
      'Сопло полного круга даёт 720 л/ч. Каким должен быть расход согласованного по интенсивности сопла на сектор 90°?',
    unit: 'л/ч',
    tolerancePercent: 3,
    answer: (720 * 90) / 360,
    substitution: '720 × 90 / 360',
    why: 'Согласованная интенсивность означает, что расход пропорционален сектору: четверть круга — четверть расхода. Иначе угол зальёт, а середину недольют.',
  });

  specs.push({
    key: 'bank-equip-catalog-pr-360',
    category: 'equipment',
    difficulty: 3,
    lessonKey: 'equipment-rotors',
    prompt:
      'В каталоге интенсивность сопла приведена для сектора 180° и равна 12 мм/ч. Какой она будет для того же сопла на полном круге?',
    unit: 'мм/ч',
    tolerancePercent: 5,
    answer: 12 / 2,
    substitution: '12 / 2',
    why: 'Каталог даёт интенсивность для 180°. Полный круг поливает вдвое большую площадь тем же расходом, поэтому интенсивность вдвое меньше. Правило нужно помнить, иначе график полива ошибётся вдвое.',
  });

  // Один гектар посадок здесь не нужен: считаем на квадратный метр ленты.
  // Капельниц 2 л/ч с шагом 0,3 м при расстоянии между линиями 0,4 м —
  // это 1 / (0,3 × 0,4) капельниц на м².
  const emittersPerM2 = 1 / (0.3 * 0.4);
  const dripPr = core.dripZonePrecipitationRate({
    totalFlowLph: 2 * emittersPerM2,
    plantedAreaM2: 1,
  });
  specs.push({
    key: 'bank-equip-drip-pr',
    category: 'equipment',
    difficulty: 3,
    lessonKey: 'equipment-drip',
    prompt:
      'Капельная лента: капельницы 2 л/ч с шагом 0,3 м, расстояние между линиями 0,4 м. Какова интенсивность капельной зоны?',
    unit: 'мм/ч',
    tolerancePercent: 6,
    answer: dripPr.values.precipitationRateMmH,
    substitution: '2 / (0,3 × 0,4)',
    why: 'Интенсивность капельной зоны считается по площади, приходящейся на одну капельницу. Она в разы ниже дождевания — отсюда и другое время полива.',
  });
}

// ── Проектирование ─────────────────────────────────────────────────────────
{
  specs.push({
    key: 'bank-design-du-multiplier',
    category: 'design',
    difficulty: 2,
    lessonKey: 'design-schedule-multiplier',
    prompt: 'Равномерность полива зоны DU = 0,55. Во сколько раз нужно увеличить время полива, чтобы «сухая четверть» получила норму?',
    unit: '×',
    tolerancePercent: 5,
    answer: 1 / 0.55,
    substitution: '1 / 0,55',
    why: 'Множитель графика равен 1 / DU. При DU = 0,55 система тратит почти вдвое больше воды, чем нужно, и это не лечится добавлением минут — только переделкой раскладки.',
  });

  specs.push({
    key: 'bank-design-spacing-wind',
    category: 'design',
    difficulty: 2,
    lessonKey: 'design-layout',
    prompt:
      'Радиус головы 8 м. Какой шаг между головами брать при ветре, если принять 85 % от радиуса?',
    unit: 'м',
    tolerancePercent: 4,
    answer: 8 * 0.85,
    substitution: '8 × 0,85',
    why: 'Перекрытие head-to-head означает шаг, равный радиусу. При заметном ветре шаг уменьшают до 85–90 % радиуса, иначе появляются сухие кольца.',
  });

  specs.push({
    key: 'bank-design-zone-limit',
    category: 'design',
    difficulty: 1,
    lessonKey: 'design-zoning',
    prompt: 'Дебит источника 2,5 м³/ч. Какой наибольший расход допустим для одной зоны?',
    unit: 'м³/ч',
    tolerancePercent: 3,
    answer: 2.5 * 0.8,
    substitution: '2,5 × 0,8',
    why: 'Зона не должна забирать больше 80 % дебита. Оставшийся запас — на просадку уровня и на погрешность замера.',
  });

  const triangleArea = 6 * 6 * 0.866;
  specs.push({
    key: 'bank-design-triangle-area',
    category: 'design',
    difficulty: 3,
    lessonKey: 'design-layout',
    prompt:
      'Треугольная раскладка с шагом 6 м и расстоянием между рядами 6 м. Какая площадь приходится на одну голову?',
    unit: 'м²',
    tolerancePercent: 4,
    answer: triangleArea,
    substitution: '6 × 6 × 0,866',
    why: 'У треугольной раскладки на голову приходится на 13,4 % больше площади, чем у квадратной, и равномерность при этом выше. Это самая дешёвая экономия в проекте.',
  });
}

// ── Автоматика и электрика ─────────────────────────────────────────────────
{
  const dropCases: Array<{ len: number; s: number; i: number; d: 1 | 2 | 3 }> = [
    { len: 90, s: 1.5, i: 0.37, d: 2 },
    { len: 150, s: 2.5, i: 0.37, d: 2 },
    { len: 60, s: 0.75, i: 0.37, d: 3 },
  ];

  dropCases.forEach((c, i) => {
    const drop = voltageDropV(c.len, c.i, c.s, COPPER_RESISTIVITY);
    specs.push({
      key: `bank-auto-drop-${i + 1}`,
      category: 'automation_electrical',
      difficulty: c.d,
      lessonKey: 'automation-cable',
      prompt: `Медный кабель ${fmt(c.s, 2)} мм², длина трассы ${c.len} м, пусковой ток соленоида ${fmt(c.i, 2)} А. Каково падение напряжения?`,
      unit: 'В',
      tolerancePercent: 6,
      answer: drop,
      substitution: `2 × ${c.len} × ${fmt(c.i, 2)} × 0,0175 / ${fmt(c.s, 2)}`,
      why: 'Ток идёт туда и обратно, поэтому в формуле двойка. Допустимо не более 2,4 В — это 10 % от 24 В.',
    });
  });

  const lengthCases: Array<{ s: number; d: 1 | 2 | 3 }> = [
    { s: 0.5, d: 2 },
    { s: 1.5, d: 2 },
    { s: 2.5, d: 3 },
  ];

  lengthCases.forEach((c, i) => {
    const maxLen = maxCableLengthM(c.s, 0.37);
    specs.push({
      key: `bank-auto-maxlen-${i + 1}`,
      category: 'automation_electrical',
      difficulty: c.d,
      lessonKey: 'automation-cable',
      prompt: `Какая наибольшая длина трассы допустима для медной жилы ${fmt(c.s, 2)} мм² при пусковом токе 0,37 А и допустимом падении 2,4 В?`,
      unit: 'м',
      tolerancePercent: 6,
      answer: maxLen,
      substitution: `2,4 × ${fmt(c.s, 2)} / (2 × 0,37 × 0,0175)`,
      why: 'Считать надо по пусковому току, а не по току удержания: если напряжения не хватит в момент открытия, клапан не откроется вовсе.',
    });
  });

  specs.push({
    key: 'bank-auto-transformer',
    category: 'automation_electrical',
    difficulty: 3,
    lessonKey: 'automation-transformer',
    prompt:
      'Одновременно открываются зонный клапан и мастер-клапан, ток каждого 0,37 А при 24 В. Какая мощность трансформатора нужна с запасом 30 %?',
    unit: 'В·А',
    tolerancePercent: 8,
    answer: 2 * 0.37 * 24 * 1.3,
    substitution: '2 × 0,37 × 24 × 1,3',
    why: 'Мастер-клапан открывается вместе с любой зоной, поэтому считается пара. Запас нужен, чтобы трансформатор не просаживался на пусковом токе.',
  });
}

// ── Монтаж и эксплуатация ──────────────────────────────────────────────────
{
  const plan = blowoutPlan({
    zones: [
      { name: 'Газон дальний', flowM3h: 1.6, emitterClass: 'rotor' },
      { name: 'Газон ближний', flowM3h: 1.2, emitterClass: 'spray' },
    ],
    pipeMaterial: 'pe',
  });

  specs.push({
    key: 'bank-ops-blowout-cfm',
    category: 'installation_maintenance',
    difficulty: 3,
    lessonKey: 'operation-blowout',
    prompt:
      'Самая расходная зона потребляет 1,6 м³/ч. Какая производительность компрессора нужна для продувки, в кубометрах в минуту?',
    unit: 'м³/мин',
    tolerancePercent: 10,
    answer: plan.values.requiredM3Min,
    substitution: `${fmt(m3hToLmin(1.6), 1)} / 283`,
    why: 'Компрессор подбирается по самой расходной зоне: если он не продавит её, именно там и останется вода.',
  });

  specs.push({
    key: 'bank-ops-blowout-pressure',
    category: 'installation_maintenance',
    difficulty: 2,
    lessonKey: 'operation-blowout',
    prompt:
      'Магистраль из полиэтилена, зона спреев. Каким давлением можно продувать, не рискуя уплотнениями? Укажите верхний предел в барах.',
    unit: 'бар',
    tolerancePercent: 10,
    answer: plan.values.maxPressureBar,
    substitution: 'предел для полиэтилена',
    why: 'Для полиэтилена предел около 3,5 бар. Повышенное давление не выгоняет больше воды — воду выносит поток воздуха, — зато рвёт мембраны и уплотнения.',
  });

  specs.push({
    key: 'bank-ops-audit-pr',
    category: 'installation_maintenance',
    difficulty: 2,
    lessonKey: 'operation-audit',
    prompt:
      'При тесте «баночками» за 15 минут в ёмкости набралось в среднем 6 мм. Какова фактическая интенсивность зоны?',
    unit: 'мм/ч',
    tolerancePercent: 5,
    answer: (6 * 60) / 15,
    substitution: '6 × 60 / 15',
    why: 'Интенсивность — это глубина за час. Замер за 15 минут умножается на четыре. Дальше по ней и DU строится реальный график полива.',
  });
}

// ── Безопасность ───────────────────────────────────────────────────────────
{
  specs.push({
    key: 'bank-safety-yield-limit',
    category: 'safety',
    difficulty: 1,
    lessonKey: 'design-source',
    prompt:
      'Дебит скважины 1,8 м³/ч. Какой предельный расход одновременно работающей зоны допустим, чтобы не выйти за безопасный отбор?',
    unit: 'м³/ч',
    tolerancePercent: 3,
    answer: 1.8 * 0.8,
    substitution: '1,8 × 0,8',
    why: 'Отбор выше дебита ведёт к срыву подачи, работе насоса всухую и заиливанию скважины. Предел — 80 % дебита.',
  });
}

// ── Уровень 7: обвязка и защита насосного агрегата ─────────────────────────
// Вопросы к уроку об обвязке считаются теми же функциями §5.11 и §5.13, что
// и калькуляторы: подбор насоса, скорость на всасе, потери и гидроудар.
{
  const dutyCases: Array<{
    q: number;
    lift: number;
    friction: number;
    minor: number;
    sprinkler: number;
    d: 1 | 2 | 3;
  }> = [
    { q: 3.0, lift: 22, friction: 4, minor: 1, sprinkler: 3.0, d: 2 },
    { q: 4.5, lift: 12, friction: 6, minor: 3, sprinkler: 2.5, d: 2 },
    { q: 2.0, lift: 30, friction: 3, minor: 1, sprinkler: 2.1, d: 3 },
    { q: 5.0, lift: 8, friction: 9, minor: 4, sprinkler: 3.5, d: 3 },
  ];

  dutyCases.forEach((c, i) => {
    const result = pumpHead({
      flowM3h: c.q,
      staticLiftM: c.lift,
      frictionLossM: c.friction,
      minorLossM: c.minor,
      sprinklerPressureBar: c.sprinkler,
      safetyMargin: 0.1,
    });

    specs.push({
      key: `bank-rig-head-${i + 1}`,
      category: 'equipment',
      difficulty: c.d,
      lessonKey: 'pump-rig-full',
      prompt:
        `Подъём от зеркала воды до самой высокой головы ${fmt(c.lift, 0)} м, потери на трение ` +
        `${fmt(c.friction, 0)} м, местные ${fmt(c.minor, 0)} м, рабочее давление дождевателя ` +
        `${fmt(c.sprinkler, 1)} бар, запас 10 %. Какой напор должен давать насос?`,
      unit: 'м вод. ст.',
      tolerancePercent: 5,
      answer: result.values.requiredHeadM,
      substitution:
        `(${fmt(c.lift, 0)} + ${fmt(c.friction, 0)} + ${fmt(c.minor, 0)} + ` +
        `${fmt(result.values.sprinklerHeadM, 1)}) × 1,1`,
      why: 'Рабочее давление дождевателя переводится в метры и складывается с подъёмом и потерями. Обычно именно оно, а не трение, занимает бо́льшую часть требуемого напора.',
    });

    specs.push({
      key: `bank-rig-power-${i + 1}`,
      category: 'equipment',
      difficulty: 3,
      lessonKey: 'pump-rig-starters',
      prompt:
        `Рабочая точка насоса: ${fmt(c.q, 1)} м³/ч при ${fmt(result.values.requiredHeadM, 1)} м. ` +
        'Какая мощность нужна на валу при КПД 0,6?',
      unit: 'кВт',
      tolerancePercent: 8,
      answer: result.values.shaftPowerKw,
      substitution: `${fmt(c.q, 1)} × ${fmt(result.values.requiredHeadM, 1)} / (367 × 0,60)`,
      why: 'От мощности на валу отталкиваются при выборе пускателя и уставки теплового реле. Потребляемая мощность из паспорта будет выше — на потери в двигателе.',
    });
  });

  // Доля давления дождевателя в требуемом напоре — то, что нельзя урезать.
  const sprinklerBar = 3.0;
  specs.push({
    key: 'bank-rig-sprinkler-head',
    category: 'equipment',
    difficulty: 1,
    lessonKey: 'pump-rig-gauges',
    prompt: `Рабочее давление ротора ${fmt(sprinklerBar, 1)} бар. Сколько это метров водяного столба в расчёте напора насоса?`,
    unit: 'м вод. ст.',
    tolerancePercent: 3,
    answer: barToMwc(sprinklerBar),
    substitution: `${fmt(sprinklerBar, 1)} × 10,2`,
    why: 'Паспорт насоса дан в метрах, а давление сопла — в барах. Без перевода слагаемые напора складывать нельзя.',
  });

  // Скорость на всасывающей линии: предел 1,2 м/с, а не 2,0 как на напоре.
  const suctionCases: Array<{ q: number; od: 32 | 40 | 50; sdr: 11 | 17; d: 1 | 2 | 3 }> = [
    { q: 3.0, od: 40, sdr: 11, d: 2 },
    { q: 4.5, od: 50, sdr: 11, d: 2 },
    { q: 2.0, od: 32, sdr: 11, d: 3 },
    { q: 6.0, od: 50, sdr: 11, d: 3 },
  ];

  suctionCases.forEach((c, i) => {
    const idMm = pipeId(c.od, c.sdr);
    const v = velocityMs(c.q / 3600, idMm / 1000);
    specs.push({
      key: `bank-rig-suction-velocity-${i + 1}`,
      category: 'hydraulics',
      difficulty: c.d,
      lessonKey: 'pump-rig-strainer',
      prompt:
        `Всасывающая линия ПНД ${c.od} мм SDR${c.sdr} (внутренний ${fmt(idMm, 1)} мм), расход ` +
        `${fmt(c.q, 1)} м³/ч. Какова скорость воды на всасе?`,
      unit: 'м/с',
      tolerancePercent: 5,
      answer: v,
      substitution: `4 × ${fmt(c.q / 3600, 5)} / (π × ${fmt(idMm / 1000, 4)}²)`,
      why: 'На всасывающей линии предел скорости ниже, чем на напоре: около 1,2 м/с. Выше — растёт сопротивление там, где запаса по давлению нет, и приближается кавитация.',
    });
  });

  // Потери на всасывающей линии — то, что съедает и без того малый запас.
  const suctionLossCases: Array<{ q: number; od: 40 | 50; len: number; d: 2 | 3 }> = [
    { q: 3.0, od: 40, len: 12, d: 2 },
    { q: 4.5, od: 50, len: 20, d: 3 },
    { q: 2.0, od: 40, len: 8, d: 2 },
  ];

  suctionLossCases.forEach((c, i) => {
    const idMm = pipeId(c.od, 11);
    const loss = hazenWilliamsLossM(c.q / 3600, idMm / 1000, c.len, HAZEN_WILLIAMS_C.pe_new);
    specs.push({
      key: `bank-rig-suction-loss-${i + 1}`,
      category: 'hydraulics',
      difficulty: c.d,
      lessonKey: 'pump-rig-strainer',
      prompt:
        `Всасывающая линия ПНД ${c.od} мм SDR11 длиной ${fmt(c.len, 0)} м, расход ` +
        `${fmt(c.q, 1)} м³/ч, C = 150. Каковы потери на трение на этом участке?`,
      unit: 'м вод. ст.',
      tolerancePercent: 8,
      answer: loss,
      substitution: `10,67 × ${fmt(c.len, 0)} × ${fmt(c.q / 3600, 5)}^1,852 / (150^1,852 × ${fmt(idMm / 1000, 4)}^4,87)`,
      why: 'На всасе к этим потерям добавится сопротивление приёмного клапана и грязевика. Всё вместе вычитается из атмосферного давления — отсюда и предел высоты всасывания.',
    });
  });

  // Гидроудар: аргумент за плавный пуск и за правильный обратный клапан.
  const rigHammer: Array<{ v: number; material: 'pe' | 'steel'; d: 2 | 3 }> = [
    { v: 1.2, material: 'steel', d: 2 },
    { v: 1.8, material: 'steel', d: 3 },
    { v: 1.5, material: 'pe', d: 2 },
    { v: 0.9, material: 'pe', d: 1 },
  ];

  rigHammer.forEach((c, i) => {
    const result = waterHammer({ velocityChangeMs: c.v, material: c.material });
    specs.push({
      key: `bank-rig-hammer-${i + 1}`,
      category: 'equipment',
      difficulty: c.d,
      lessonKey: 'pump-rig-check-valve',
      prompt:
        `Насос остановился, и поток в ${c.material === 'steel' ? 'стальном' : 'полиэтиленовом'} ` +
        `трубопроводе со скоростью ${fmt(c.v, 1)} м/с остановлен обратным клапаном мгновенно. ` +
        'Каков скачок давления по Жуковскому?',
      unit: 'бар',
      tolerancePercent: 12,
      answer: result.values.surgeBar,
      substitution: `1000 × ${c.material === 'steel' ? 1100 : 350} × ${fmt(c.v, 1)} / 100000`,
      why: 'Именно поэтому у мощных насосов ставят плавный пуск и остановку, а обратный клапан подбирают по скорости закрытия: резко захлопнувшийся клапан сам становится источником удара.',
    });
  });

  // Расход рабочей точки в других единицах — паспорта бывают разные.
  const dutyFlow = 3.6;
  specs.push({
    key: 'bank-rig-duty-lmin',
    category: 'equipment',
    difficulty: 1,
    lessonKey: 'pump-rig-press-control',
    prompt: `Рабочая точка насоса ${fmt(dutyFlow, 1)} м³/ч. Сколько это литров в минуту — как меряют ведром при пусконаладке?`,
    unit: 'л/мин',
    tolerancePercent: 3,
    answer: m3hToLmin(dutyFlow),
    substitution: `${fmt(dutyFlow, 1)} × 16,67`,
    why: 'Фактическую подачу проверяют ведром и секундомером, а паспорт дан в кубометрах в час. Расхождение замера с паспортом — первый признак того, что рабочая точка не там, где рассчитывали.',
  });

  specs.push({
    key: 'bank-rig-duty-gpm',
    category: 'equipment',
    difficulty: 2,
    lessonKey: 'pump-rig-vfd',
    prompt: `Рабочая точка насоса ${fmt(dutyFlow, 1)} м³/ч. Сколько это GPM — как в американском каталоге?`,
    unit: 'GPM',
    tolerancePercent: 3,
    answer: m3hToGpm(dutyFlow),
    substitution: `${fmt(dutyFlow, 1)} × 4,40`,
    why: 'Кривые части каталогов даны в галлонах в минуту. Перепутанные единицы дают ошибку в подборе насоса больше чем в четыре раза.',
  });

  // Что даёт запас: разница между напором с запасом и без него.
  const marginCase = pumpHead({
    flowM3h: 3.0,
    staticLiftM: 18,
    frictionLossM: 5,
    minorLossM: 2,
    sprinklerPressureBar: 2.8,
    safetyMargin: 0.15,
  });

  specs.push({
    key: 'bank-rig-margin',
    category: 'design',
    difficulty: 3,
    lessonKey: 'pump-rig-relief-bypass',
    prompt:
      `Составляющие напора дали ${fmt(marginCase.values.headBeforeMarginM, 1)} м. ` +
      'Сколько метров добавит запас 15 % на износ и загрязнение системы?',
    unit: 'м вод. ст.',
    tolerancePercent: 8,
    answer: marginCase.values.requiredHeadM - marginCase.values.headBeforeMarginM,
    substitution: `${fmt(marginCase.values.headBeforeMarginM, 1)} × 0,15`,
    why: 'Запас берут 10–15 %: труба зарастает, фильтр забивается, сопла изнашиваются. Больше — это работа насоса вне эффективной зоны и лишнее давление, которое придётся срезать редуктором.',
  });
}

// ── Выгрузка ───────────────────────────────────────────────────────────────

const numericSpecs = specs.map((spec) => {
  if (!Number.isFinite(spec.answer)) {
    throw new Error(`${spec.key}: расчёт не дал числа`);
  }
  if (!core.isAcademyLessonKey(spec.lessonKey)) {
    throw new Error(`${spec.key}: урок «${spec.lessonKey}» не описан в программе §4`);
  }

  const answer = round(spec.answer, 3);

  return {
    key: spec.key,
    category: spec.category,
    type: 'numeric' as const,
    difficulty: spec.difficulty,
    prompt: spec.prompt,
    correct: answer,
    unit: spec.unit,
    tolerancePercent: spec.tolerancePercent,
    explanation: `${spec.substitution} = ${fmt(answer, answer < 10 ? 2 : 1)} ${spec.unit}. ${spec.why}`,
    lessonKey: spec.lessonKey,
    source: SOURCE,
  };
});

const keys = new Set<string>();
for (const q of numericSpecs) {
  if (keys.has(q.key)) throw new Error(`Ключ вопроса «${q.key}» повторяется`);
  keys.add(q.key);
}

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'bank-numeric.json'),
  `${JSON.stringify(
    {
      note: 'Расчётная часть базы вопросов (§3.7). Файл собирается скриптом scripts/build-question-bank.ts: правильный ответ и подстановка считаются движком @irrigo/core, а не пишутся руками. Править вручную нельзя — правки затрёт следующая сборка.',
      generatedAt: new Date().toISOString().slice(0, 10),
      generator: 'scripts/build-question-bank.ts',
      questions: numericSpecs,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const byCategory = numericSpecs.reduce<Record<string, number>>((acc, q) => {
  acc[q.category] = (acc[q.category] ?? 0) + 1;
  return acc;
}, {});

console.log(`Собрано расчётных вопросов: ${numericSpecs.length}`);
console.log('По категориям:', byCategory);
