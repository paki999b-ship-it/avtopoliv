import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, ProgressBar, Stat, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type {
  AssemblyPart,
  AssemblyResult,
  AssemblySlotView,
  AssemblyTaskDetail,
  AssemblyTaskSummary,
} from '@shared/assembly.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';

/**
 * Тренажёр «Сборка узла насоса» (уровень 7).
 *
 * Расстановка сделана выбором, а не перетаскиванием: сначала выбирается
 * позиция, потом элемент. Перетаскивание в этом задании ничего не добавляет —
 * позиции фиксированы схемой, — зато требует мыши, точного попадания и не
 * работает с клавиатуры. Выбор двумя щелчками делает то же самое и доступен.
 *
 * Что где стоит правильно, интерфейс не знает до отправки ответа: эталон и
 * разбор приходят вместе с результатом. То же правило, что и в «Найди ошибку».
 */

/** Совпадает с `ASSEMBLY_PASS_SCORE` главного процесса — показывается пользователю. */
const PASS_SCORE = 0.75;

export function Assembly() {
  const route = useRouter((s) => s.route);
  const taskKey = route.name === 'assembly' ? route.taskKey : undefined;

  return taskKey ? <TaskView taskKey={taskKey} /> : <TaskList />;
}

function TaskList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [items, setItems] = useState<AssemblyTaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('assembly:tasks', profile.id)
      .then((list) => !cancelled && setItems(list))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!items) return <div className="px-8 py-8 text-dim">Загрузка заданий…</div>;

  const done = items.filter((t) => t.completed).length;

  return (
    <div className="px-8 py-8 max-w-5xl">
      <h1 className="text-[28px] font-semibold tracking-tight">Сборка узла насоса</h1>
      <p className="text-muted mt-2 max-w-3xl leading-relaxed">
        Расставьте элементы обвязки по позициям: что стоит на всасе, что на напоре и в каком
        порядке. После проверки приходит разбор по каждой позиции — почему там должен стоять
        именно этот элемент и что не так с тем, что поставили вы.
      </p>

      <div className="mt-6 max-w-md">
        <ProgressBar
          value={items.length === 0 ? 0 : done / items.length}
          label="Собрано узлов"
          hint={`${done} из ${items.length}`}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-8">
        {items.map((task) => (
          <button
            key={task.key}
            type="button"
            onClick={() => navigate({ name: 'assembly', taskKey: task.key })}
            className={cx(
              'text-left p-4 rounded-xl border transition-colors',
              task.completed
                ? 'border-accent/40 bg-accent/10 hover:border-accent'
                : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="font-medium">{task.title}</span>
              {task.completed && <Badge tone="ok">собран</Badge>}
            </span>
            <span className="block text-[12px] text-dim mt-2">
              {pluralize(task.slotCount, 'позиция', 'позиции', 'позиций')} · сложность{' '}
              {task.difficulty} ·{' '}
              {task.attempts === 0
                ? 'попыток не было'
                : `лучший результат ${fmt((task.bestScore ?? 0) * 100, 0)} %`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskView({ taskKey }: { taskKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const back = useRouter((s) => s.back);

  const [detail, setDetail] = useState<AssemblyTaskDetail | null>(null);
  const [placement, setPlacement] = useState<Record<string, string | null>>({});
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [result, setResult] = useState<AssemblyResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setDetail(null);
    setResult(null);
    setPlacement({});
    setActiveSlot(null);
    void invoke('assembly:task', profile.id, taskKey)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        // Первая позиция выбрана заранее: иначе первый щелчок по элементу
        // выглядит так, будто интерфейс не реагирует.
        setActiveSlot(data.slots[0]?.key ?? null);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id, taskKey]);

  const lines = useMemo(() => {
    if (!detail) return [];
    const of = (line: 'suction' | 'discharge') =>
      detail.slots.filter((s) => s.line === line).sort((a, b) => a.order - b.order);
    return [
      { line: 'suction' as const, title: 'Всас: от источника к насосу', slots: of('suction') },
      { line: 'discharge' as const, title: 'Напор: от насоса к системе', slots: of('discharge') },
    ];
  }, [detail]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!detail) return <div className="px-8 py-8 text-dim">Загрузка задания…</div>;

  const filled = Object.values(placement).filter(Boolean).length;
  const reviewBySlot = new Map((result?.review ?? []).map((r) => [r.slotKey, r]));

  function place(partKey: string) {
    if (!activeSlot || result) return;
    setPlacement((prev) => ({ ...prev, [activeSlot]: partKey }));

    // После установки фокус переходит к следующей пустой позиции: так узел
    // собирается подряд, а не щелчками туда-сюда.
    const order = detail!.slots.map((s) => s.key);
    const from = order.indexOf(activeSlot);
    const next =
      order.slice(from + 1).find((key) => !placement[key]) ??
      order.find((key) => key !== activeSlot && !placement[key]) ??
      null;
    setActiveSlot(next);
  }

  function clearSlot(slotKey: string) {
    if (result) return;
    setPlacement((prev) => ({ ...prev, [slotKey]: null }));
    setActiveSlot(slotKey);
  }

  async function submit() {
    if (!profile || sending) return;
    setSending(true);
    try {
      const outcome = await invoke('assembly:submit', profile.id, { taskKey, placement });
      setResult(outcome);
      await refreshProgress();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-5xl">
      <Button variant="ghost" size="sm" onClick={back}>
        ← Все задания
      </Button>

      <h1 className="text-[26px] font-semibold tracking-tight mt-3">{detail.title}</h1>
      <p className="text-muted mt-2 max-w-3xl leading-relaxed">{detail.brief}</p>

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start mt-6">
        {/* ── Схема с позициями ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {lines.map((group) => (
            <Card key={group.line} title={group.title}>
              <div className="flex flex-col gap-2">
                {group.slots.map((slot) => (
                  <SlotRow
                    key={slot.key}
                    slot={slot}
                    parts={detail.parts}
                    placed={placement[slot.key] ?? null}
                    active={activeSlot === slot.key}
                    review={reviewBySlot.get(slot.key) ?? null}
                    onSelect={() => !result && setActiveSlot(slot.key)}
                    onClear={() => clearSlot(slot.key)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>

        {/* ── Палитра элементов ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Card
            title="Элементы"
            subtitle={result ? 'Задание проверено' : 'Выберите позицию, затем элемент'}
          >
            <div className="flex flex-col gap-2">
              {detail.parts.map((part) => (
                <button
                  key={part.key}
                  type="button"
                  disabled={!!result || !activeSlot}
                  onClick={() => place(part.key)}
                  className={cx(
                    'text-left px-3 py-2 rounded-lg border transition-colors',
                    'border-border bg-surface-2 hover:border-accent disabled:opacity-50',
                    'disabled:hover:border-border disabled:cursor-default',
                  )}
                >
                  <span className="block text-[13px]">{part.label}</span>
                  <span className="block text-[11px] text-dim">{part.hint}</span>
                </button>
              ))}
            </div>
          </Card>

          {!result && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] text-dim">
                Заполнено {filled} из {detail.slots.length}. Проходной балл — {PASS_SCORE * 100} %.
              </p>
              <Button variant="primary" disabled={sending} onClick={() => void submit()}>
                {sending ? 'Проверяю…' : 'Проверить сборку'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {result && <ResultBlock result={result} onRetry={() => setResult(null)} />}
    </div>
  );
}

function SlotRow({
  slot,
  parts,
  placed,
  active,
  review,
  onSelect,
  onClear,
}: {
  slot: AssemblySlotView;
  parts: AssemblyPart[];
  placed: string | null;
  active: boolean;
  review: AssemblyResult['review'][number] | null;
  onSelect: () => void;
  onClear: () => void;
}) {
  const label = parts.find((p) => p.key === placed)?.label ?? null;
  const tone = review ? (review.isCorrect ? 'ok' : 'danger') : active ? 'active' : 'idle';

  return (
    <div
      className={cx(
        'rounded-lg border transition-colors',
        tone === 'ok' && 'border-ok/50 bg-ok-dim',
        tone === 'danger' && 'border-danger/50 bg-danger-dim',
        tone === 'active' && 'border-accent bg-accent/10',
        tone === 'idle' && 'border-border bg-surface-2',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3"
      >
        <span className="text-[11px] text-dim w-6 shrink-0 iw-num">{slot.order}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-dim">{slot.title}</span>
          <span className={cx('block text-[14px]', !label && 'text-dim italic')}>
            {label ?? 'пусто'}
          </span>
        </span>
        {!review && placed && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onClear();
              }
            }}
            className="text-[12px] text-dim hover:text-danger px-2 cursor-pointer"
            title="Убрать элемент"
          >
            ✕
          </span>
        )}
        {review && (
          <span className={cx('text-[13px]', review.isCorrect ? 'text-ok' : 'text-danger')}>
            {review.isCorrect ? '✓' : '✕'}
          </span>
        )}
      </button>

      {review && !review.isCorrect && (
        <div className="px-3 pb-3 pt-0 text-[13px] leading-relaxed">
          <p className="text-fg">
            Здесь должен стоять <span className="font-medium">{review.correctLabel}</span>.
          </p>
          <p className="text-muted mt-1">{review.why}</p>
          {review.misplacedNote && <p className="text-muted mt-1">{review.misplacedNote}</p>}
        </div>
      )}

      {review && review.isCorrect && (
        <p className="px-3 pb-3 text-[13px] text-muted leading-relaxed">{review.why}</p>
      )}
    </div>
  );
}

function ResultBlock({ result, onRetry }: { result: AssemblyResult; onRetry: () => void }) {
  return (
    <Card
      title={result.passed ? 'Узел собран' : 'Узел собран неверно'}
      subtitle={
        result.passed
          ? 'Разбор каждой позиции — выше, рядом со схемой.'
          : 'Разбор ошибок — выше, рядом со схемой: там сказано, что должно стоять и почему.'
      }
      className="mt-5"
      actions={
        <Badge tone={result.passed ? 'ok' : 'danger'}>{fmt(result.score * 100, 0)} %</Badge>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Верных позиций" value={`${result.correctCount} из ${result.total}`} />
        <Stat label="Пустых" value={String(result.emptyCount)} />
        <Stat label="Лучший результат" value={`${fmt(result.bestScore * 100, 0)} %`} />
        <Stat
          label="Начислено XP"
          value={String(result.xpAwarded)}
          hint={result.xpAwarded === 0 ? 'за задание — один раз' : undefined}
          tone={result.xpAwarded > 0 ? 'ok' : 'default'}
        />
      </div>

      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Собрать заново
        </Button>
      </div>
    </Card>
  );
}
