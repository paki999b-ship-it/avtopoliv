import { describe, expect, it } from 'vitest';
import {
  checkNumericAnswer,
  checkSingleAnswer,
  checkMultiAnswer,
  checkMatchAnswer,
  checkScenarioAnswer,
  scoreExam,
  EXAM_PASS_PERCENT,
  EXAM_MIN_NUMERIC_SHARE,
  type QuestionType,
} from './quiz.js';
import { CALCULATORS, findCalculator } from './registry.js';

describe('§3.7 Расчётные вопросы проверяются движком, а не сравнением строк', () => {
  it('засчитывает ответ в пределах допуска', () => {
    const r = checkNumericAnswer(3.9, 3.93, 5);
    expect(r.correct).toBe(true);
    expect(Math.abs(r.deviationPercent)).toBeLessThan(5);
  });

  it('не засчитывает ответ за пределами допуска', () => {
    expect(checkNumericAnswer(4.5, 3.93, 5).correct).toBe(false);
  });

  it('допуск задаётся в процентах от эталона', () => {
    expect(checkNumericAnswer(105, 100, 10).correct).toBe(true);
    expect(checkNumericAnswer(105, 100, 2).correct).toBe(false);
  });

  it('возвращает допустимый интервал для разбора ошибки', () => {
    const r = checkNumericAnswer(50, 100, 10);
    expect(r.acceptedRange.min).toBeCloseTo(90, 6);
    expect(r.acceptedRange.max).toBeCloseTo(110, 6);
  });

  it('корректно работает с нулевым эталоном', () => {
    expect(checkNumericAnswer(0, 0, 5).correct).toBe(true);
    expect(checkNumericAnswer(1, 0, 5).correct).toBe(false);
  });

  it('отклоняет нечисловой ответ', () => {
    expect(checkNumericAnswer(Number.NaN, 10).correct).toBe(false);
  });

  it('работает с отрицательными эталонами (например, перепад высот)', () => {
    expect(checkNumericAnswer(-9.8, -10, 5).correct).toBe(true);
    expect(checkNumericAnswer(-5, -10, 5).correct).toBe(false);
  });
});

describe('Прочие типы вопросов', () => {
  it('одиночный выбор', () => {
    expect(checkSingleAnswer(2, 2)).toBe(true);
    expect(checkSingleAnswer(1, 2)).toBe(false);
  });

  it('множественный выбор требует полного совпадения', () => {
    expect(checkMultiAnswer([1, 3], [3, 1])).toBe(true);
    expect(checkMultiAnswer([1], [1, 3])).toBe(false);
    expect(checkMultiAnswer([1, 2, 3], [1, 3])).toBe(false);
  });

  it('сопоставление считает верные пары', () => {
    const correct = { песок: 'быстро', глина: 'медленно' };
    expect(checkMatchAnswer({ песок: 'быстро', глина: 'медленно' }, correct).correct).toBe(true);
    const partial = checkMatchAnswer({ песок: 'быстро', глина: 'быстро' }, correct);
    expect(partial.correct).toBe(false);
    expect(partial.correctPairs).toBe(1);
    expect(partial.totalPairs).toBe(2);
  });

  it('сценарий «что не так на схеме» штрафует ложные срабатывания', () => {
    const correct = ['e1', 'e2', 'e3'];
    const perfect = checkScenarioAnswer(['e1', 'e2', 'e3'], correct);
    expect(perfect.correct).toBe(true);
    expect(perfect.score).toBe(1);

    const spam = checkScenarioAnswer(['e1', 'e2', 'e3', 'x1', 'x2', 'x3'], correct);
    expect(spam.correct).toBe(false);
    expect(spam.falsePositives).toBe(3);
    expect(spam.score).toBe(0);

    const partial = checkScenarioAnswer(['e1'], correct);
    expect(partial.found).toBe(1);
    expect(partial.missed).toBe(2);
    expect(partial.score).toBeCloseTo(1 / 3, 5);
  });
});

describe('§3.9 Подсчёт результата экзамена', () => {
  const make = (correct: number, total: number, numeric: number) => {
    const rows: { correct: boolean; type: QuestionType }[] = [];
    for (let i = 0; i < total; i++) {
      rows.push({ correct: i < correct, type: i < numeric ? 'numeric' : 'single' });
    }
    return rows;
  };

  it('проходной балл — 75 %', () => {
    expect(EXAM_PASS_PERCENT).toBe(75);
    expect(scoreExam(make(45, 60, 15)).passed).toBe(true);
    expect(scoreExam(make(44, 60, 15)).passed).toBe(false);
  });

  it('считает долю расчётных вопросов в билете', () => {
    const s = scoreExam(make(50, 60, 15));
    expect(s.numericSharePercent).toBe(25);
    expect(s.numericSharePercent).toBeGreaterThanOrEqual(EXAM_MIN_NUMERIC_SHARE);
  });

  it('возвращает полный результат для экрана разбора', () => {
    const s = scoreExam(make(48, 60, 16));
    expect(s.totalQuestions).toBe(60);
    expect(s.correctAnswers).toBe(48);
    expect(s.percent).toBe(80);
    expect(s.passThresholdPercent).toBe(75);
  });

  it('отклоняет экзамен без вопросов', () => {
    expect(() => scoreExam([])).toThrow();
  });
});

describe('Реестр калькуляторов (§3.2, §5)', () => {
  it('содержит все подразделы §5 — с 5.1 по 5.16', () => {
    const specs = CALCULATORS.map((c) => c.spec).sort();
    expect(CALCULATORS).toHaveLength(16);
    for (let i = 1; i <= 16; i++) {
      expect(specs).toContain(`5.${i}`);
    }
  });

  it('ключи уникальны', () => {
    const keys = CALCULATORS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('у каждого калькулятора есть название, формула и связанный урок', () => {
    for (const c of CALCULATORS) {
      expect(c.title.trim()).not.toBe('');
      expect(c.summary.trim()).not.toBe('');
      expect(c.formula.trim()).not.toBe('');
      expect(c.lessonKey.trim()).not.toBe('');
    }
  });

  it('поиск по ключу работает и падает на неизвестном', () => {
    expect(findCalculator('friction-loss').spec).toBe('5.2');
    // @ts-expect-error — проверяем защиту от неизвестного ключа
    expect(() => findCalculator('нет-такого')).toThrow();
  });
});
