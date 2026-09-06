import { Clipboard } from '@capacitor/clipboard';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ExportResult } from '@shared/types.js';

/**
 * Выгрузка расчётов и планов на Android.
 *
 * На Windows файл сохраняет системный диалог «Сохранить как». В Android такого
 * диалога у WebView нет, а писать во внешние папки (Documents, Downloads) до
 * 10-й версии система пускает только по разрешению — просить его ради экспорта
 * CSV несоразмерно. Поэтому файл кладётся в приватный кэш приложения и
 * отдаётся в системное меню «Поделиться»: оттуда пользователь сам решает, куда
 * его деть — в облако, в мессенджер или в «Файлы».
 */

/** Android не любит в имени файла разделители пути и служебные символы. */
function safeName(name: string, extension: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  const base = cleaned || 'irrigo';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

async function shareFile(path: string, title: string): Promise<ExportResult> {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title, url: uri, dialogTitle: title });
  } catch {
    // Закрытое меню «Поделиться» — отказ от отправки, а не сбой: файл уже
    // записан, и путь к нему возвращается в любом случае.
  }
  return { saved: true, path: uri };
}

export async function exportCsv(suggestedName: string, csv: string): Promise<ExportResult> {
  const path = safeName(suggestedName, 'csv');
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    // BOM — иначе Excel на русской локали покажет кириллицу как «РїСЂ».
    data: `﻿${csv}`,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return shareFile(path, 'Сохранить расчёт в CSV');
}

export async function exportPng(suggestedName: string, base64: string): Promise<ExportResult> {
  const path = safeName(suggestedName, 'png');
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    // Изображение приходит как data-URL; без `encoding` плагин ждёт base64,
    // поэтому заголовок нужно отрезать.
    data: base64.slice(base64.indexOf(',') + 1),
    recursive: true,
  });
  return shareFile(path, 'Сохранить план участка');
}

export async function writeClipboard(text: string): Promise<{ copied: boolean }> {
  try {
    await Clipboard.write({ string: text });
    return { copied: true };
  } catch {
    // Отказ буфера обмена не должен выглядеть как успешное копирование:
    // экран покажет, что скопировать не удалось.
    return { copied: false };
  }
}
