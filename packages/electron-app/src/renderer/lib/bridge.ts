import type { IpcArgs, IpcChannel, IpcResult, IrrigoBridge } from '@shared/ipc.js';

declare global {
  interface Window {
    irrigo?: IrrigoBridge;
  }
}

/**
 * Типизированный доступ к main-процессу.
 *
 * Отсутствие моста — это не «нет данных», а сломанный preload: молча
 * подставлять пустые списки нельзя, иначе профили будут выглядеть удалёнными.
 */
export function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  const bridge = window.irrigo;
  if (!bridge) {
    return Promise.reject(
      new Error('Мост preload недоступен: приложение запущено не через Electron.'),
    );
  }
  return bridge.invoke(channel, ...args);
}

/** Текст ошибки для показа пользователю: IPC приносит их строкой из main. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    // Electron префиксует сообщения из main служебной строкой — убираем её.
    return error.message.replace(/^Error invoking remote method '[^']+':\s*/, '');
  }
  return String(error);
}
