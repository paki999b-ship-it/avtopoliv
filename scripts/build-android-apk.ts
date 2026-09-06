/**
 * Сборка APK: веб-бандл → нативный проект → gradle → release/.
 *
 * Запуск:  node scripts/build-android-apk.ts [debug|release]
 * Выход:   release/ArtLandshaft-<версия>-android-<тип>.apk
 *
 * ── Зачем обёртка, а не просто gradlew ─────────────────────────────────────
 * Gradle разборчив к версии Java: 8.14 не запускается на JDK новее 24-го, а на
 * машине сборки стоит JDK 25 из Android Studio, и голый `gradlew assembleDebug`
 * падает с невнятным «Unsupported class file major version 69». Скрипт сам
 * находит подходящий JDK и подставляет его в JAVA_HOME, поэтому сборка не
 * зависит от того, что именно прописано в окружении.
 *
 * Релизная сборка подписывается ключом из android/keystore.properties или из
 * переменных окружения ANDROID_KEYSTORE_*; без ключа APK остаётся
 * неподписанным и на устройство не встанет — об этом скрипт предупреждает.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const mobileApp = path.join(projectRoot, 'packages/mobile-app');
const androidDir = path.join(mobileApp, 'android');

const variant = (process.argv[2] ?? 'debug').toLowerCase();
if (variant !== 'debug' && variant !== 'release') {
  throw new Error(`Тип сборки может быть debug или release, а не «${variant}».`);
}

/** Gradle 8.14 работает на JDK 17…24. Двадцать пятый он ещё не понимает. */
const JDK_MIN = 17;
const JDK_MAX = 24;

// ── Поиск JDK ──────────────────────────────────────────────────────────────

/** Версия JDK по каталогу, либо null, если это не рабочий JDK. */
function jdkVersion(home: string): number | null {
  const java = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(java)) return null;

  // java печатает и свойства, и версию в stderr, поэтому нужен spawnSync:
  // execFileSync возвращает только stdout, и разбирать было бы нечего.
  const result = spawnSync(java, ['-XshowSettings:properties', '-version'], {
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}
${result.stderr ?? ''}`;
  const match = /java\.specification\.version\s*=\s*(\d+)/.exec(output);
  return match ? Number(match[1]) : null;
}

function candidateHomes(): string[] {
  const homes: string[] = [];
  const push = (dir: string) => {
    if (dir && existsSync(dir)) homes.push(dir);
  };

  if (process.env['JAVA_HOME']) push(process.env['JAVA_HOME']);

  // Каталог, куда JDK кладут IntelliJ и Android Studio, а также этот проект.
  const userHome = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  for (const parent of [path.join(userHome, '.jdks'), 'C:/Program Files/Java']) {
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) push(path.join(parent, name));
  }

  push('C:/Program Files/Android/Android Studio/jbr');
  return homes;
}

function findJdk(): string {
  const rejected: string[] = [];
  for (const home of candidateHomes()) {
    const version = jdkVersion(home);
    if (version === null) continue;
    if (version >= JDK_MIN && version <= JDK_MAX) return home;
    rejected.push(`${home} (Java ${version})`);
  }

  throw new Error(
    `Не найден JDK версии ${JDK_MIN}–${JDK_MAX}, нужный Gradle.\n` +
      (rejected.length ? `Проверены и не подошли:\n  ${rejected.join('\n  ')}\n` : '') +
      'Поставьте, например, Temurin 21 и положите его в ~/.jdks или укажите в JAVA_HOME.',
  );
}

// ── Сборка ─────────────────────────────────────────────────────────────────

/**
 * Запуск внешней команды.
 *
 * `shell: true` на Windows обязателен: с Node 20 пакетные файлы (.cmd, .bat —
 * а npm и gradlew именно такие) без оболочки не запускаются вовсе, и spawnSync
 * отвечает невнятным EINVAL. Пути при этом берутся в кавычки — в них есть
 * пробелы.
 */
function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  const shell = process.platform === 'win32';
  const quote = (value: string) => (shell && /[\s&()]/.test(value) ? `"${value}"` : value);
  execFileSync(shell ? quote(command) : command, shell ? args.map(quote) : args, {
    cwd,
    shell,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

if (!existsSync(androidDir)) {
  throw new Error(
    `Нативный проект не создан: ${androidDir}\n` +
      'Выполните: npm run android:add',
  );
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('[1/4] Сборка веб-бандла…');
run(npm, ['run', 'build'], mobileApp);

console.log('[2/4] Иконки и заставка из логотипа…');
run(process.execPath, [path.join(here, 'build-android-icons.ts')], projectRoot);

console.log('[3/4] Перенос бандла в нативный проект…');
run(npm, ['run', 'sync'], mobileApp);

const javaHome = findJdk();
console.log(`[4/4] Gradle assemble${variant[0]!.toUpperCase()}${variant.slice(1)} (JDK: ${javaHome})…`);
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
run(
  path.join(androidDir, gradlew),
  [`assemble${variant[0]!.toUpperCase()}${variant.slice(1)}`],
  androidDir,
  { JAVA_HOME: javaHome },
);

// ── Публикация ─────────────────────────────────────────────────────────────

const built = path.join(androidDir, 'app/build/outputs/apk', variant, `app-${variant}.apk`);
const unsigned = built.replace(/\.apk$/, '-unsigned.apk');
const source = existsSync(built) ? built : unsigned;

if (!existsSync(source)) {
  throw new Error(`Gradle отработал, но APK не найден: ${built}`);
}

const version = (
  JSON.parse(readFileSync(path.join(mobileApp, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const releaseDir = path.join(projectRoot, 'release');
mkdirSync(releaseDir, { recursive: true });
const target = path.join(releaseDir, `ArtLandshaft-${version}-android-${variant}.apk`);
copyFileSync(source, target);

console.log(`\nГотово: ${path.relative(projectRoot, target)}`);
if (source === unsigned) {
  console.log(
    'ВНИМАНИЕ: APK не подписан и на устройство не установится. Ключ задаётся\n' +
      'в packages/mobile-app/android/keystore.properties либо переменными\n' +
      'ANDROID_KEYSTORE_PATH / _PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD.',
  );
}
