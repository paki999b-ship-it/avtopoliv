import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Select, cx } from '@irrigo/ui';
import { fmt } from '@irrigo/core';
import type {
  ReferenceColumn,
  ReferenceResult,
  ReferenceSectionInfo,
} from '@shared/reference.js';
import { EMITTER_CLASS_TITLES, PUMP_TYPE_TITLES } from '@shared/reference.js';
import { errorText, invoke } from '../lib/bridge.js';
import { pluralize } from '../lib/format.js';
import { useRouter } from '../store/router.js';
import { StripNozzleCards } from '../components/StripNozzleCards.js';
import { PumpModelCard } from '../components/PumpModelCard.js';

/**
 * Раздел «Справочники» (§3.3 ТЗ).
 *
 * Девять разделов рисует один компонент: состав колонок, фильтры и сортировку
 * присылает главный процесс вместе со строками. Поэтому новый справочник
 * появляется здесь без правки вёрстки, а фильтр и сортировка ведут себя
 * одинаково везде.
 */

const PAGE_SIZE = 100;

export function Reference() {
  const route = useRouter((s) => s.route);
  const navigate = useRouter((s) => s.navigate);

  const [sections, setSections] = useState<ReferenceSectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke('reference:sections')
      .then((list) => {
        if (!cancelled) setSections(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeKey = route.name === 'reference' ? route.section : undefined;
  const initialQuery = route.name === 'reference' ? (route.query ?? '') : '';
  const initialTable = route.name === 'reference' ? route.table : undefined;
  const active = sections?.find((s) => s.key === activeKey) ?? null;

  if (error) {
    return (
      <div className="px-8 py-8">
        <EmptyState title="Справочники не открылись" description={error} />
      </div>
    );
  }

  if (!sections) {
    return <div className="px-8 py-8 text-dim">Загрузка справочников…</div>;
  }

  if (!active) {
    return (
      <SectionList
        sections={sections}
        onOpen={(key) => navigate({ name: 'reference', section: key })}
      />
    );
  }

  return (
    <SectionView
      key={`${active.key}-${initialTable ?? ''}-${initialQuery}`}
      section={active}
      initialQuery={initialQuery}
      initialTable={initialTable}
      onBack={() => navigate({ name: 'reference' })}
    />
  );
}

function SectionList({
  sections,
  onOpen,
}: {
  sections: ReferenceSectionInfo[];
  onOpen: (key: string) => void;
}) {
  const total = sections.reduce((sum, s) => sum + s.rows, 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Справочники</h1>
        <p className="text-muted mt-1">
          Офлайн-база на <span className="iw-num">{total}</span> строк. Поиск по всему приложению —
          Ctrl + F.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => onOpen(section.key)}
            className={cx(
              'flex gap-3 items-start p-4 text-left rounded-xl border transition-colors',
              'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
            )}
          >
            <span className="text-2xl shrink-0" aria-hidden>
              {section.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{section.title}</span>
                <span className="iw-num text-[12px] text-dim shrink-0">{section.rows}</span>
              </span>
              <span className="block text-[13px] text-muted mt-1">{section.description}</span>
            </span>
          </button>
        ))}
      </div>

      <Card title="О данных" className="mt-8">
        <ul className="text-[13px] text-muted space-y-2 list-disc pl-5">
          <li>
            У каждой числовой строки есть источник: страница каталога, пункт стандарта или
            формула расчётного движка. Значения «по памяти» в базу не попадают.
          </li>
          <li>
            Строки, не прошедшие сверку, показаны с пометкой, а не спрятаны: знать о спорном
            значении полезнее, чем не видеть его вовсе.
          </li>
          <li>
            Тексты нормативов не воспроизводятся — только перечень, назначение и ссылка на
            официальный источник.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function SectionView({
  section,
  initialQuery,
  initialTable,
  onBack,
}: {
  section: ReferenceSectionInfo;
  initialQuery: string;
  initialTable: string | undefined;
  onBack: () => void;
}) {
  // Переход из урока по термину открывает раздел уже с подставленным запросом.
  const [tableKey, setTableKey] = useState(
    initialTable ?? section.tables[0]?.key ?? 'rows',
  );
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | undefined>();
  const [offset, setOffset] = useState(0);
  /** Открытая карточка модели насоса — у остальных разделов её нет. */
  const [selectedPump, setSelectedPump] = useState<number | null>(null);
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const table = section.tables.find((t) => t.key === tableKey) ?? section.tables[0];

  // Смена таблицы внутри раздела сбрасывает фильтры: они у каждой свои.
  useEffect(() => {
    setFilters({});
    setSort(undefined);
    setOffset(0);
  }, [tableKey]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void invoke('reference:query', {
      section: section.key,
      table: tableKey,
      query,
      filters,
      sort,
      limit: PAGE_SIZE,
      offset,
    })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [section.key, tableKey, query, filters, sort, offset]);

  const shown = result?.rows.length ?? 0;
  const total = result?.total ?? 0;

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-6">
      <button
        type="button"
        onClick={onBack}
        className="text-[13px] text-dim hover:text-text transition-colors mb-1"
      >
        ← Все справочники
      </button>

      <header className="flex items-start justify-between gap-6 mb-5">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {section.icon} {section.title}
          </h1>
          <p className="text-muted mt-1 max-w-3xl">{section.description}</p>
        </div>
        <Badge tone="accent" className="shrink-0 mt-2">
          {pluralize(section.rows, 'строка', 'строки', 'строк')}
        </Badge>
      </header>

      {section.tables.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {section.tables.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTableKey(t.key)}
              className={cx(
                'px-3 py-1.5 rounded-lg border text-[13px] transition-colors',
                t.key === tableKey
                  ? 'border-accent bg-accent/10 text-text'
                  : 'border-border bg-surface-2 text-muted hover:text-text hover:border-border-strong',
              )}
            >
              {t.title}
              <span className="iw-num text-dim ml-2">{t.rows}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex-1 min-w-64">
          <span className="block text-[13px] text-muted mb-1.5">Поиск по разделу</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
            placeholder="Например: PGP, суглинок, обратный поток"
            className="w-full h-10 px-3 bg-surface-2 border border-border rounded-lg text-text placeholder:text-dim focus:border-accent focus:outline-none"
          />
        </label>

        {(table?.filters ?? []).map((filter) => (
          <label key={filter.key} className="min-w-48">
            <span className="block text-[13px] text-muted mb-1.5">{filter.label}</span>
            <Select
              value={filters[filter.key] ?? ''}
              onChange={(e) => {
                setFilters({ ...filters, [filter.key]: e.target.value });
                setOffset(0);
              }}
            >
              <option value="">все</option>
              {filter.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>

      {(result?.note ?? section.note) && (
        <p className="text-[12px] text-dim mb-4 px-4 py-3 rounded-lg border border-border bg-surface-2">
          {result?.note ?? section.note}
        </p>
      )}

      {error && (
        <p className="text-[13px] text-danger mb-4">{error}</p>
      )}

      {/* У полосовых форсунок форма полива — часть данных, а не оформление:
          без схемы «где стоит форсунка» таблица размеров не читается. */}
      {section.key === 'nozzles' && tableKey === 'strip' && <StripNozzleCards />}

      {/* Кривая насоса не помещается в строку таблицы: строка отвечает на
          «какой напор в крайних точках», карточка — на «как идёт кривая». */}
      {section.key === 'pumps' && selectedPump !== null && (
        <PumpModelCard pumpId={selectedPump} onClose={() => setSelectedPump(null)} />
      )}

      {section.key === 'pumps' && selectedPump === null && (
        <p className="text-[12px] text-dim mb-4">
          Нажмите на строку, чтобы открыть кривую Q–H этой модели.
        </p>
      )}

      {result && result.rows.length === 0 && (
        <EmptyState
          title="Ничего не нашлось"
          description={
            query
              ? `По запросу «${query}» в этом справочнике совпадений нет. Попробуйте глобальный поиск: Ctrl + F.`
              : 'Таблица пуста.'
          }
        />
      )}

      {result && result.rows.length > 0 && (
        <>
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="text-left border-b border-border bg-surface-2/60">
                    {result.columns.map((column) => {
                      const active = result.sort.column === column.key;
                      return (
                        <th
                          key={column.key}
                          className={cx(
                            'py-2.5 px-4 font-medium whitespace-nowrap',
                            column.numeric && 'text-right',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSort({
                                column: column.key,
                                dir: active && result.sort.dir === 'asc' ? 'desc' : 'asc',
                              })
                            }
                            className={cx(
                              'transition-colors',
                              active ? 'text-accent-ink' : 'text-dim hover:text-text',
                            )}
                          >
                            {column.label}
                            {active && (result.sort.dir === 'asc' ? ' ↑' : ' ↓')}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr
                      key={String(row['id'] ?? index)}
                      onClick={
                        section.key === 'pumps'
                          ? () => setSelectedPump(Number(row['id']))
                          : undefined
                      }
                      className={cx(
                        'border-b border-border/50 last:border-0 hover:bg-surface-2/40',
                        section.key === 'pumps' && 'cursor-pointer',
                        section.key === 'pumps' &&
                          selectedPump === Number(row['id']) &&
                          'bg-accent/10',
                      )}
                    >
                      {result.columns.map((column) => (
                        <td
                          key={column.key}
                          className={cx(
                            'py-2.5 px-4 align-top',
                            column.numeric && 'text-right iw-num whitespace-nowrap',
                            column.wide ? 'min-w-72 text-muted' : 'whitespace-nowrap',
                          )}
                        >
                          <Cell column={column} value={row[column.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 mt-4">
            <p className="text-[13px] text-dim">
              Показано <span className="iw-num">{offset + 1}–{offset + shown}</span> из{' '}
              <span className="iw-num">{total}</span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Назад
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={offset + shown >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Дальше →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const GLOSSARY_GROUPS: Record<string, string> = {
  agronomy: 'Вода и растения',
  hydraulics: 'Гидравлика',
  design: 'Проектирование',
  equipment: 'Оборудование',
  electrical: 'Электрика',
  automation: 'Автоматика',
  installation: 'Монтаж',
  operation: 'Эксплуатация',
  safety: 'Безопасность',
};

function Cell({ column, value }: { column: ReferenceColumn; value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-dim">—</span>;
  }

  switch (column.kind) {
    case 'verified':
      return Number(value) === 1 ? (
        <span className="text-ok" title="Строка прошла сверку">
          ✓
        </span>
      ) : (
        <Badge tone="warn">требует сверки</Badge>
      );

    case 'status':
      return String(value) === 'verified' ? (
        <span className="text-ok" title="Значение сверено с источником">
          ✓
        </span>
      ) : (
        <Badge tone="warn">уточнить</Badge>
      );

    case 'local_check':
      return Number(value) === 1 ? <Badge tone="warn">по месту</Badge> : <span className="text-dim">—</span>;

    case 'valve_body':
      return <span>{String(value) === 'angle' ? 'угловой' : 'сферический'}</span>;

    case 'glossary_group':
      return <span className="text-muted">{GLOSSARY_GROUPS[String(value)] ?? String(value)}</span>;

    case 'emitter_class':
      return <span>{EMITTER_CLASS_TITLES[String(value)] ?? String(value)}</span>;

    case 'recommended':
      return Number(value) === 1 ? (
        <Badge tone="ok">рекомендовано</Badge>
      ) : (
        <span className="text-dim">—</span>
      );

    case 'pump_type':
      return <span>{PUMP_TYPE_TITLES[String(value)] ?? String(value)}</span>;

    case 'digitized':
      return Number(value) === 1 ? (
        <Badge tone="warn">снято с графика</Badge>
      ) : (
        <span className="text-dim" title="Точки взяты из напечатанной таблицы">
          таблица
        </span>
      );

    case 'calculator_link':
      return <Badge tone="accent">§ {String(value)}</Badge>;

    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          className="text-accent-ink hover:underline"
        >
          источник ↗
        </a>
      );

    default:
      break;
  }

  if (column.numeric && typeof value === 'number') {
    return <span>{fmt(value, column.digits ?? 2)}</span>;
  }

  return <span>{String(value)}</span>;
}
