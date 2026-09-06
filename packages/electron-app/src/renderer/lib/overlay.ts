import { useEffect } from 'react';

/**
 * Стек открытых наложений: поиск, боковое меню, модальные окна.
 *
 * Нужен ровно одному потребителю — аппаратной кнопке «назад» на Android
 * (`packages/mobile-app/src/platform/shell.ts`). Она должна сначала закрыть то,
 * что открыто сверху, и только потом уводить на предыдущий экран; без общего
 * списка каждое наложение пришлось бы учитывать в оболочке поимённо.
 *
 * На Windows стек просто не читают: кнопки «назад» у окна нет, а Esc каждое
 * наложение обрабатывает само.
 */

type Dismiss = () => void;

const stack: { id: symbol; dismiss: Dismiss }[] = [];

/**
 * Закрывает верхнее наложение. Возвращает false, если закрывать нечего —
 * тогда вызывающий делает шаг назад по разделам.
 */
export function dismissTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.dismiss();
  return true;
}

/**
 * Регистрирует наложение, пока оно открыто.
 *
 * `onClose` попадает в стек по ссылке на момент открытия, поэтому обработчик
 * должен быть стабильным (или хотя бы не зависеть от состояния, которое
 * меняется при открытом наложении).
 */
export function useOverlay(open: boolean, onClose: Dismiss): void {
  useEffect(() => {
    if (!open) return;

    const entry = { id: Symbol('overlay'), dismiss: onClose };
    stack.push(entry);

    return () => {
      const index = stack.findIndex((item) => item.id === entry.id);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [open, onClose]);
}
