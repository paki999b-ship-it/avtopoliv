import { Directory, Filesystem } from '@capacitor/filesystem';

/**
 * Хранение файла базы на устройстве.
 *
 * sql.js держит базу в памяти WebView, поэтому её образ нужно записывать в
 * файл самому — иначе прогресс исчезнет вместе с процессом приложения
 * (§3.10 ТЗ: прогресс профиля сохраняется между запусками).
 *
 * `Directory.Data` — приватный каталог приложения: он не виден другим
 * программам, не требует разрешений и очищается только вместе с приложением.
 */

const DB_FILE = 'irrigo-master.db';

/** Base64 частями: на одном `String.fromCharCode(...bytes)` переполняется стек. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Образ базы с устройства; `null` — приложение запускается впервые. */
export async function readDatabaseFile(): Promise<Uint8Array | null> {
  try {
    const { data } = await Filesystem.readFile({ path: DB_FILE, directory: Directory.Data });
    // На устройстве плагин отдаёт base64-строку, в браузере (npm run dev) — Blob.
    if (typeof data === 'string') return base64ToBytes(data);
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    // Отсутствие файла — штатный первый запуск, а не сбой.
    return null;
  }
}

export async function writeDatabaseFile(bytes: Uint8Array): Promise<void> {
  await Filesystem.writeFile({
    path: DB_FILE,
    directory: Directory.Data,
    data: bytesToBase64(bytes),
    recursive: true,
  });
}

/** Полный путь к файлу базы — показывается в разделе «О приложении». */
export async function databaseUri(): Promise<string> {
  try {
    const { uri } = await Filesystem.getUri({ path: DB_FILE, directory: Directory.Data });
    return uri;
  } catch {
    return `память приложения · ${DB_FILE}`;
  }
}
