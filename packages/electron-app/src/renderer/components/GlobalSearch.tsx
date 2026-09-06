import { useEffect, useRef, useState } from 'react';
import { cx } from '@irrigo/ui';
import type { SearchResult } from '@shared/reference.js';
import { errorText, invoke } from '../lib/bridge.js';
import { useOverlay } from '../lib/overlay.js';
import { useRouter } from '../store/router.js';

/**
 * Глобальный поиск по приложению — §3.3 ТЗ: «доступна поиском по всему
 * приложению (Ctrl+F глобально)».
 *
 * Ctrl + F перехватывается на уровне окна, потому что штатный поиск браузера
 * ищет только по видимой странице, а справочники лежат в базе и на экране их
 * почти нет.
 */

const DEBOUNCE_MS = 150;

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useRouter((s) => s.navigate);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Аппаратная «назад» на Android закрывает поиск, а не уводит с экрана.
  useOverlay(open, onClose);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResult(null);
      setError(null);
      // Фокус после отрисовки: иначе поле ещё не в документе.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (query.trim().length < 2) {
      setResult(null);
      return undefined;
    }

    // Задержка, чтобы не дёргать базу на каждую букву при быстром наборе.
    const id = window.setTimeout(() => {
      void invoke('search:global', query)
        .then(setResult)
        .catch((e) => setError(errorText(e)));
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(id);
  }, [open, query]);

  if (!open) return null;

  const openHit = (section: string, table: string) => {
    if (section === 'calculators') {
      navigate({ name: 'calculators' });
    } else {
      navigate({ name: 'reference', section, table });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm flex items-start justify-center pt-24 px-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Поиск по приложению"
        className="w-full max-w-2xl rounded-xl border border-border-strong bg-surface shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <span className="text-dim" aria-hidden>
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Сопла, трубы, почвы, термины, нормы, калькуляторы…"
            className="flex-1 h-14 bg-transparent text-[15px] text-text placeholder:text-dim focus:outline-none"
          />
          <kbd className="text-[11px] text-dim border border-border rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && <p className="px-4 py-6 text-[13px] text-danger">{error}</p>}

          {!error && query.trim().length < 2 && (
            <p className="px-4 py-6 text-[13px] text-dim">
              Введите хотя бы два символа. Поиск идёт по всем справочникам и калькуляторам,
              включая английские термины.
            </p>
          )}

          {!error && result && result.total === 0 && (
            <p className="px-4 py-6 text-[13px] text-dim">
              По запросу «{result.query}» ничего не нашлось.
            </p>
          )}

          {!error &&
            result?.groups.map((group) => (
              <section key={group.section} className="border-b border-border last:border-0">
                <p className="px-4 pt-3 pb-1 text-[12px] uppercase tracking-wider text-dim">
                  {group.icon} {group.sectionTitle}
                  {group.total > group.hits.length && (
                    <span className="ml-2 iw-num normal-case tracking-normal">
                      найдено {group.total}
                    </span>
                  )}
                </p>
                {group.hits.map((hit) => (
                  <button
                    key={`${hit.section}-${hit.table}-${hit.rowId}-${hit.title}`}
                    type="button"
                    onClick={() => openHit(hit.section, hit.table)}
                    className={cx(
                      'w-full text-left px-4 py-2 transition-colors',
                      'hover:bg-surface-2',
                    )}
                  >
                    <span className="block text-[14px] truncate">{hit.title}</span>
                    {hit.subtitle && (
                      <span className="block text-[12px] text-dim truncate">{hit.subtitle}</span>
                    )}
                  </button>
                ))}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Ctrl + F открывает поиск в любом разделе. */
export function useGlobalSearchHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
