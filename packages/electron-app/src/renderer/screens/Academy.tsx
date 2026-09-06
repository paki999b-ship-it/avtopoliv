import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ProgressBar, cx } from '@irrigo/ui';
import type { AcademyLevel, LessonDetail, LessonSummary, LevelInfo } from '@shared/academy.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';
import { LessonBlocks } from '../components/LessonBlocks.js';
import { LessonQuiz } from '../components/LessonQuiz.js';
import { SKILL_LEVELS } from '../lib/sections.js';

/**
 * Академия (§3.1 ТЗ): шесть уровней, уроки, мини-тесты и XP.
 *
 * Все уровни открыты сразу. Порядок изучения — рекомендация: монтажнику может
 * понадобиться сразу раздел о монтаже, не проходя основы. Закрыты только
 * уровни, контент которых ещё не написан.
 */
export function Academy() {
  const route = useRouter((s) => s.route);

  if (route.name === 'lesson') return <LessonView lessonKey={route.lessonKey} />;
  if (route.name === 'academy' && route.level) {
    return <LevelView level={route.level as AcademyLevel} />;
  }
  return <LevelList />;
}

function LevelList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [levels, setLevels] = useState<LevelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('academy:levels', profile.id)
      .then((list) => {
        if (!cancelled) setLevels(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!levels) return <div className="px-8 py-8 text-dim">Загрузка курса…</div>;

  const skill = SKILL_LEVELS.find((s) => s.value === profile.skillLevel);
  const totalLessons = levels.reduce((sum, l) => sum + l.lessons, 0);
  const totalDone = levels.reduce((sum, l) => sum + l.completed, 0);

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Академия</h1>
        <p className="text-muted mt-1">
          Курс «Автоматический полив» из шести уровней. Материал подаётся на уровне «
          {skill?.title ?? profile.skillLevel}» — переключается в настройках профиля.
        </p>
      </header>

      {totalLessons > 0 && (
        <ProgressBar
          className="mb-7"
          value={totalDone / totalLessons}
          label="Пройдено уроков"
          hint={`${totalDone} из ${totalLessons}`}
        />
      )}

      <div className="flex flex-col gap-3">
        {levels.map((level) => {
          // Недоступен только уровень, у которого ещё нет уроков.
          const empty = level.lessons === 0;

          return (
            <button
              key={level.key}
              type="button"
              disabled={empty}
              onClick={() => navigate({ name: 'academy', level: level.key })}
              className={cx(
                'flex items-start gap-4 p-4 text-left rounded-xl border transition-colors',
                empty
                  ? 'bg-surface/50 border-border cursor-not-allowed'
                  : 'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
              )}
            >
              <span className={cx('text-2xl shrink-0 mt-0.5', empty && 'opacity-40')} aria-hidden>
                {level.icon}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cx('font-medium', empty && 'text-muted')}>
                    Уровень {level.order}. {level.title}
                  </span>
                  {empty ? (
                    <Badge>в разработке</Badge>
                  ) : level.completed === level.lessons ? (
                    <Badge tone="ok">пройден</Badge>
                  ) : (
                    <span className="iw-num text-[12px] text-dim shrink-0">
                      {level.completed}/{level.lessons}
                    </span>
                  )}
                </span>

                <span className="block text-[13px] text-muted mt-1">{level.subtitle}</span>

                {!empty && (
                  <span className="block mt-3">
                    <ProgressBar
                      size="sm"
                      value={level.completed / level.lessons}
                      hint={`${level.xpEarned} из ${level.xpAvailable} XP`}
                    />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <Card title="Как устроен курс" className="mt-8">
        <ul className="text-[13px] text-muted space-y-2 list-disc pl-5">
          <li>
            Каждый урок заканчивается мини-тестом. Урок засчитывается с 70 % правильных
            ответов, XP начисляется один раз.
          </li>
          <li>
            Расчётные вопросы проверяются тем же движком, что и калькуляторы: сравнивается
            число с допуском, а не текст ответа.
          </li>
          <li>
            Все уровни открыты сразу — порядок изучения остаётся рекомендацией. Материал
            уровней 3–6 опирается на понятия первых двух, но читать курс можно и выборочно.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function LevelView({ level }: { level: AcademyLevel }) {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [levels, setLevels] = useState<LevelInfo[] | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void Promise.all([
      invoke('academy:lessons', profile.id, level),
      invoke('academy:levels', profile.id),
    ]).then(([list, all]) => {
      if (cancelled) return;
      setLessons(list);
      setLevels(all);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, level]);

  if (!profile) return null;
  if (!lessons || !levels) return <div className="px-8 py-8 text-dim">Загрузка уровня…</div>;

  const info = levels.find((l) => l.key === level);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <button
        type="button"
        onClick={() => navigate({ name: 'academy' })}
        className="text-[13px] text-dim hover:text-text transition-colors mb-1"
      >
        ← Все уровни
      </button>

      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight">
          {info?.icon} Уровень {info?.order}. {info?.title}
        </h1>
        <p className="text-muted mt-1">{info?.subtitle}</p>
      </header>

      {lessons.length === 0 ? (
        <EmptyState
          title="Уроки этого уровня ещё не написаны"
          description="Уровень появится в приложении по мере наполнения курса."
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {lessons.map((lesson, index) => (
            <li key={lesson.key}>
              <button
                type="button"
                onClick={() => navigate({ name: 'lesson', lessonKey: lesson.key })}
                className={cx(
                  'w-full flex items-start gap-4 p-4 text-left rounded-xl border transition-colors',
                  'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
                )}
              >
                <span
                  className={cx(
                    'w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[13px] mt-0.5',
                    lesson.status === 'completed'
                      ? 'bg-ok-dim text-ok border border-ok/40'
                      : 'bg-surface-3 text-dim border border-border',
                  )}
                >
                  {lesson.status === 'completed' ? '✓' : index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{lesson.title}</span>
                  <span className="block text-[13px] text-muted mt-0.5">{lesson.summary}</span>
                  <span className="block text-[12px] text-dim mt-2">
                    {lesson.readingMinutes} мин чтения ·{' '}
                    {pluralize(lesson.questions, 'вопрос', 'вопроса', 'вопросов')} · {lesson.xpAward} XP
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LessonView({ lessonKey }: { lessonKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const navigate = useRouter((s) => s.navigate);

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLesson(null);
    setError(null);

    void invoke('academy:lesson', profile.id, lessonKey)
      .then((detail) => {
        if (!cancelled) setLesson(detail);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.id, lessonKey]);

  if (!profile) return null;

  if (error) {
    return (
      <div className="px-8 py-8">
        <EmptyState
          title="Урок не открылся"
          description={error}
          action={
            <Button variant="secondary" onClick={() => navigate({ name: 'academy' })}>
              К списку уровней
            </Button>
          }
        />
      </div>
    );
  }

  if (!lesson) return <div className="px-8 py-8 text-dim">Загрузка урока…</div>;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <button
        type="button"
        onClick={() => navigate({ name: 'academy', level: lesson.level })}
        className="text-[13px] text-dim hover:text-text transition-colors mb-1"
      >
        ← К урокам уровня
      </button>

      <header className="mb-7">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[26px] font-semibold tracking-tight">{lesson.title}</h1>
          {lesson.status === 'completed' && <Badge tone="ok">пройден</Badge>}
        </div>
        <p className="text-muted mt-2">{lesson.summary}</p>
        <p className="text-[12px] text-dim mt-2">
          {lesson.readingMinutes} мин чтения · {lesson.xpAward} XP
        </p>
      </header>

      <article>
        <LessonBlocks
          blocks={lesson.blocks}
          skillLevel={profile.skillLevel}
          onOpenCalculator={(key) => navigate({ name: 'calculators', calculatorKey: key })}
          onOpenReference={(section, table) => navigate({ name: 'reference', section, table })}
          onOpenTerm={(term) => navigate({ name: 'reference', section: 'glossary', query: term })}
        />
      </article>

      <div className="mt-10">
        <LessonQuiz
          lessonKey={lesson.key}
          profile={profile}
          hasNext={lesson.nextKey !== null}
          onCompleted={() => {
            void refreshProgress();
            // Статус урока в шапке должен обновиться сразу после зачёта.
            void invoke('academy:lesson', profile.id, lessonKey).then(setLesson);
          }}
          onOpenNext={() => {
            if (lesson.nextKey) navigate({ name: 'lesson', lessonKey: lesson.nextKey });
          }}
        />
      </div>

      <footer className="flex items-center justify-between gap-4 mt-8 pt-5 border-t border-border">
        {lesson.previousKey ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ name: 'lesson', lessonKey: lesson.previousKey! })}
          >
            ← Предыдущий урок
          </Button>
        ) : (
          <span />
        )}
        <span className="text-[12px] text-dim text-right max-w-md">Источник: {lesson.source}</span>
        {lesson.nextKey ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ name: 'lesson', lessonKey: lesson.nextKey! })}
          >
            Следующий урок →
          </Button>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
}
