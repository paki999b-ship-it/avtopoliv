import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc.js';
import type { IpcChannel } from '../shared/ipc.js';

/**
 * Мост между renderer и main.
 *
 * В окно попадает ровно один метод `invoke`, и только по белому списку каналов
 * из контракта. Ни `require`, ни путей к файлам, ни объекта `ipcRenderer`
 * renderer не видит.
 */

const allowed = new Set<string>(IPC_CHANNELS);

contextBridge.exposeInMainWorld('irrigo', {
  invoke(channel: IpcChannel, ...args: unknown[]) {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Канал «${channel}» не разрешён.`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
