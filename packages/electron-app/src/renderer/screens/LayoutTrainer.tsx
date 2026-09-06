import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Field, NoteList, ProgressBar, Select, Stat, cx } from '@irrigo/ui';
import { compareWithReference, evaluateLayout, fmt } from '@irrigo/core';
import type { EmitterClass, LayoutHead, LayoutPoint } from '@irrigo/core';
import type { LayoutReference, LayoutTaskDetail, LayoutTaskSummary } from '@shared/layout.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';
import { LayoutCanvas } from '../components/LayoutCanvas.js';
import { themeColor, themeVariablesInlineStyle } from '../lib/theme.js';

/**
 * Тренажёр раскладки (§3.4 ТЗ).
 *
 * Расчёт при редактировании идёт в renderer тем же движком, что и на зачёте
 * в главном процессе, — иначе пользователь видел бы одну оценку, а в прогресс
 * попадала другая. Разница только в шаге сетки: при редактировании он крупнее,
 * чтобы пересчёт успевал за перетаскиванием головы.
 */

/** Шаг сетки при редактировании. Мельче — заметно медленнее на перетаскивании. */
const EDIT_CELL_SIZE_M = 0.4;

interface LibraryItem {
  key: string;
  model: string;
  emitterClass: EmitterClass;
  radiusM: number;
  /** Расход на полный круг, л/ч. */
  fullCircleFlowLph: number;
}

/**
 * Библиотека голов. Расходы даны на полный круг и пересчитываются на сектор
 * пропорционально — это и есть согласованная интенсивность (§5.6).
 */
const LIBRARY: LibraryItem[] = [
  { key: 'spray-3', model: 'Спрей 3 м', emitterClass: 'spray', radiusM: 3.2, fullCircleFlowLph: 260 },
  { key: 'spray-4', model: 'Спрей 4 м', emitterClass: 'spray', radiusM: 4.2, fullCircleFlowLph: 420 },
  { key: 'rn-4', model: 'Роторное сопло 4 м', emitterClass: 'rotary_nozzle', radiusM: 4, fullCircleFlowLph: 260 },
  { key: 'rn-5', model: 'Роторное сопло 5 м', emitterClass: 'rotary_nozzle', radiusM: 5, fullCircleFlowLph: 320 },
  { key: 'rn-6', model: 'Роторное сопло 6 м', emitterClass: 'rotary_nozzle', radiusM: 6, fullCircleFlowLph: 380 },
  { key: 'rotor-6', model: 'Ротор 6 м', emitterClass: 'rotor', radiusM: 6, fullCircleFlowLph: 520 },
  { key: 'rotor-8', model: 'Ротор 8 м', emitterClass: 'rotor', radiusM: 8, fullCircleFlowLph: 700 },
  { key: 'rotor-10', model: 'Ротор 10 м', emitterClass: 'rotor', radiusM: 10, fullCircleFlowLph: 880 },
];

const SECTORS = [90, 180, 270, 360];

const matchedFlow = (item: LibraryItem, sweepDeg: number): number =>
  Math.round((item.fullCircleFlowLph * sweepDeg) / 360);

export function LayoutTrainer() {
  const route = useRouter((s) => s.route);
  const taskKey = route.name === 'layout' ? route.taskKey : undefined;

  return taskKey ? <TaskView taskKey={taskKey} /> : <TaskList />;
}

