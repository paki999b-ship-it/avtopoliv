import { useEffect, useState } from 'react';
import { Badge, Button, Card, ProgressBar, cx } from '@irrigo/ui';
import type {
  CauseLikelihood,
  DiagnosticsConclusion,
  DiagnosticsNode,
  DiagnosticsSymptomDetail,
  DiagnosticsSymptomSummary,
} from '@shared/diagnostics.js';
import { LIKELIHOOD_TITLES } from '@shared/diagnostics.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';

/**
 * Диагностика (§3.6 ТЗ).
 *
 * Пройденные вопросы остаются на экране вместе с выбранными ответами: разбор
 * неисправности — это цепочка рассуждений, и потерять её при переходе к
 * следующему вопросу значит потерять половину пользы. Любой шаг можно
 * переиграть, вернувшись к нему.
 */

export function Diagnostics() {
  const route = useRouter((s) => s.route);
  const symptomKey = route.name === 'diagnostics' ? route.symptomKey : undefined;

  return symptomKey ? <SymptomView symptomKey={symptomKey} /> : <SymptomList />;
}

function SymptomList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [items, setItems] = useState<DiagnosticsSymptomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('diagnostics:symptoms', profile.id)
      .then((list) => !cancelled && setItems(list))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!items) return <div className="px-8 py-8 text-dim">Загрузка симптомов…</div>;

  const done = items.filter((s) => s.visited).length;

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Диагностика</h1>
        <p className="text-muted mt-1">
          Выберите симптом. Программа задаст уточняющие вопросы и приведёт к списку вероятных
          причин: что замерить, чтобы отличить одну от другой, и что делать по результату.
        </p>
      </header>

      <ProgressBar
        className="mb-6"
        value={done / items.length}
        label="Разобрано симптомов"
        hint={`${done} из ${items.length}`}
      />

      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate({ name: 'diagnostics', symptomKey: item.key })}
            className={cx(
              'flex items-start gap-4 p-4 text-left rounded-xl border transition-colors',
              'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
            )}
          >
            <span
              className={cx(
                'w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[13px] mt-0.5',
                item.visited
                  ? 'bg-ok-dim text-ok border border-ok/40'
                  : 'bg-surface-3 text-dim border border-border',
              )}
              aria-hidden
            >
              {item.visited ? '✓' : '🩺'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium block">{item.title}</span>
              <span className="block text-[13px] text-muted mt-1">{item.hint}</span>
              <span className="block text-[12px] text-dim mt-2">
                {pluralize(item.outcomes, 'исход', 'исхода', 'исходов')} разбора
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Выбранный на каждом шаге ответ: индекс в списке ответов узла. */
type Path = number[];

function SymptomView({ symptomKey }: { symptomKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const back = useRouter((s) => s.back);

  const [detail, setDetail] = useState<DiagnosticsSymptomDetail | null>(null);
  const [path, setPath] = useState<Path>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setDetail(null);
    setPath([]);
    void invoke('diagnostics:symptom', profile.id, symptomKey)
      .then((data) => !cancelled && setDetail(data))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id, symptomKey]);

  // Цепочка пройденных узлов: сам симптом, вопросы с выбранными ответами и,
  // если ветка дошла до конца, исход.
  const chain: DiagnosticsNode[] = [];
  if (detail) {
    let node: DiagnosticsNode = detail.root;
    chain.push(node);
    for (const index of path) {
      if (node.kind !== 'question') break;
      const answer = node.answers[index];
      if (!answer) break;
      node = answer.next;
      chain.push(node);
    }
  }

  const last = chain[chain.length - 1];
  const conclusion = last?.kind === 'conclusion' ? last : null;

  // Дошли до исхода — отмечаем симптом разобранным (§3.10).
  useEffect(() => {
    if (!profile || !conclusion) return;
    void invoke('diagnostics:resolved', profile.id, symptomKey)
      .then(() => refreshProgress())
      .catch((e) => setError(errorText(e)));
  }, [profile?.id, symptomKey, conclusion?.key]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!detail) return <div className="px-8 py-8 text-dim">Загрузка разбора…</div>;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <button
        type="button"
        onClick={back}
        className="text-[13px] text-dim hover:text-fg transition-colors mb-4"
      >
        ← Все симптомы
      </button>

      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight">{detail.title}</h1>
        <p className="text-muted mt-1">{detail.hint}</p>
      </header>

      <div className="flex flex-col gap-4">
        {chain.map((node, step) =>
          node.kind === 'question' ? (
            <Card key={node.key} title={`Шаг ${step + 1}`}>
              <p className="text-[15px] mb-3">{node.question}</p>
              <div className="flex flex-col gap-2">
                {node.answers.map((answer, index) => {
                  const chosen = path[step] === index;
                  const answered = path.length > step;

                  return (
                    <button
                      key={answer.next.key}
                      type="button"
                      onClick={() => setPath([...path.slice(0, step), index])}
                      className={cx(
                        'px-3 py-2.5 text-left rounded-lg border text-[14px] transition-colors',
                        chosen
                          ? 'bg-accent/15 border-accent/50 text-accent-ink'
                          : answered
                            ? 'bg-surface border-border text-dim hover:border-border-strong'
                            : 'bg-surface border-border hover:border-accent/50',
                      )}
                    >
                      {answer.label}
                    </button>
                  );
                })}
              </div>
            </Card>
          ) : (
            <ConclusionCard key={node.key} node={node} />
          ),
        )}
      </div>

      {conclusion && (
        <div className="flex items-center gap-3 mt-6">
          <Button variant="ghost" onClick={() => setPath([])}>
            Пройти заново
          </Button>
          <Button variant="ghost" onClick={back}>
            К списку симптомов
          </Button>
        </div>
      )}

      <p className="text-[12px] text-dim mt-8 leading-relaxed">
        Разбор носит учебный характер и не заменяет осмотр системы на месте. Работы под
        напряжением выполняет квалифицированный электрик.
      </p>
    </div>
  );
}

