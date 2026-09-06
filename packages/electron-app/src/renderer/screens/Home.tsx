import { Badge, Card, ProgressBar, Stat, cx } from '@irrigo/ui';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { NAV_ITEMS, SECTION_TITLES, SECTION_UNITS } from '../lib/sections.js';

/**
 * Обзор: прогресс по шести разделам §3.10, XP, стрик и напоминание об
 * учебном характере приложения (§10 п.1 — «на видном месте»).
 */
export function Home() {
  const profile = useSession((s) => s.activeProfile);
  const progress = useSession((s) => s.progress);
  const appInfo = useSession((s) => s.appInfo);
  const navigate = useRouter((s) => s.navigate);

  if (!profile || !progress) return null;

  const sections = progress.sections;
  const totalDone = sections.reduce((sum, s) => sum + s.done, 0);
  const totalItems = sections.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight">
          {profile.avatar} {profile.name}
        </h1>
        <p className="text-muted mt-1">
          Уровень {progress.level} · <span className="iw-num">{progress.xp}</span> XP
          {progress.streakDays > 0 && ` · стрик ${progress.streakDays} дн.`}
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Stat label="Уровень" value={progress.level} hint={`${progress.xpIntoLevel} из ${progress.xpForNextLevel} XP`} />
        <Stat label="Всего XP" value={progress.xp} />
        <Stat
          label="Стрик"
          value={progress.streakDays}
          unit="дн."
          tone={progress.streakDays > 0 ? 'ok' : 'default'}
        />
        <Stat
          label="Освоено"
          value={totalItems > 0 ? `${totalDone}/${totalItems}` : '—'}
          hint="по всем разделам"
        />
      </div>

      <Card title="Прогресс по разделам" subtitle="§3.10 ТЗ" className="mb-6">
        <div className="grid gap-5">
          {sections.map((section) => {
            const empty = section.total === 0;
            return (
              <ProgressBar
                key={section.key}
                value={empty ? 0 : section.done / section.total}
                label={SECTION_TITLES[section.key]}
                hint={
                  empty
                    ? 'контент готовится'
                    : `${section.done} из ${section.total} ${SECTION_UNITS[section.key]}`
                }
              />
            );
          })}
        </div>
      </Card>

      <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">Разделы</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
        {NAV_ITEMS.filter((item) => item.name !== 'home').map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => navigate(item.route)}
            className={cx(
              'flex gap-3 items-start p-4 text-left rounded-xl border transition-colors',
              'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
            )}
          >
            <span className="text-2xl shrink-0" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="font-medium">{item.title}</span>
                {item.pending && <Badge>в разработке</Badge>}
              </span>
              <span className="block text-[13px] text-dim mt-0.5">{item.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {/* §10 п.1 и §10 п.2: рамки применимости — на видном месте, не в подвале мелким шрифтом. */}
      <Card title="Границы применимости">
        <ul className="text-[13px] text-muted space-y-2 list-disc pl-5">
          <li>
            Приложение обучает методике и считает по опубликованным формулам, но{' '}
            <span className="text-text">не является проектной документацией</span>. Проект
            ответственного объекта подтверждает местный специалист.
          </li>
          <li>
            Любой расчёт с конкретным соплом, клапаном или насосом нужно сверять с
            актуальной техкартой производителя.
          </li>
          <li>
            Работы под напряжением 220/380 В выполняет только квалифицированный электрик;
            приложение даёт расчёт и схему, но не допуск к работам.
          </li>
          <li>
            Врезка в питьевой водопровод — только с защитой от обратного потока и
            согласованием с водоканалом; тип устройства определяют местные правила.
          </li>
        </ul>
        {appInfo && (
          <p className="text-[12px] text-dim mt-4 pt-4 border-t border-border">
            Справочник оборудования: {appInfo.catalogEdition}. Приложение работает полностью
            офлайн и не хранит ключей доступа.
          </p>
        )}
      </Card>
    </div>
  );
}
