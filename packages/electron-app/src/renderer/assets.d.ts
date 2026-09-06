/** Типы для импорта картинок через Vite: импорт возвращает путь к ассету. */
declare module '*.png' {
  const url: string;
  export default url;
}
