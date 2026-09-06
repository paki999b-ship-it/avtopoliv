/**
 * Tailwind 3 (не 4): четвёртая версия тянет нативные биндинги lightningcss,
 * а они на целевой машине блокируются политикой Application Control
 * (DECISIONS.md, решения 1 и 2).
 *
 * Цвета не задаются здесь литералами — они ссылаются на переменные темы из
 * `@irrigo/ui/theme.css`, чтобы у палитры был один источник правды.
 */
const varColor = (name) => `rgb(var(--iw-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,tsx}',
    '../ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: varColor('bg'),
        surface: {
          DEFAULT: varColor('surface'),
          2: varColor('surface-2'),
          3: varColor('surface-3'),
        },
        border: {
          DEFAULT: varColor('border'),
          strong: varColor('border-strong'),
        },
        text: varColor('text'),
        'on-accent': varColor('on-accent'),
        muted: varColor('text-muted'),
        dim: varColor('text-dim'),
        accent: {
          DEFAULT: varColor('accent'),
          // Наведение на акцентную кнопку. Отдельный токен, потому что в
          // тёмной теме hover светлее акцента, а в светлой — темнее, и
          // подменить его «сильным» акцентом нельзя.
          hover: varColor('accent-hover'),
          strong: varColor('accent-strong'),
          // Акцентный текст: на белом фоне светлый акцент нечитаем.
          ink: varColor('accent-ink'),
          dim: varColor('accent-dim'),
        },
        ok: { DEFAULT: varColor('ok'), dim: varColor('ok-dim') },
        warn: { DEFAULT: varColor('warn'), dim: varColor('warn-dim') },
        danger: { DEFAULT: varColor('danger'), dim: varColor('danger-dim') },
        info: { DEFAULT: varColor('info'), dim: varColor('info-dim') },
      },
      fontFamily: {
        sans: ['var(--iw-font)'],
        mono: ['var(--iw-font-mono)'],
      },
    },
  },
  plugins: [],
};