const LIKELIHOOD_TONE: Record<CauseLikelihood, 'danger' | 'warn' | 'neutral'> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

function ConclusionCard({ node }: { node: DiagnosticsConclusion }) {
  const navigate = useRouter((s) => s.navigate);

  return (
    <Card title="Вероятные причины" subtitle={node.conclusion}>
      <ol className="flex flex-col gap-3">
        {node.causes.map((cause, index) => (
          <li key={cause.title} className="flex gap-3">
            <span className="iw-num text-[13px] text-dim w-5 shrink-0 mt-0.5">{index + 1}.</span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-[14px]">{cause.title}</span>
                <Badge tone={LIKELIHOOD_TONE[cause.likelihood]}>
                  {LIKELIHOOD_TITLES[cause.likelihood]}
                </Badge>
              </span>
              <span className="block text-[13px] text-muted mt-1">{cause.note}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-col gap-3">
        <div className="rounded-lg border border-info/35 bg-info-dim px-4 py-3">
          <p className="text-[12px] uppercase tracking-wide text-info mb-1">Что замерить</p>
          <p className="text-[14px] leading-relaxed">{node.measure}</p>
        </div>
        <div className="rounded-lg border border-ok/35 bg-ok-dim px-4 py-3">
          <p className="text-[12px] uppercase tracking-wide text-ok mb-1">Что сделать</p>
          <p className="text-[14px] leading-relaxed">{node.action}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {node.lessonKey && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ name: 'lesson', lessonKey: node.lessonKey })}
          >
            Урок: {node.lessonTitle}
          </Button>
        )}
        {node.calculatorKey && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({ name: 'calculators', calculatorKey: node.calculatorKey })
            }
          >
            Посчитать: {node.calculatorTitle}
          </Button>
        )}
      </div>
    </Card>
  );
}
