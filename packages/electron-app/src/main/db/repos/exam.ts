import { fmt } from '@irrigo/core';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';
import { addXp } from './profiles.js';
import { getProfile } from './profiles.js';
import { checkAnswer, describeCorrect, parseJson } from './academy.js';
import type { QuestionRow } from './academy.js';
import type { QuizAnswer } from '../../../shared/academy.js';
import type {
  Certificate,
  ExamAnswerReview,
  ExamCategory,
  ExamHistoryEntry,
  ExamPaper,
  ExamResult,
  ExamSubmission,
} from '../../../shared/exam.js';
import { SKILL_LEVEL_TITLES } from '../../../shared/types.js';

/**
 * Экзамен и сертификат (§3.9).
 *
 * Три требования ТЗ определяют устройство модуля.
 *
 * 1. Состав билета — 60 вопросов по всем восьми категориям, расчётных не менее
 *    четверти. Билет собирается здесь, а не в интерфейсе: иначе состав зависел
 *    бы от того, что успел загрузить renderer.
 * 2. Проверка ответов — теми же функциями, что и в мини-тесте урока
 *    (`checkAnswer`, `describeCorrect`). Второго определения «верного ответа»
 *    в приложении нет.
 * 3. Порядок завершения: **рассчитать → сохранить → вернуть результат**, всё
 *    в одной операции и одной транзакции. Интерфейсу нечего терять между
 *    шагами: он переходит на экран результатов, уже имея сохранённый ответ.
 */

export const EXAM_SIZE = 60;
export const EXAM_PASS_SCORE = 0.75;
export const EXAM_TIME_LIMIT_MINUTES = 60;

/** §3.9: доля расчётных вопросов не менее 25 %. Берём с запасом в один вопрос. */
export const EXAM_MIN_NUMERIC = Math.ceil(EXAM_SIZE * 0.25) + 1;

/** Ни одна из восьми категорий не должна выпасть из билета. */
const MIN_PER_CATEGORY = 4;

/** XP за сданный экзамен. Начисляется один раз — за первую сдачу. */
const EXAM_XP = 200;

const CATEGORIES: ExamCategory[] = [
  'basics',
  'water_plants',
  'hydraulics',
  'equipment',
  'design',
  'automation_electrical',
  'installation_maintenance',
  'safety',
];

interface PoolRow extends QuestionRow {
  category: ExamCategory;
  lesson_key: string | null;
  lesson_title: string | null;
}

const QUESTION_SELECT = `
  SELECT q.id, q.key, q.type, q.prompt, q.options_json, q.match_options_json,
         q.correct_json, q.unit, q.tolerance_percent, q.explanation, q.difficulty,
         q.category, l.key AS lesson_key, l.title AS lesson_title
  FROM questions q
  LEFT JOIN lessons l ON l.id = q.lesson_id
`;

/** Перемешивание Фишера–Йейтса. Источник случайности можно подменить в тестах. */
function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Разверстка 60 вопросов по категориям.
 *
 * Сначала каждой категории — гарантированный минимум, потом остаток по
 * убыванию наполненности: там, где вопросов больше, и выборка разнообразнее.
 */
function allocate(available: Map<ExamCategory, number>): Map<ExamCategory, number> {
  const quota = new Map<ExamCategory, number>();
  let left = EXAM_SIZE;

  for (const category of CATEGORIES) {
    const take = Math.min(MIN_PER_CATEGORY, available.get(category) ?? 0);
    quota.set(category, take);
    left -= take;
  }

  const order = [...CATEGORIES].sort(
    (a, b) => (available.get(b) ?? 0) - (available.get(a) ?? 0),
  );

  // Раздаём остаток по кругу, пока он есть и пока есть куда.
  let progress = true;
  while (left > 0 && progress) {
    progress = false;
    for (const category of order) {
      if (left === 0) break;
      const have = quota.get(category) ?? 0;
      if (have >= (available.get(category) ?? 0)) continue;
      quota.set(category, have + 1);
      left -= 1;
      progress = true;
    }
  }

  return quota;
}

