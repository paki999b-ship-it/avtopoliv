import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, ProgressBar, Stat, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type { QuizAnswer } from '@shared/academy.js';
import type {
  Certificate,
  ExamHistoryEntry,
  ExamPaper,
  ExamResult,
} from '@shared/exam.js';
import { EXAM_CATEGORY_TITLES } from '@shared/exam.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';
import { QuestionInput } from '../components/LessonQuiz.js';

/**
 * Экзамен и сертификат (§3.9 ТЗ).
 *
 * Порядок завершения соблюдается буквально: `exam:submit` считает и сохраняет
 * результат в одной операции, и только после её успешного возврата экран
 * переключается на разбор. Ответы из состояния при этом не стираются — если
 * запись не удалась, пользователю есть куда вернуться.
 */

/** По сколько вопросов на страницу: шестьдесят в один список не читаются. */
const PAGE_SIZE = 10;

type Phase = 'intro' | 'running' | 'result' | 'certificate';

export function Exam() {
  const profile = useSession((s) => s.activeProfile);
  const [phase, setPhase] = useState<Phase>('intro');
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      {error && (
        <div className="mb-5 rounded-xl border border-danger/40 bg-danger-dim px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      {phase === 'intro' && (
        <Intro
          onStart={(loaded) => {
            setPaper(loaded);
            setResult(null);
            setPhase('running');
          }}
          onError={setError}
        />
      )}

      {phase === 'running' && paper && (
        <Paper
          paper={paper}
          profileId={profile.id}
          onFinished={(outcome) => {
            // Результат уже сохранён главным процессом — только теперь
            // переключаем экран.
            setResult(outcome);
            setPhase('result');
          }}
          onError={setError}
        />
      )}

      {phase === 'result' && result && (
        <Review
          result={result}
          onRetry={() => {
            setPaper(null);
            setResult(null);
            setPhase('intro');
          }}
          onCertificate={() => setPhase('certificate')}
        />
      )}

      {phase === 'certificate' && result && (
        <CertificateView
          profileId={profile.id}
          resultId={result.id}
          onBack={() => setPhase('result')}
          onError={setError}
        />
      )}
    </div>
  );
}

