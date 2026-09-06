import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ProgressBar, Stat, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type {
  ScenarioCategory,
  ScenarioDetail,
  ScenarioResult,
  ScenarioSummary,
} from '@shared/scenarios.js';
import { SCENARIO_CATEGORIES } from '@shared/scenarios.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';

/**
 * Тренажёр «Найди ошибку» (§3.5 ТЗ).
 *
 * Что ошибочно, а что нет, интерфейс не знает до отправки ответа: разбор
 * приходит вместе с результатом. Иначе задание решалось бы чтением ответа
 * главного процесса, а не разбором объекта.
 *
 * Правило счёта объявляется до начала: находка плюс, ложное срабатывание
 * минус того же веса. Скрытый штраф выглядел бы как ошибка программы.
 */

/** Совпадает с `SCENARIO_PASS_SCORE` главного процесса — показывается пользователю. */
const PASS_SCORE = 0.75;

export function ErrorHunt() {
  const route = useRouter((s) => s.route);
  const scenarioKey = route.name === 'errors' ? route.scenarioKey : undefined;

  return scenarioKey ? <ScenarioView scenarioKey={scenarioKey} /> : <ScenarioList />;
}

const CATEGORY_ORDER: ScenarioCategory[] = [
  'hydraulics',
  'layout',
  'control_unit',
  'drip',
  'electrical',
  'source',
  'operation',
  'safety',
];

function ScenarioList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [items, setItems] = useState<ScenarioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScenarioCategory | 'all'>('all');

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('scenarios:list', profile.id)
      .then((list) => !cancelled && setItems(list))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  const groups = useMemo(() => {
    if (!items) return [];
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: items.filter((s) => s.category === category),
    })).filter((g) => g.items.length > 0 && (filter === 'all' || g.category === filter));
  }, [items, filter]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!items) return <div className="px-8 py-8 text-dim">Загрузка сценариев…</div>;

  const done = items.filter((s) => s.completed).length;
  const present = CATEGORY_ORDER.filter((c) => items.some((s) => s.category === c));

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Найди ошибку</h1>
        <p className="text-muted mt-1">
          В каждом сценарии описан объект и перечислены факты о нём. Часть узлов выполнена
          неверно — отметьте их. Верно выполненный узел, отмеченный как ошибка, снимает
          столько же, сколько добавляет находка.
        </p>
      </header>

      <ProgressBar
        className="mb-6"
        value={done / items.length}
        label="Разобрано сценариев"
        hint={`${done} из ${items.length}`}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          Все темы
        </FilterChip>
        {present.map((category) => (
          <FilterChip
            key={category}
            active={filter === category}
            onClick={() => setFilter(category)}
          >
            {SCENARIO_CATEGORIES[category]}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">
              {SCENARIO_CATEGORIES[group.category]}
            </h2>
            <div className="flex flex-col gap-3">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate({ name: 'errors', scenarioKey: item.key })}
                  className={cx(
                    'flex items-start gap-4 p-4 text-left rounded-xl border transition-colors',
                    'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cx(
                      'w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[13px] mt-0.5',
                      item.completed
                        ? 'bg-ok-dim text-ok border border-ok/40'
                        : 'bg-surface-3 text-dim border border-border',
                    )}
                  >
                    {item.completed ? '✓' : item.difficulty}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{item.title}</span>
                      {item.bestScore !== null && (
                        <span className="iw-num text-[12px] text-dim shrink-0">
                          лучший результат {fmt(item.bestScore * 100, 0)} %
                        </span>
                      )}
                    </span>
                    <span className="block text-[12px] text-dim mt-2">
                      {pluralize(item.errorCount, 'ошибка', 'ошибки', 'ошибок')} · сложность{' '}
                      {item.difficulty} ·{' '}
                      {item.attempts === 0
                        ? 'попыток не было'
                        : pluralize(item.attempts, 'попытка', 'попытки', 'попыток')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'px-3 py-1.5 rounded-lg border text-[13px] transition-colors',
        active
          ? 'bg-accent/15 border-accent/40 text-accent-ink'
          : 'bg-surface border-border text-muted hover:border-border-strong',
      )}
    >
      {children}
    </button>
  );
}