export function buildExamPaper(db: Db, random: () => number = Math.random): ExamPaper {
  const rows = db.prepare(QUESTION_SELECT).all() as unknown as PoolRow[];

  const byCategory = new Map<ExamCategory, PoolRow[]>();
  for (const row of rows) {
    if (!CATEGORIES.includes(row.category)) continue;
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  const available = new Map<ExamCategory, number>(
    CATEGORIES.map((c) => [c, byCategory.get(c)?.length ?? 0]),
  );

  const total = [...available.values()].reduce((a, b) => a + b, 0);
  if (total < EXAM_SIZE) {
    throw new Error(`В базе всего ${total} вопросов — на экзамен нужно ${EXAM_SIZE}.`);
  }

  const quota = allocate(available);
  const picked: PoolRow[] = [];

  // Сначала расчётные: доля §3.9 должна выполняться по построению, а не
  // случайно оказаться выполненной.
  let numericLeft = EXAM_MIN_NUMERIC;
  const takenIds = new Set<number>();

  for (const category of CATEGORIES) {
    const need = quota.get(category) ?? 0;
    if (need === 0) continue;

    const pool = shuffle(byCategory.get(category) ?? [], random);
    const numeric = pool.filter((q) => q.type === 'numeric');
    const wantNumeric = Math.min(
      numeric.length,
      need,
      Math.ceil(numericLeft / CATEGORIES.length) + 1,
    );

    for (const row of numeric.slice(0, wantNumeric)) {
      picked.push(row);
      takenIds.add(row.id);
      numericLeft -= 1;
    }
  }

  // Если расчётных всё ещё не хватает — добираем откуда угодно.
  if (numericLeft > 0) {
    const rest = shuffle(
      rows.filter((r) => r.type === 'numeric' && !takenIds.has(r.id)),
      random,
    );
    for (const row of rest.slice(0, numericLeft)) {
      picked.push(row);
      takenIds.add(row.id);
    }
  }

  // Остаток квоты каждой категории добираем любыми вопросами.
  for (const category of CATEGORIES) {
    const need = quota.get(category) ?? 0;
    const already = picked.filter((q) => q.category === category).length;
    if (already >= need) continue;

    const pool = shuffle(
      (byCategory.get(category) ?? []).filter((q) => !takenIds.has(q.id)),
      random,
    );
    for (const row of pool.slice(0, need - already)) {
      picked.push(row);
      takenIds.add(row.id);
    }
  }

  // Расчётные могли вытеснить квоту своей категории — срезаем лишнее по
  // самым наполненным категориям, не трогая расчётные и минимум категории.
  while (picked.length > EXAM_SIZE) {
    const counts = new Map<ExamCategory, number>();
    for (const q of picked) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);

    const victim = picked.findIndex(
      (q) => q.type !== 'numeric' && (counts.get(q.category) ?? 0) > MIN_PER_CATEGORY,
    );
    if (victim < 0) break;
    picked.splice(victim, 1);
  }

  const paper = shuffle(picked, random).slice(0, EXAM_SIZE);

  const counts = new Map<ExamCategory, number>();
  for (const q of paper) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);

  return {
    questions: paper.map((row) => ({
      id: row.id,
      key: row.key,
      type: row.type,
      category: row.category,
      prompt: row.prompt,
      options: parseJson<string[]>(row.options_json, []),
      matchOptions: parseJson<string[] | undefined>(row.match_options_json, undefined),
      unit: row.unit,
      difficulty: row.difficulty,
    })),
    timeLimitMinutes: EXAM_TIME_LIMIT_MINUTES,
    passScore: EXAM_PASS_SCORE,
    numericCount: paper.filter((q) => q.type === 'numeric').length,
    byCategory: CATEGORIES.map((category) => ({
      category,
      count: counts.get(category) ?? 0,
    })),
  };
}

/** Ответ пользователя в человекочитаемом виде — для разбора. */
function describeGiven(row: PoolRow, answer: QuizAnswer): string {
  if (answer === null || answer === undefined || answer === '') return 'нет ответа';

  const options = parseJson<string[]>(row.options_json, []);

  switch (row.type) {
    case 'single':
      return options[Number(answer)] ?? String(answer);
    case 'multi':
      return Array.isArray(answer)
        ? answer.map((i) => options[i] ?? String(i)).join('; ')
        : String(answer);
    case 'match': {
      const right = parseJson<string[]>(row.match_options_json, []);
      return Array.isArray(answer)
        ? answer
            .map((target, index) => `${options[index] ?? index} → ${right[target] ?? target}`)
            .join('; ')
        : String(answer);
    }
    case 'numeric':
      return `${String(answer).replace('.', ',')}${row.unit ? ` ${row.unit}` : ''}`;
    default:
      return String(answer);
  }
}

