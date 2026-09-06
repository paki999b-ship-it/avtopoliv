import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, NumberInput, Select, cx } from '@irrigo/ui';
import type { QuizQuestion, QuizResult } from '@shared/academy.js';
import type { Profile } from '@shared/types.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';

/**
 * Мини-тест урока (§3.1).
 *
 * Ответы проверяет главный процесс расчётным движком: расчётные вопросы
 * сравниваются с допуском, а не строкой (§3.7 ТЗ). Правильные ответы до
 * отправки в renderer не приходят вовсе — подсмотреть их в состоянии нельзя.
 *
 * Порядок завершения тот же, что требует §3.9 для экзамена: посчитать →
 * сохранить → показать результат. Состояние теста не сбрасывается, пока
 * результат не получен.
 */

type Answers = Record<number, number | number[] | string | null>;

interface LessonQuizProps {
  lessonKey: string;
  profile: Profile;
  onCompleted: (result: QuizResult) => void;
  onOpenNext: () => void;
  hasNext: boolean;
}

export function LessonQuiz({
  lessonKey,
  profile,
  onCompleted,
  onOpenNext,
  hasNext,
}: LessonQuizProps) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [startedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    setQuestions(null);
    setAnswers({});
    setResult(null);
    setError(null);

    void invoke('academy:quiz', lessonKey)
      .then((list) => {
        if (!cancelled) setQuestions(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });

    return () => {
      cancelled = true;
    };
  }, [lessonKey]);

  const unanswered = useMemo(() => {
    if (!questions) return 0;
    return questions.filter((q) => {
      const value = answers[q.id];
      if (value === undefined || value === null || value === '') return true;
      if (Array.isArray(value)) return value.length === 0;
      return false;
    }).length;
  }, [questions, answers]);

  if (error) {
    return (
      <Card title="Мини-тест">
        <p className="text-[13px] text-danger">{error}</p>
      </Card>
    );
  }

  if (!questions) return <Card title="Мини-тест">Загрузка вопросов…</Card>;
  if (questions.length === 0) return null;

  async function submit() {
    if (!questions) return;
    setSending(true);
    try {
      const outcome = await invoke('academy:submit', profile.id, {
        lessonKey,
        startedAt,
        answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? null })),
      });
      setResult(outcome);
      onCompleted(outcome);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card
      title="Мини-тест"
      subtitle={
        result
          ? undefined
          : `${pluralize(questions.length, 'вопрос', 'вопроса', 'вопросов')} · проходной балл 70 %`
      }
      actions={
        result ? (
          <Badge tone={result.passed ? 'ok' : 'warn'}>
            {result.correctCount} из {result.total}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {questions.map((question, index) => {
          const answerResult = result?.answers.find((a) => a.questionId === question.id);

          return (
            <div key={question.id}>
              <p className="text-[15px] font-medium mb-3">
                <span className="text-dim mr-2">{index + 1}.</span>
                {question.prompt}
              </p>

              <QuestionInput
                question={question}
                value={answers[question.id] ?? null}
                disabled={result !== null}
                onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
              />

              {answerResult && (
                <div
                  className={cx(
                    'mt-3 p-3.5 rounded-lg border text-[13px]',
                    answerResult.correct
                      ? 'border-ok/35 bg-ok-dim'
                      : 'border-danger/35 bg-danger-dim',
                  )}
                >
                  <p className="font-medium">
                    {answerResult.correct ? '✓ Верно' : '✕ Неверно'}
                    {!answerResult.correct && (
                      <span className="font-normal text-muted">
                        {' '}
                        · правильный ответ: {answerResult.correctAnswer}
                      </span>
                    )}
                    {answerResult.deviationPercent !== undefined && !answerResult.correct && (
                      <span className="font-normal text-dim">
                        {' '}
                        (отклонение {answerResult.deviationPercent} %)
                      </span>
                    )}
                  </p>
                  <p className="text-muted mt-1.5 leading-relaxed">{answerResult.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-5 border-t border-border">
        {!result ? (
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={sending} onClick={() => void submit()}>
              Проверить
            </Button>
            {unanswered > 0 && (
              <span className="text-[13px] text-dim">
                Без ответа: {unanswered}. Их зачтут как неверные.
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[14px]">
              {result.passed ? (
                <span className="text-ok">Урок засчитан.</span>
              ) : (
                <span className="text-warn">
                  Для зачёта нужно 70 %. Перечитайте урок и попробуйте снова.
                </span>
              )}
              {result.xpAwarded > 0 && (
                <span className="text-muted"> Начислено {result.xpAwarded} XP.</span>
              )}
              {result.passed && result.xpAwarded === 0 && (
                <span className="text-dim"> XP за этот урок уже был начислен раньше.</span>
              )}
            </p>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnswers({});
                setResult(null);
              }}
            >
              Пройти заново
            </Button>
            {result.passed && hasNext && (
              <Button variant="primary" size="sm" onClick={onOpenNext}>
                Следующий урок →
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Ввод ответа. Экспортируется, потому что экзамен (§3.9) показывает вопросы
 * теми же элементами: заводить второй набор полей — значит получить два
 * разных поведения на одном и том же типе вопроса.
 */
export function QuestionInput({
  question,
  value,
  disabled,
  onChange,
}: {
  question: QuizQuestion;
  value: number | number[] | string | null;
  disabled: boolean;
  onChange: (value: number | number[] | string | null) => void;
}) {
  if (question.type === 'numeric') {
    return (
      <div className="flex items-center gap-2 max-w-xs">
        <NumberInput
          value={typeof value === 'number' ? value : null}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        />
        {question.unit && <span className="text-[13px] text-dim shrink-0">{question.unit}</span>}
      </div>
    );
  }

  if (question.type === 'match') {
    const right = question.matchOptions ?? [];
    const current = Array.isArray(value) ? value : question.options.map(() => -1);

    return (
      <div className="flex flex-col gap-2">
        {question.options.map((left, index) => (
          <div key={index} className="flex items-center gap-3">
            <span className="text-[14px] min-w-40">{left}</span>
            <span className="text-dim">→</span>
            <Select
              disabled={disabled}
              value={current[index] === -1 ? '' : String(current[index])}
              onChange={(e) => {
                const next = [...current];
                next[index] = e.target.value === '' ? -1 : Number(e.target.value);
                onChange(next);
              }}
              className="max-w-64"
            >
              <option value="">выберите</option>
              {right.map((option, i) => (
                <option key={i} value={i}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    );
  }

  const multi = question.type === 'multi';
  const selected = multi
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === 'number'
      ? [value]
      : [];

  return (
    <div className="flex flex-col gap-2">
      {question.options.map((option, index) => {
        const checked = selected.includes(index);
        return (
          <label
            key={index}
            className={cx(
              'flex items-start gap-3 p-3 rounded-lg border transition-colors',
              disabled ? 'cursor-default' : 'cursor-pointer',
              checked
                ? 'border-accent bg-accent/10'
                : 'border-border bg-surface-2 hover:border-border-strong',
            )}
          >
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={`q-${question.id}`}
              checked={checked}
              disabled={disabled}
              onChange={() => {
                if (multi) {
                  onChange(
                    checked ? selected.filter((i) => i !== index) : [...selected, index].sort(),
                  );
                } else {
                  onChange(index);
                }
              }}
              className="mt-1 accent-[rgb(var(--iw-accent))]"
            />
            <span className="text-[14px]">{option}</span>
          </label>
        );
      })}
      {multi && (
        <p className="text-[12px] text-dim">Верных вариантов может быть несколько.</p>
      )}
    </div>
  );
}