function ScenarioView({ scenarioKey }: { scenarioKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const navigate = useRouter((s) => s.navigate);
  const back = useRouter((s) => s.back);

  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setDetail(null);
    setResult(null);
    setMarked(new Set());
    void invoke('scenarios:detail', profile.id, scenarioKey)
      .then((data) => !cancelled && setDetail(data))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id, scenarioKey]);

  const groups = useMemo(() => {
    if (!detail) return [];
    const order: string[] = [];
    const byGroup = new Map<string, ScenarioDetail['items']>();
    for (const item of detail.items) {
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        order.push(item.group);
      }
      byGroup.get(item.group)!.push(item);
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
  }, [detail]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!detail) return <div className="px-8 py-8 text-dim">Загрузка сценария…</div>;

  const reviewByKey = new Map((result?.review ?? []).map((r) => [r.key, r]));

  async function submit() {
    setSending(true);
    try {
      const outcome = await invoke('scenarios:submit', profile!.id, {
        scenarioKey,
        markedKeys: [...marked],
      });
      setResult(outcome);
      await refreshProgress();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  function retry() {
    setResult(null);
    setMarked(new Set());
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <button
        type="button"
        onClick={back}
        className="text-[13px] text-dim hover:text-fg transition-colors mb-4"
      >
        ← Все сценарии
      </button>

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge tone="info">{SCENARIO_CATEGORIES[detail.category]}</Badge>
          <Badge>сложность {detail.difficulty}</Badge>
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight">{detail.title}</h1>
      </header>

      <Card className="mb-6" title="Объект">
        <p className="text-[14px] leading-relaxed">{detail.description}</p>
      </Card>

      {!result && (
        <p className="text-[13px] text-muted mb-4">
          Спрятано {pluralize(detail.errorCount, 'ошибка', 'ошибки', 'ошибок')}. Отмечено{' '}
          <span className="iw-num">{marked.size}</span>. Проходной балл{' '}
          {fmt(PASS_SCORE * 100, 0)} %.
        </p>
      )}

      {result && <ResultBanner result={result} />}

      <div className="flex flex-col gap-6">
        {groups.map(({ group, items }) => (
          <section key={group}>
            <h2 className="text-[13px] uppercase tracking-wider text-dim mb-2">{group}</h2>
            <div className="flex flex-col gap-2">
              {items.map((item) => {
                const review = reviewByKey.get(item.key);
                const isMarked = review ? review.marked : marked.has(item.key);
                const verdict = review
                  ? review.isError
                    ? review.marked
                      ? 'found'
                      : 'missed'
                    : review.marked
                      ? 'false'
                      : 'clean'
                  : null;

                return (
                  <div
                    key={item.key}
                    className={cx(
                      'rounded-xl border transition-colors',
                      verdict === 'found' && 'bg-ok-dim/40 border-ok/45',
                      verdict === 'missed' && 'bg-warn-dim/40 border-warn/45',
                      verdict === 'false' && 'bg-danger-dim/40 border-danger/45',
                      verdict === 'clean' && 'bg-surface border-border',
                      !verdict &&
                        (isMarked
                          ? 'bg-accent/10 border-accent/45'
                          : 'bg-surface border-border hover:border-border-strong'),
                    )}
                  >
                    <button
                      type="button"
                      disabled={Boolean(result)}
                      onClick={() =>
                        setMarked((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                      className="w-full flex items-start gap-3 p-3 text-left disabled:cursor-default"
                    >
                      <span
                        className={cx(
                          'w-5 h-5 mt-0.5 shrink-0 rounded-md border flex items-center justify-center text-[12px]',
                          isMarked
                            ? 'bg-accent/25 border-accent/60 text-accent-ink'
                            : 'border-border-strong text-transparent',
                        )}
                        aria-hidden
                      >
                        ✓
                      </span>
                      <span className="flex-1 text-[14px]">{item.label}</span>
                      {verdict && <VerdictBadge verdict={verdict} />}
                    </button>

                    {review && (
                      <div className="px-3 pb-3 pl-11">
                        <p className="text-[13px] text-muted leading-relaxed">
                          {review.explanation}
                        </p>
                        {(review.lessonKey || review.calculatorKey) && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {review.lessonKey && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  navigate({ name: 'lesson', lessonKey: review.lessonKey! })
                                }
                              >
                                Открыть урок
                              </Button>
                            )}
                            {review.calculatorKey && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  navigate({
                                    name: 'calculators',
                                    calculatorKey: review.calculatorKey!,
                                  })
                                }
                              >
                                Посчитать
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-7">
        {result ? (
          <>
            <Button onClick={retry}>Пройти заново</Button>
            <Button variant="ghost" onClick={back}>
              К списку сценариев
            </Button>
          </>
        ) : (
          <Button onClick={submit} disabled={sending || marked.size === 0}>
            {sending ? 'Проверяю…' : 'Проверить'}
          </Button>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: 'found' | 'missed' | 'false' | 'clean' }) {
  switch (verdict) {
    case 'found':
      return <Badge tone="ok">Найдено</Badge>;
    case 'missed':
      return <Badge tone="warn">Пропущено</Badge>;
    case 'false':
      return <Badge tone="danger">Здесь всё верно</Badge>;
    default:
      return <Badge>Верно, не отмечено</Badge>;
  }
}

function ResultBanner({ result }: { result: ScenarioResult }) {
  return (
    <Card
      className="mb-6"
      title={result.passed ? 'Сценарий разобран' : 'Разобран не полностью'}
      actions={
        <Badge tone={result.passed ? 'ok' : 'warn'}>{fmt(result.score * 100, 0)} %</Badge>
      }
    >
      <div className="grid grid-cols-3 gap-4 mb-3">
        <Stat label="Найдено ошибок" value={`${result.foundCount} из ${result.totalErrors}`} />
        <Stat label="Отмечено лишнего" value={String(result.falsePositiveCount)} />
        <Stat label="Лучший результат" value={`${fmt(result.bestScore * 100, 0)} %`} />
      </div>
      <p className="text-[13px] text-muted">
        Ниже разобран каждый пункт: и найденные ошибки, и пропущенные, и то, что было
        отмечено напрасно.
        {result.xpAwarded > 0 && (
          <span className="text-fg"> Начислено {result.xpAwarded} XP.</span>
        )}
      </p>
    </Card>
  );
}