function Intro({
  onStart,
  onError,
}: {
  onStart: (paper: ExamPaper) => void;
  onError: (message: string) => void;
}) {
  const profile = useSession((s) => s.activeProfile)!;
  const navigate = useRouter((s) => s.navigate);
  const [history, setHistory] = useState<ExamHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void invoke('exam:history', profile.id)
      .then((list) => !cancelled && setHistory(list))
      .catch((e) => !cancelled && onError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  async function start() {
    setLoading(true);
    try {
      onStart(await invoke('exam:paper'));
    } catch (e) {
      onError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  const best = history?.find((h) => h.passed);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Экзамен</h1>
        <p className="text-muted mt-1">
          60 вопросов по всем восьми темам курса, не менее четверти из них — расчётные.
          Проходной балл 75 %. На работу отводится один час.
        </p>
      </header>

      <Card className="mb-5" title="Как проходит экзамен">
        <ul className="flex flex-col gap-2 text-[14px] leading-relaxed">
          <li>Вопросы идут страницами по {PAGE_SIZE}; между страницами можно возвращаться.</li>
          <li>Вопрос без ответа засчитывается как неверный.</li>
          <li>Когда время выйдет, работа отправляется автоматически с тем, что уже отмечено.</li>
          <li>После завершения открывается разбор всех ошибок со ссылками на уроки.</li>
        </ul>
      </Card>

      <div className="rounded-xl border border-warn/40 bg-warn-dim px-5 py-4 mb-6 text-[13px] leading-relaxed">
        Сертификат — внутренний документ приложения. Он подтверждает прохождение курса, но не
        является профессиональной аттестацией и не даёт допуска к работам.
      </div>

      {history && history.length > 0 && (
        <Card className="mb-6" title="Прошлые попытки">
          <div className="flex flex-col gap-2">
            {history.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 text-[13px]">
                <Badge tone={entry.passed ? 'ok' : 'warn'}>{fmt(entry.score * 100, 0)} %</Badge>
                <span className="text-muted">
                  {entry.correctCount} из {entry.total}
                </span>
                <span className="text-dim flex-1">{entry.createdAt}</span>
                {entry.certificateNo && (
                  <span className="iw-num text-[12px] text-dim">{entry.certificateNo}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={loading} onClick={() => void start()}>
          {loading ? 'Готовлю билет…' : best ? 'Пройти ещё раз' : 'Начать экзамен'}
        </Button>
        <Button variant="ghost" onClick={() => navigate({ name: 'academy' })}>
          Вернуться в Академию
        </Button>
      </div>
    </>
  );
}

function Paper({
  paper,
  profileId,
  onFinished,
  onError,
}: {
  paper: ExamPaper;
  profileId: number;
  onFinished: (result: ExamResult) => void;
  onError: (message: string) => void;
}) {
  const refreshProgress = useSession((s) => s.refreshProgress);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [page, setPage] = useState(0);
  const [sending, setSending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(paper.timeLimitMinutes * 60);

  const startedAt = useMemo(() => new Date().toISOString(), []);
  const startedMs = useRef(Date.now());
  // Отправка запускается и таймером, и кнопкой — защищаемся от двойной.
  const submitting = useRef(false);

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSending(true);

    try {
      // Расчёт и сохранение — одна операция главного процесса. Состояние
      // ответов не сбрасывается: если запись не удалась, работа не потеряна.
      const outcome = await invoke('exam:submit', profileId, {
        startedAt,
        durationSec: Math.round((Date.now() - startedMs.current) / 1000),
        answers: paper.questions.map((q) => ({
          questionId: q.id,
          answer: answers[q.id] ?? null,
        })),
      });

      await refreshProgress();
      onFinished(outcome);
    } catch (e) {
      onError(errorText(e));
      submitting.current = false;
      setSending(false);
    }
  }, [answers, paper, profileId, startedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((left) => {
        if (left <= 1) {
          clearInterval(timer);
          void submit();
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submit]);

  const pages = Math.ceil(paper.questions.length / PAGE_SIZE);
  const shown = paper.questions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const answered = paper.questions.filter((q) => {
    const value = answers[q.id];
    if (value === undefined || value === null || value === '') return false;
    return Array.isArray(value) ? value.length > 0 : true;
  }).length;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const running = secondsLeft > 0;

  return (
    <>
      <header className="flex items-baseline justify-between gap-4 mb-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Экзамен</h1>
        <span
          className={cx(
            'iw-num text-[18px] font-semibold tabular-nums',
            secondsLeft < 300 ? 'text-danger' : 'text-muted',
          )}
        >
          {minutes}:{String(seconds).padStart(2, '0')}
        </span>
      </header>

      <ProgressBar
        className="mb-6"
        value={answered / paper.questions.length}
        label="Отвечено"
        hint={`${answered} из ${paper.questions.length}`}
      />

      <div className="flex flex-col gap-7">
        {shown.map((question, index) => (
          <div key={question.id}>
            <p className="text-[15px] font-medium mb-1">
              <span className="text-dim mr-2">{page * PAGE_SIZE + index + 1}.</span>
              {question.prompt}
            </p>
            <p className="text-[12px] text-dim mb-3">
              {EXAM_CATEGORY_TITLES[question.category]}
            </p>
            <QuestionInput
              question={question}
              value={answers[question.id] ?? null}
              disabled={sending || !running}
              onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-8 pt-5 border-t border-border">
        <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Назад
        </Button>
        <span className="text-[13px] text-dim">
          Страница {page + 1} из {pages}
        </span>
        <Button
          variant="ghost"
          disabled={page >= pages - 1}
          onClick={() => setPage(page + 1)}
        >
          Дальше →
        </Button>

        <div className="flex-1" />

        <Button variant="primary" disabled={sending} onClick={() => void submit()}>
          {sending ? 'Проверяю и сохраняю…' : 'Завершить экзамен'}
        </Button>
      </div>

      {answered < paper.questions.length && (
        <p className="text-[13px] text-dim mt-3">
          Без ответа: {paper.questions.length - answered}. Они будут зачтены как неверные.
        </p>
      )}
    </>
  );
}

function Review({
  result,
  onRetry,
  onCertificate,
}: {
  result: ExamResult;
  onRetry: () => void;
  onCertificate: () => void;
}) {
  const navigate = useRouter((s) => s.navigate);
  const [onlyErrors, setOnlyErrors] = useState(true);

  const shown = onlyErrors ? result.review.filter((r) => !r.correct) : result.review;
  const minutes = Math.floor(result.durationSec / 60);

  return (
    <>
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-[26px] font-semibold tracking-tight">
            {result.passed ? 'Экзамен сдан' : 'Экзамен не сдан'}
          </h1>
          <Badge tone={result.passed ? 'ok' : 'warn'}>{fmt(result.score * 100, 0)} %</Badge>
        </div>
        <p className="text-muted">
          {result.correctCount} правильных из {result.total} · {minutes}{' '}
          {pluralize(minutes, 'минута', 'минуты', 'минут')} · расчётных вопросов{' '}
          {fmt(result.numericShare * 100, 0)} %
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Результат" value={`${fmt(result.score * 100, 0)} %`} />
        <Stat label="Проходной балл" value="75 %" />
        <Stat
          label="XP за экзамен"
          value={result.xpAwarded > 0 ? `+${result.xpAwarded}` : '—'}
          hint={result.passed && result.xpAwarded === 0 ? 'уже начислялся' : undefined}
        />
      </div>

      <Card className="mb-6" title="По темам">
        <div className="flex flex-col gap-2">
          {result.byCategory.map((row) => (
            <div key={row.category} className="flex items-center gap-3">
              <span className="text-[13px] w-56 shrink-0">
                {EXAM_CATEGORY_TITLES[row.category]}
              </span>
              <ProgressBar className="flex-1" value={row.correct / row.total} />
              <span className="iw-num text-[12px] text-dim w-14 text-right">
                {row.correct}/{row.total}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        {result.passed && result.certificateNo && (
          <Button variant="primary" onClick={onCertificate}>
            Открыть сертификат
          </Button>
        )}
        <Button variant="ghost" onClick={onRetry}>
          Пройти ещё раз
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setOnlyErrors(!onlyErrors)}>
          {onlyErrors ? 'Показать все вопросы' : 'Только ошибки'}
        </Button>
      </div>

      <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">
        Разбор {onlyErrors ? 'ошибок' : 'всех вопросов'} ({shown.length})
      </h2>

      <div className="flex flex-col gap-3">
        {shown.map((item) => (
          <div
            key={item.questionId}
            className={cx(
              'rounded-xl border p-4',
              item.correct ? 'border-ok/35 bg-ok-dim/40' : 'border-danger/35 bg-danger-dim/40',
            )}
          >
            <p className="text-[14px] font-medium mb-2">{item.prompt}</p>
            <p className="text-[13px] text-muted">
              Ваш ответ: {item.givenAnswer}
              {!item.correct && (
                <>
                  {' · '}
                  правильный: <span className="text-fg">{item.correctAnswer}</span>
                </>
              )}
              {item.deviationPercent !== undefined && !item.correct && (
                <span className="text-dim"> (отклонение {item.deviationPercent} %)</span>
              )}
            </p>
            <p className="text-[13px] text-muted mt-2 leading-relaxed">{item.explanation}</p>
            {item.lessonKey && (
              <Button
                className="mt-2"
                variant="ghost"
                size="sm"
                onClick={() => navigate({ name: 'lesson', lessonKey: item.lessonKey! })}
              >
                Урок: {item.lessonTitle}
              </Button>
            )}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="text-[14px] text-ok">Ошибок нет — все ответы верные.</p>
        )}
      </div>
    </>
  );
}

function CertificateView({
  profileId,
  resultId,
  onBack,
  onError,
}: {
  profileId: number;
  resultId: number;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const [cert, setCert] = useState<Certificate | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke('exam:certificate', profileId, resultId)
      .then((data) => !cancelled && setCert(data))
      .catch((e) => !cancelled && onError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profileId, resultId]);

  if (!cert) return <div className="py-8 text-dim">Готовлю сертификат…</div>;

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="text-[13px] text-dim hover:text-fg transition-colors mb-4"
      >
        ← К разбору
      </button>

      <div className="rounded-2xl border-2 border-accent/40 bg-surface-2 px-10 py-10 text-center">
        <p className="text-[12px] uppercase tracking-[0.2em] text-dim">АртЛандшафт</p>
        <h1 className="text-[24px] font-semibold tracking-tight mt-3">
          Свидетельство о прохождении курса
        </h1>
        <p className="text-muted mt-1">«Автоматический полив»</p>

        <p className="text-[20px] font-medium mt-8">{cert.profileName}</p>
        <p className="text-[13px] text-muted mt-1">уровень подачи: {cert.skillLevelTitle}</p>

        <p className="text-[14px] mt-6 leading-relaxed">
          прошёл(-ла) итоговую проверку знаний с результатом{' '}
          <span className="iw-num font-semibold">{fmt(cert.score * 100, 0)} %</span> (
          {cert.correctCount} из {cert.total})
        </p>

        <div className="flex items-center justify-center gap-6 mt-8 text-[12px] text-dim">
          <span className="iw-num">№ {cert.certificateNo}</span>
          <span>{cert.issuedAt}</span>
        </div>

        <p className="text-[12px] text-muted leading-relaxed mt-8 pt-6 border-t border-border">
          {cert.disclaimer}
        </p>
      </div>
    </>
  );
}