/** Номер сертификата: профиль, дата и номер попытки — без внешних сервисов. */
function certificateNumber(profileId: number, resultId: number, date: Date): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return `ИМ-${String(profileId).padStart(3, '0')}-${stamp}-${String(resultId).padStart(4, '0')}`;
}

/**
 * Завершение экзамена: расчёт → сохранение → результат.
 *
 * Порядок из §3.9 соблюдён буквально: пока результат не записан, функция не
 * возвращает управление, поэтому интерфейсу нечего терять при переходе на
 * экран результатов. Это та самая ловушка, из-за которой в прошлых проектах
 * терялся результат экзамена.
 */
export function submitExam(
  db: Db,
  profileId: number,
  submission: ExamSubmission,
  now: Date = new Date(),
): ExamResult {
  if (submission.answers.length === 0) {
    throw new Error('Экзамен без ответов не проверяется.');
  }

  const ids = submission.answers.map((a) => a.questionId);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`${QUESTION_SELECT} WHERE q.id IN (${placeholders})`)
    .all(...ids) as unknown as PoolRow[];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const given = new Map(submission.answers.map((a) => [a.questionId, a.answer]));

  // ── 1. Расчёт ────────────────────────────────────────────────────────────
  const review: ExamAnswerReview[] = [];
  for (const { questionId } of submission.answers) {
    const row = byId.get(questionId);
    if (!row) throw new Error(`Вопрос ${questionId} не найден — билет не соответствует базе.`);

    const answer = given.get(questionId) ?? null;
    const outcome = checkAnswer(row, answer);

    review.push({
      questionId,
      category: row.category,
      prompt: row.prompt,
      correct: outcome.correct,
      givenAnswer: describeGiven(row, answer),
      correctAnswer: describeCorrect(row),
      explanation: row.explanation,
      ...(outcome.deviationPercent === undefined
        ? {}
        : { deviationPercent: outcome.deviationPercent }),
      lessonKey: row.lesson_key,
      lessonTitle: row.lesson_title,
    });
  }

  const total = review.length;
  const correctCount = review.filter((r) => r.correct).length;
  const score = correctCount / total;
  const passed = score >= EXAM_PASS_SCORE;
  const numericShare = rows.filter((r) => r.type === 'numeric').length / total;

  const byCategory = CATEGORIES.map((category) => {
    const inCategory = review.filter((r) => r.category === category);
    return {
      category,
      total: inCategory.length,
      correct: inCategory.filter((r) => r.correct).length,
    };
  }).filter((c) => c.total > 0);

  const alreadyPassed =
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM exam_results WHERE profile_id = ? AND passed = 1')
        .get(profileId) as { n: number }
    ).n > 0;
  const xpAwarded = passed && !alreadyPassed ? EXAM_XP : 0;

  // ── 2. Сохранение ────────────────────────────────────────────────────────
  const saved = inTransaction(db, () => {
    const info = db
      .prepare(
        `INSERT INTO exam_results
           (profile_id, score, total, correct_count, numeric_share, passed,
            duration_sec, answers_json, certificate_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        profileId,
        score,
        total,
        correctCount,
        numericShare,
        passed ? 1 : 0,
        Math.max(0, Math.round(submission.durationSec)),
        JSON.stringify(
          review.map((r) => ({ id: r.questionId, correct: r.correct, given: r.givenAnswer })),
        ),
      );

    const id = Number(info.lastInsertRowid);

    // Номер сертификата зависит от номера попытки, поэтому проставляется
    // сразу после вставки — в той же транзакции.
    let certificateNo: string | null = null;
    if (passed) {
      certificateNo = certificateNumber(profileId, id, now);
      db.prepare('UPDATE exam_results SET certificate_no = ? WHERE id = ?').run(
        certificateNo,
        id,
      );
    }

    const profileXp = xpAwarded > 0 ? addXp(db, profileId, xpAwarded) : currentXp(db, profileId);
    const created = db.prepare('SELECT created_at FROM exam_results WHERE id = ?').get(id) as {
      created_at: string;
    };

    return { id, certificateNo, profileXp, createdAt: created.created_at };
  });

  // ── 3. Результат ─────────────────────────────────────────────────────────
  return {
    id: saved.id,
    score,
    total,
    correctCount,
    numericShare,
    passed,
    durationSec: Math.max(0, Math.round(submission.durationSec)),
    certificateNo: saved.certificateNo,
    createdAt: saved.createdAt,
    byCategory,
    review,
    xpAwarded,
    profileXp: saved.profileXp,
  };
}

function currentXp(db: Db, profileId: number): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE id = ?').get(profileId) as
    | { xp: number }
    | undefined;
  return Number(row?.xp ?? 0);
}

export function examHistory(db: Db, profileId: number): ExamHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT id, score, total, correct_count, passed, duration_sec, certificate_no, created_at
       FROM exam_results WHERE profile_id = ? ORDER BY id DESC LIMIT 20`,
    )
    .all(profileId) as unknown as Array<{
    id: number;
    score: number;
    total: number;
    correct_count: number;
    passed: number;
    duration_sec: number;
    certificate_no: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    score: Number(row.score),
    total: Number(row.total),
    correctCount: Number(row.correct_count),
    passed: row.passed === 1,
    durationSec: Number(row.duration_sec),
    certificateNo: row.certificate_no,
    createdAt: row.created_at,
  }));
}

