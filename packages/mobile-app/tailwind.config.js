/**
 * Конфигурация Tailwind мобильной сборки.
 *
 * Палитра и токены общие с настольной версией — берутся из
 * `@irrigo/ui/theme.css`, второго источника правды у бренда быть не должно.
 * Отличие ровно одно: в `content` попадает и экранный код electron-app,
 * потому что Android-сборка переиспользует тот же renderer.
 */
import desktop from '../electron-app/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  ...desktop,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../electron-app/src/renderer/**/*.{ts,tsx}',
    '../ui/src/**/*.{ts,tsx}',
  ],
};
