import { useMemo, useState } from 'react';
import { Badge, Card, cx } from '@irrigo/ui';
import type { CalculatorKey, CalculatorMeta } from '@irrigo/core';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { GROUP_TITLES, calculatorEntries } from '../calculators/index.js';
import { CalcRunner } from '../components/CalcRunner.js';

/**
 * Раздел «Калькуляторы» (§3.2 ТЗ).
 *
 * Состав берётся из реестра движка, поэтому список здесь не может разойтись
 * с тем, что реально умеет считать `@irrigo/core`.
 */
export function Calculators() {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const route = useRouter((s) => s.route);
  const navigate = useRouter((s) => s.navigate);

  const entries = useMemo(() => calculatorEntries(), []);
  const selectedKey =
    route.name === 'calculators' && route.calculatorKey
      ? (route.calculatorKey as CalculatorKey)
      : null;

  const selected = entries.find((e) => e.meta.key === selectedKey) ?? null;

  if (!profile) return null;

  if (!selected) {
    return <CalculatorList entries={entries} onOpen={(key) => navigate({ name: 'calculators', calculatorKey: key })} />;
  }

  return (
    <div className="px-8 py-6">
      <div className="flex items-start justify-between gap-6 mb-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate({ name: 'calculators' })}
            className="text-[13px] text-dim hover:text-text transition-colors mb-1"
          >
            ← Все калькуляторы
          </button>
          <h1 className="text-[24px] font-semibold tracking-tight">{selected.meta.title}</h1>
          <p className="text-muted mt-1 max-w-3xl">{selected.meta.summary}</p>
        </div>
        <Badge tone="accent" className="shrink-0 mt-6">
          §{selected.meta.spec}
        </Badge>
      </div>

      <p className="iw-num text-[13px] text-dim mb-6 px-3 py-2 rounded-lg bg-surface-2 border border-border inline-block">
        {selected.meta.formula}
      </p>

      <CalcRunner
        meta={selected.meta}
        definition={selected.definition}
        profile={profile}
        onOpenLesson={(lessonKey) => navigate({ name: 'lesson', lessonKey })}
        onSaved={() => void refreshProgress()}
      />
    </div>
  );
}

function CalculatorList({
  entries,
  onOpen,
}: {
  entries: Array<{ meta: CalculatorMeta }>;
  onOpen: (key: CalculatorKey) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = entries.filter((entry) => {
    if (!query.trim()) return true;
    const haystack = `${entry.meta.title} ${entry.meta.summary} ${entry.meta.formula} ${entry.meta.spec}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  const groups = new Map<CalculatorMeta['group'], CalculatorMeta[]>();
  for (const entry of filtered) {
    const list = groups.get(entry.meta.group) ?? [];
    list.push(entry.meta);
    groups.set(entry.meta.group, list);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Калькуляторы</h1>
        <p className="text-muted mt-1">
          Шестнадцать расчётов раздела §5. Каждый показывает формулу, подстановку чисел и
          результат — не только ответ.
        </p>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по названию, формуле или номеру раздела"
        className="w-full h-11 px-4 mb-7 bg-surface-2 border border-border rounded-lg text-text placeholder:text-dim focus:border-accent focus:outline-none"
      />

      {filtered.length === 0 && (
        <p className="text-muted">По запросу «{query}» ничего не нашлось.</p>
      )}

      <div className="flex flex-col gap-7">
        {[...groups.entries()].map(([group, metas]) => (
          <section key={group}>
            <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">
              {GROUP_TITLES[group]}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {metas.map((meta) => (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => onOpen(meta.key)}
                  className={cx(
                    'text-left p-4 rounded-xl border transition-colors',
                    'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{meta.title}</span>
                    <span className="text-[12px] text-dim shrink-0">§{meta.spec}</span>
                  </span>
                  <span className="block text-[13px] text-muted mt-1">{meta.summary}</span>
                  <span className="block iw-num text-[12px] text-dim mt-2 truncate">
                    {meta.formula}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card title="Границы применимости" className="mt-8">
        <ul className="text-[13px] text-muted space-y-2 list-disc pl-5">
          <li>
            Расчёты учебные. Проект ответственного объекта подтверждает местный специалист.
          </li>
          <li>
            Значения по конкретному соплу, клапану или насосу сверяйте с актуальной техкартой
            производителя: приложение считает по формулам, а не по вашему оборудованию.
          </li>
          <li>
            Локальных метеоданных (ET0, осадки) и местных норм в приложении нет — они вводятся
            вами и помечаются как уточняемые по месту.
          </li>
        </ul>
      </Card>
    </div>
  );
}
