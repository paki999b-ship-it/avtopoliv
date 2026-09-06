import { useState } from 'react';
import { Badge, Button, Field, Select, TextInput, cx } from '@irrigo/ui';
import type { ProfileDraft, SkillLevel, UnitSystem } from '@shared/types.js';
import { levelFromXp } from '@shared/xp.js';
import { useSession } from '../store/session.js';
import { AVATARS, SKILL_LEVELS, UNIT_SYSTEMS } from '../lib/sections.js';
import { Logo } from '../components/Logo.js';

/**
 * Экран выбора профиля — первое, что видит пользователь (§3.10, §12 п.1).
 * Профили независимы: у каждого свой прогресс, свой уровень подачи и своя
 * система единиц.
 */
export function ProfileSelect() {
  const profiles = useSession((s) => s.profiles);
  const loading = useSession((s) => s.loading);
  const selectProfile = useSession((s) => s.selectProfile);
  const [creating, setCreating] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-14">
        <header className="text-center mb-10">
          <Logo className="h-28 mx-auto mb-4" />
          <p className="text-muted mt-2">
            Проектирование, монтаж и эксплуатация систем автоматического полива
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <Badge tone="accent">Работает офлайн</Badge>
            <Badge>Учебная программа, не проектная документация</Badge>
          </div>
        </header>

        {creating || profiles.length === 0 ? (
          <CreateProfileCard
            canCancel={profiles.length > 0}
            onDone={() => setCreating(false)}
          />
        ) : (
          <>
            <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">
              Выберите профиль
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {profiles.map((profile) => {
                const { level } = levelFromXp(profile.xp);
                const skill = SKILL_LEVELS.find((s) => s.value === profile.skillLevel);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    disabled={loading}
                    onClick={() => void selectProfile(profile.id)}
                    className={cx(
                      'flex items-center gap-4 p-4 text-left rounded-xl border',
                      'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
                      'transition-colors disabled:opacity-50',
                    )}
                  >
                    <span className="text-3xl shrink-0" aria-hidden>
                      {profile.avatar}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{profile.name}</span>
                      <span className="block text-[13px] text-dim truncate">
                        {skill?.title ?? profile.skillLevel} · уровень {level} ·{' '}
                        <span className="iw-num">{profile.xp}</span> XP
                      </span>
                    </span>
                    {profile.streakDays > 0 && (
                      <Badge tone="info">💧 {profile.streakDays}</Badge>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <Button variant="ghost" onClick={() => setCreating(true)} icon={<span>＋</span>}>
                Новый профиль
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CreateProfileCard({
  canCancel,
  onDone,
}: {
  canCancel: boolean;
  onDone: () => void;
}) {
  const createProfile = useSession((s) => s.createProfile);
  const selectProfile = useSession((s) => s.selectProfile);
  const loading = useSession((s) => s.loading);

  const [draft, setDraft] = useState<ProfileDraft>({
    name: '',
    avatar: AVATARS[0] ?? '💧',
    skillLevel: 'owner',
    unitSystem: 'metric',
  });
  const [touched, setTouched] = useState(false);

  const nameError = touched && !draft.name.trim() ? 'Введите имя профиля' : undefined;

  async function submit() {
    setTouched(true);
    if (!draft.name.trim()) return;
    try {
      const profile = await createProfile(draft);
      onDone();
      await selectProfile(profile.id);
    } catch {
      // Текст ошибки уже лежит в session.error и показан в шапке.
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-[17px] font-semibold mb-1">Новый профиль</h2>
      <p className="text-[13px] text-muted mb-6">
        Уровень подачи и систему единиц можно поменять в любой момент — они влияют на
        то, как излагается материал, а не на то, что доступно.
      </p>

      <div className="grid gap-5">
        <Field label="Имя" error={nameError}>
          <TextInput
            value={draft.name}
            maxLength={40}
            autoFocus
            placeholder="Например: Алексей"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>

        <div>
          <p className="text-[13px] text-muted mb-2">Аватар</p>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((avatar) => (
              <button
                key={avatar}
                type="button"
                aria-pressed={draft.avatar === avatar}
                onClick={() => setDraft({ ...draft, avatar })}
                className={cx(
                  'w-11 h-11 rounded-lg border text-xl transition-colors',
                  draft.avatar === avatar
                    ? 'border-accent bg-accent/15'
                    : 'border-border bg-surface-2 hover:border-border-strong',
                )}
              >
                {avatar}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[13px] text-muted mb-2">Уровень подачи материала</p>
          <div className="grid gap-2">
            {SKILL_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                aria-pressed={draft.skillLevel === level.value}
                onClick={() => setDraft({ ...draft, skillLevel: level.value as SkillLevel })}
                className={cx(
                  'flex gap-3 items-start p-3 rounded-lg border text-left transition-colors',
                  draft.skillLevel === level.value
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface-2 hover:border-border-strong',
                )}
              >
                <span className="text-xl" aria-hidden>
                  {level.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-[14px]">{level.title}</span>
                  <span className="block text-[13px] text-dim">{level.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <Field label="Система единиц" hint="Метрическая по умолчанию (§1 ТЗ)">
          <Select
            value={draft.unitSystem}
            onChange={(e) =>
              setDraft({ ...draft, unitSystem: e.target.value as UnitSystem })
            }
          >
            {UNIT_SYSTEMS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.title} — {u.description}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3 mt-7">
        <Button variant="primary" disabled={loading} onClick={() => void submit()}>
          Создать и войти
        </Button>
        {canCancel && (
          <Button variant="ghost" onClick={onDone}>
            Отмена
          </Button>
        )}
      </div>
    </div>
  );
}
