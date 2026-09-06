import type { ThemeName } from '@shared/types.js';

/**
 * Применение темы и доступ к её цветам из JavaScript.
 *
 * Тема живёт одним атрибутом `data-theme` на корневом элементе: под него в
 * `@irrigo/ui/theme.css` описаны оба набора токенов. Второго механизма нет —
 * компоненты не знают, какая тема активна, они просто используют токены.
 */

/** Все токены-цвета темы. Список нужен для выгрузки картинок (см. ниже). */
const COLOR_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-dim',
  'accent',
  'accent-hover',
  'accent-strong',
  'accent-ink',
  'accent-dim',
  'on-accent',
  'ok',
  'ok-dim',
  'warn',
  'warn-dim',
  'danger',
  'danger-dim',
  'info',
  'info-dim',
] as const;

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset['theme'] = theme;
}

/** Значение токена как готовый цвет: `rgb(8 25 16)`. */
export function themeColor(token: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--iw-${token}`)
    .trim();
  return raw ? `rgb(${raw})` : 'rgb(0 0 0)';
}

/**
 * Строка объявлений всех цветовых токенов текущей темы.
 *
 * Нужна при выгрузке SVG в PNG: сериализованная картинка рисуется как
 * отдельный документ, и переменные страницы в ней не действуют — `var()`
 * внутри превратился бы в «цвет не задан», и план вышел бы чёрным. Поэтому
 * значения переносятся в сам корень SVG.
 */
export function themeVariablesInlineStyle(): string {
  const style = getComputedStyle(document.documentElement);
  return COLOR_TOKENS.map((token) => {
    const value = style.getPropertyValue(`--iw-${token}`).trim();
    return value ? `--iw-${token}:${value}` : '';
  })
    .filter(Boolean)
    .join(';');
}