function TaskList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [tasks, setTasks] = useState<LayoutTaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('layout:tasks', profile.id)
      .then((list) => !cancelled && setTasks(list))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!tasks) return <div className="px-8 py-8 text-dim">Загрузка заданий…</div>;

  const done = tasks.filter((t) => t.completed).length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Тренажёр раскладки</h1>
        <p className="text-muted mt-1">
          Расставьте дождеватели на плане участка. Покрытие, расход и замечания считаются
          сразу, по мере расстановки.
        </p>
      </header>

      {tasks.length > 0 && (
        <ProgressBar
          className="mb-7"
          value={done / tasks.length}
          label="Выполнено заданий"
          hint={`${done} из ${tasks.length}`}
        />
      )}

      <div className="flex flex-col gap-3">
        {tasks.map((task) => (
          <button
            key={task.key}
            type="button"
            onClick={() => navigate({ name: 'layout', taskKey: task.key })}
            className={cx(
              'flex items-start gap-4 p-4 text-left rounded-xl border transition-colors',
              'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
            )}
          >
            <span
              className={cx(
                'w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[13px] mt-0.5',
                task.completed
                  ? 'bg-ok-dim text-ok border border-ok/40'
                  : 'bg-surface-3 text-dim border border-border',
              )}
            >
              {task.completed ? '✓' : task.difficulty}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{task.title}</span>
                {task.bestScore !== null && (
                  <span className="iw-num text-[12px] text-dim shrink-0">
                    лучший результат {fmt(task.bestScore * 100, 0)} %
                  </span>
                )}
              </span>
              <span className="block text-[13px] text-muted mt-1">{task.brief}</span>
              <span className="block text-[12px] text-dim mt-2">
                {fmt(task.areaM2, 0)} м² · сложность {task.difficulty} ·{' '}
                {task.attempts === 0
                  ? 'попыток не было'
                  : pluralize(task.attempts, 'попытка', 'попытки', 'попыток')}
              </span>
            </span>
          </button>
        ))}
      </div>

      <Card title="Как это работает" className="mt-8">
        <ul className="text-[13px] text-muted space-y-2 list-disc pl-5">
          <li>
            Клик по плану ставит голову, перетаскивание двигает её, выбранную голову можно
            настроить или удалить.
          </li>
          <li>
            Непокрытые места закрашиваются красным сразу — это площадь, до которой вода не
            долетает ни при каком времени полива.
          </li>
          <li>
            Эталонное решение открывается после первой попытки: смысл задания в том, чтобы
            сначала решить самому.
          </li>
          <li>
            Эталоны проверены расчётным движком, а не проставлены вручную — результат
            проверки виден в разборе задания.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function TaskView({ taskKey }: { taskKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const navigate = useRouter((s) => s.navigate);

  const [task, setTask] = useState<LayoutTaskDetail | null>(null);
  const [heads, setHeads] = useState<LayoutHead[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryKey, setLibraryKey] = useState(LIBRARY[3]!.key);
  const [sector, setSector] = useState(180);
  const [reference, setReference] = useState<LayoutReference | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setTask(null);
    setReference(null);
    setStatus(null);

    void invoke('layout:task', profile.id, taskKey)
      .then((detail) => {
        if (cancelled) return;
        setTask(detail);
        const restored = detail.lastAttempt ?? [];
        setHeads(restored);
        nextId.current = restored.length + 1;
      })
      .catch((e) => !cancelled && setError(errorText(e)));

    return () => {
      cancelled = true;
    };
  }, [profile?.id, taskKey]);

  const evaluation = useMemo(() => {
    if (!task) return null;
    return evaluateLayout(task.plan, heads, { cellSizeM: EDIT_CELL_SIZE_M });
  }, [task, heads]);

  const comparison = useMemo(() => {
    if (!task || !reference) return null;
    return compareWithReference(task.plan, heads, reference.heads, {
      cellSizeM: EDIT_CELL_SIZE_M,
    });
  }, [task, reference, heads]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!task || !evaluation) return <div className="px-8 py-8 text-dim">Загрузка задания…</div>;

  const item = LIBRARY.find((l) => l.key === libraryKey)!;
  const selected = heads.find((h) => h.id === selectedId) ?? null;

  const placeHead = (point: LayoutPoint) => {
    const id = `u${nextId.current}`;
    nextId.current += 1;

    setHeads([
      ...heads,
      {
        id,
        position: point,
        radiusM: item.radiusM,
        // Новая голова смотрит вправо; сектор доворачивается стрелками.
        startDeg: 0,
        sweepDeg: sector,
        emitterClass: item.emitterClass,
        flowLph: matchedFlow(item, sector),
        model: item.model,
      },
    ]);
    setSelectedId(id);
  };

  const updateSelected = (patch: Partial<LayoutHead>) => {
    if (!selected) return;
    setHeads(heads.map((h) => (h.id === selected.id ? { ...h, ...patch } : h)));
  };

  async function submit() {
    try {
      const result = await invoke('layout:submit', profile!.id, { taskKey, heads });
      setStatus(
        result.passed
          ? `Задание засчитано: ${fmt(result.score * 100, 0)} %. Лучший результат — ${fmt(result.bestScore * 100, 0)} %.`
          : `Результат ${fmt(result.score * 100, 0)} %. Для зачёта нужно 75 %.`,
      );
      void refreshProgress();
      setTask({ ...task!, ...{ bestScore: result.bestScore, attempts: result.attempts, completed: result.completed } });
    } catch (e) {
      setStatus(errorText(e));
    }
  }

  async function showReference() {
    try {
      setReference(await invoke('layout:reference', profile!.id, taskKey));
    } catch (e) {
      setStatus(errorText(e));
    }
  }

  async function exportPng() {
    const svg = svgRef.current;
    if (!svg) return;

    try {
      // SVG сериализуется в data-URL и рисуется на холсте: вторая версия
      // отрисовки для экспорта не нужна.
      //
      // Цвета плана заданы токенами темы, а сериализованная картинка
      // рисуется как отдельный документ — переменные страницы в ней не
      // действуют. Поэтому значения текущей темы переносятся в корень копии:
      // без этого экспортированный план вышел бы бесцветным.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('style', themeVariablesInlineStyle());
      const source = new XMLSerializer().serializeToString(clone);
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Не удалось отрисовать план'));
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = Math.round((1600 * svg.clientHeight) / Math.max(1, svg.clientWidth));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Холст недоступен');

      context.fillStyle = themeColor('bg');
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const outcome = await invoke(
        'layout:exportPng',
        `plan-${taskKey}`,
        canvas.toDataURL('image/png'),
      );
      setStatus(outcome.saved ? `План сохранён: ${outcome.path}` : 'Сохранение отменено.');
    } catch (e) {
      setStatus(errorText(e));
    }
  }

  async function exportCsv() {
    const rows = [
      ['№', 'Модель', 'Класс', 'X, м', 'Y, м', 'Радиус, м', 'Сектор, °', 'Расход, л/ч'],
      ...heads.map((h, i) => [
        String(i + 1),
        h.model ?? h.id,
        h.emitterClass,
        fmt(h.position.x, 2),
        fmt(h.position.y, 2),
        fmt(h.radiusM, 1),
        fmt(h.sweepDeg, 0),
        fmt(h.flowLph, 0),
      ]),
      [],
      ['Итого голов', String(heads.length)],
      ['Расход зоны, м³/ч', fmt(evaluation!.summary.zoneFlowM3h, 2)],
      ['Покрытие, %', fmt(evaluation!.coverage.coverageRatio * 100, 1)],
    ];

    const csv = rows
      .map((row) => row.map((cell) => (/[";\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(';'))
      .join('\r\n');

    try {
      const outcome = await invoke('calc:exportCsv', `oborudovanie-${taskKey}`, csv);
      setStatus(outcome.saved ? `Список сохранён: ${outcome.path}` : 'Сохранение отменено.');
    } catch (e) {
      setStatus(errorText(e));
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] px-8 py-6">
      <button
        type="button"
        onClick={() => navigate({ name: 'layout' })}
        className="text-[13px] text-dim hover:text-text transition-colors mb-1"
      >
        ← Все задания
      </button>

      <header className="flex items-start justify-between gap-6 mb-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-tight">{task.title}</h1>
          <p className="text-muted mt-1 max-w-3xl">{task.brief}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-2">
          {task.completed && <Badge tone="ok">выполнено</Badge>}
          <Badge tone="accent">
            дебит {fmt(task.plan.sourceFlowM3h, 1)} м³/ч
          </Badge>
        </div>
      </header>

      <div className="grid xl:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <LayoutCanvas
              plan={task.plan}
              heads={heads}
              coverage={evaluation.coverage}
              selectedId={selectedId}
              svgRef={svgRef}
              onSelect={setSelectedId}
              onPlace={placeHead}
              onMove={(id, point) =>
                setHeads(heads.map((h) => (h.id === id ? { ...h, position: point } : h)))
              }
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat
              label="Покрытие"
              value={fmt(evaluation.coverage.coverageRatio * 100, 1)}
              unit="%"
              tone={evaluation.coverage.coverageRatio >= 0.95 ? 'ok' : 'danger'}
            />
            <Stat
              label="Не полито"
              value={fmt(evaluation.coverage.uncoveredAreaM2, 1)}
              unit="м²"
              tone={evaluation.coverage.uncoveredAreaM2 > 1 ? 'warn' : 'ok'}
            />
            <Stat
              label="Расход зоны"
              value={fmt(evaluation.summary.zoneFlowM3h, 2)}
              unit="м³/ч"
              tone={evaluation.summary.sourceUtilisation > 0.8 ? 'danger' : 'ok'}
              hint={`${fmt(evaluation.summary.sourceUtilisation * 100, 0)} % дебита`}
            />
            <Stat
              label="Интенсивность"
              value={fmt(evaluation.summary.precipitationRateMmH, 1)}
              unit="мм/ч"
            />
          </div>

          {evaluation.notes.length > 0 && (
            <NoteList
              notes={evaluation.notes.map((n) => ({
                severity: n.severity,
                message: n.message,
                why: n.why,
                fix: n.fix,
              }))}
            />
          )}

          {reference && (
            <Card
              title="Эталонное решение"
              subtitle={comparison ? verdictText(comparison.verdict) : undefined}
            >
              <div className="rounded-lg border border-border overflow-hidden mb-4">
                <LayoutCanvas
                  plan={task.plan}
                  heads={reference.heads}
                  coverage={null}
                  selectedId={null}
                  readOnly
                />
              </div>

              {comparison && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Stat
                    label="Ваше покрытие"
                    value={fmt(comparison.userCoverage * 100, 1)}
                    unit="%"
                  />
                  <Stat
                    label="У эталона"
                    value={fmt(comparison.referenceCoverage * 100, 1)}
                    unit="%"
                  />
                  <Stat label="Ваших голов" value={comparison.userHeads} unit="шт" />
                  <Stat label="У эталона" value={comparison.referenceHeads} unit="шт" />
                </div>
              )}

              {comparison && comparison.extraIssues.length > 0 && (
                <>
                  <p className="text-[13px] text-muted mb-2">
                    Замечания, которых у эталона нет:
                  </p>
                  <NoteList
                    className="mb-4"
                    notes={comparison.extraIssues.map((n) => ({
                      severity: n.severity,
                      message: n.message,
                      why: n.why,
                      fix: n.fix,
                    }))}
                  />
                </>
              )}

              <p className="text-[14px] text-muted">{reference.lesson}</p>
              <p className="text-[12px] text-dim mt-3 pt-3 border-t border-border">
                {reference.qaNotes}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Библиотека голов">
            <div className="grid gap-4">
              <Field label="Модель" hint="Расход пересчитывается на сектор автоматически">
                <Select value={libraryKey} onChange={(e) => setLibraryKey(e.target.value)}>
                  {LIBRARY.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.model} — {l.fullCircleFlowLph} л/ч на 360°
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Сектор новой головы" unit="°">
                <div className="flex gap-2">
                  {SECTORS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSector(value)}
                      className={cx(
                        'flex-1 h-10 rounded-lg border text-[13px] transition-colors',
                        sector === value
                          ? 'border-accent bg-accent/10 text-text'
                          : 'border-border bg-surface-2 text-muted hover:text-text',
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </Field>

              <p className="text-[12px] text-dim">
                Клик по плану ставит голову, перетаскивание двигает её.
              </p>
            </div>
          </Card>

          {selected && (
            <Card
              title="Выбранная голова"
              actions={
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setHeads(heads.filter((h) => h.id !== selected.id));
                    setSelectedId(null);
                  }}
                >
                  Удалить
                </Button>
              }
            >
              <div className="grid gap-4">
                <Field label="Сектор" unit="°">
                  <div className="flex gap-2">
                    {SECTORS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          const source = LIBRARY.find((l) => l.model === selected.model) ?? item;
                          updateSelected({ sweepDeg: value, flowLph: matchedFlow(source, value) });
                        }}
                        className={cx(
                          'flex-1 h-10 rounded-lg border text-[13px] transition-colors',
                          selected.sweepDeg === value
                            ? 'border-accent bg-accent/10 text-text'
                            : 'border-border bg-surface-2 text-muted hover:text-text',
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Поворот сектора" unit="°" hint="Куда смотрит начало дуги">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        updateSelected({ startDeg: (selected.startDeg + 315) % 360 })
                      }
                    >
                      ⟲ 45°
                    </Button>
                    <span className="iw-num flex-1 text-center">{fmt(selected.startDeg, 0)}°</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => updateSelected({ startDeg: (selected.startDeg + 45) % 360 })}
                    >
                      45° ⟳
                    </Button>
                  </div>
                </Field>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  <dt className="text-dim">Модель</dt>
                  <dd>{selected.model}</dd>
                  <dt className="text-dim">Радиус</dt>
                  <dd className="iw-num">{fmt(selected.radiusM, 1)} м</dd>
                  <dt className="text-dim">Расход</dt>
                  <dd className="iw-num">{fmt(selected.flowLph, 0)} л/ч</dd>
                </dl>
              </div>
            </Card>
          )}

          <Card title="Раскладка" subtitle={`${pluralize(heads.length, 'голова', 'головы', 'голов')}`}>
            <div className="flex flex-col gap-2">
              <Button variant="primary" disabled={heads.length === 0} onClick={() => void submit()}>
                Проверить и засчитать
              </Button>
              <Button variant="secondary" onClick={() => void showReference()}>
                Сравнить с эталоном
              </Button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => void exportPng()}
                >
                  План в PNG
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={heads.length === 0}
                  onClick={() => void exportCsv()}
                >
                  Список в CSV
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setHeads([]);
                  setSelectedId(null);
                }}
              >
                Очистить план
              </Button>
            </div>

            {status && <p className="text-[13px] text-muted mt-3">{status}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function verdictText(verdict: 'better' | 'comparable' | 'worse'): string {
  if (verdict === 'better') return 'Ваша раскладка вышла лучше эталонной';
  if (verdict === 'worse') return 'Эталон получился лучше — посмотрите, чем именно';
  return 'Результат сопоставим с эталоном';
}