/**
 * Сертификат (§3.9, §10 п.7).
 *
 * Внутренний документ приложения. Оговорка о том, что он не является
 * профессиональной аттестацией и не даёт допуска к работам, приходит вместе с
 * данными: она печатается на самом сертификате, а не показывается рядом.
 */
export const CERTIFICATE_DISCLAIMER =
  'Документ выдан обучающей программой «АртЛандшафт» и подтверждает только прохождение внутреннего курса. ' +
  'Он не является профессиональной аттестацией, не даёт допуска к работам и не заменяет квалификационные документы. ' +
  'Работы с электрооборудованием и присоединение к сетям водоснабжения выполняются квалифицированными специалистами по действующим нормам.';

export function certificate(db: Db, profileId: number, resultId: number): Certificate {
  const row = db
    .prepare(
      `SELECT score, total, correct_count, certificate_no, created_at
       FROM exam_results WHERE id = ? AND profile_id = ? AND passed = 1`,
    )
    .get(resultId, profileId) as
    | {
        score: number;
        total: number;
        correct_count: number;
        certificate_no: string | null;
        created_at: string;
      }
    | undefined;

  if (!row || !row.certificate_no) {
    throw new Error('Сертификат выдаётся только за сданный экзамен.');
  }

  const profile = getProfile(db, profileId);
  if (!profile) throw new Error(`Профиль ${profileId} не найден.`);

  return {
    certificateNo: row.certificate_no,
    profileName: profile.name,
    skillLevelTitle: SKILL_LEVEL_TITLES[profile.skillLevel],
    score: Number(row.score),
    correctCount: Number(row.correct_count),
    total: Number(row.total),
    issuedAt: row.created_at,
    disclaimer: CERTIFICATE_DISCLAIMER,
  };
}

/** Для отчётов и тестов: сколько вопросов в базе и какова доля расчётных. */
export function questionBankStats(db: Db): {
  total: number;
  numeric: number;
  numericShare: number;
  byCategory: Array<{ category: ExamCategory; count: number }>;
} {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n;
  const numeric = (
    db.prepare("SELECT COUNT(*) AS n FROM questions WHERE type = 'numeric'").get() as {
      n: number;
    }
  ).n;

  const rows = db
    .prepare('SELECT category, COUNT(*) AS n FROM questions GROUP BY category')
    .all() as unknown as Array<{ category: ExamCategory; n: number }>;

  return {
    total: Number(total),
    numeric: Number(numeric),
    numericShare: Number(total) === 0 ? 0 : Number(numeric) / Number(total),
    byCategory: rows.map((r) => ({ category: r.category, count: Number(r.n) })),
  };
}

/** Длительность в виде «12 мин 30 с» — используется и в истории, и в разборе. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} мин ${s} с` : `${fmt(s, 0)} с`;
}
