import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Конфигурация Capacitor.
 *
 * appId продублирован строкой, а не взят из настроек electron-builder: этот
 * файл читает CLI Capacitor собственным загрузчиком TypeScript, без алиасов
 * воркспейса. При смене идентификатора поправить и здесь, и в
 * `packages/electron-app/package.json` (поле `build.appId`).
 */
const config: CapacitorConfig = {
  appId: 'ru.artlandshaft.app',
  appName: 'АртЛандшафт',
  webDir: 'dist',

  // Цвет окна выставляется до загрузки бандла, иначе на старте моргает белый
  // экран. Значение — токен --iw-bg тёмной темы (packages/ui/src/theme/theme.css).
  backgroundColor: '#081910',

  android: {
    backgroundColor: '#081910',
    // Приложение офлайн и в сеть не ходит (§13 ТЗ): разрешать открытый HTTP
    // незачем.
    allowMixedContent: false,
  },

  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#081910',
    },
  },
};

export default config;
