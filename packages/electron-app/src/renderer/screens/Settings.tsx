import { useState } from 'react';
import { Badge, Button, Card, Field, Select, TextInput, cx } from '@irrigo/ui';
import type { SkillLevel, UnitSystem } from '@shared/types.js';
import { THEMES } from '@shared/types.js';
import { useSession } from '../store/session.js';
import { AVATARS, SKILL_LEVELS, UNIT_SYSTEMS } from '../lib/sections.js';
import { Logo } from '../components/Logo.js';

/**
 * Экран настроек: сначала то, что относится к профилю (уровень подачи и
 * система единиц — §1 ТЗ), затем общие настройки приложения.
 *
 * Тема и «О приложении» стоят рядом в общем разделе: ни то, ни другое не
 * является свойством учебного профиля. Тема при этом всё-таки сохраняется в
 * профиле — за одним компьютером работают несколько человек, — но выбирается
 * там, где пользователь ищет настройки приложения, а не свои учебные.
 */
export function Settings() {
  const profile = useSession((s) => s.activeProfile);
  const appInfo = useSession((s) => s.appInfo);
  const update = useSession((s) => s.updateActiveProfile);
  const deleteProfile = useSession((s) => s.deleteProfile);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Имя правится локально и сохраняется по уходу с поля: писать в базу на
  // каждое нажатие клавиши незачем.
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!profile) return null;

  const commitName = () => {
    if (nameDraft !== null && nameDraft.trim() && nameDraft !== profile.name) {
      void update({ name: nameDraft });
    }
    setNameDraft(null);
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-[24px] font-semibold tracking-tight mb-6">Настройки профиля</h1>

      <Card title="Профиль" className="mb-5">
        <div className="grid gap-5">
          <Field label="Имя">
            <TextInput
              value={nameDraft ?? profile.name}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
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
                  aria-pressed={profile.avatar === avatar}
                  onClick={() => void update({ avatar })}
                  className={cx(
                    'w-11 h-11 rounded-lg border text-xl transition-colors',
                    profile.avatar === avatar
                      ? 'border-accent bg-accent/15'
                      : 'border-border bg-surface-2 hover:border-border-strong',
                  )}
                >
                  {avatar}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Уровень подачи материала"
        subtitle="Меняет язык изложения, а не состав разделов"
        className="mb-5"
      >
        <div className="grid gap-2">
          {SKILL_LEVELS.map((level) => (
            <button
              key={level.value}
              type="button"
              aria-pressed={profile.skillLevel === level.value}
              onClick={() => void update({ skillLevel: level.value as SkillLevel })}
              className={cx(
                'flex gap-3 items-start p-3 rounded-lg border text-left transition-colors',
                profile.skillLevel === level.value
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
      </Card>

      <Card title="Система единиц" className="mb-5">
        <Field
          label="Единицы измерения"
          hint="Применяется во всех калькуляторах и справочниках (§13 ТЗ)"
        >
          <Select
            value={profile.unitSystem}
            onChange={(e) => void update({ unitSystem: e.target.value as UnitSystem })}
          >
            {UNIT_SYSTEMS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.title} — {u.description}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {/* Общие настройки приложения: они не про конкретный профиль, поэтому
          вынесены в отдельный раздел под настройками профиля. Тема и «О
          приложении» стоят в одном ряду — это два пункта одного уровня. */}
      <h2 className="text-[20px] font-semibold tracking-tight mt-8 mb-4">
        Настройки приложения
      </h2>

      <div className="grid md:grid-cols-2 gap-5 mb-5 items-start">
        <Card title="Тема приложения" subtitle="Сохраняется в профиле">
          <div className="grid gap-2">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                aria-pressed={profile.theme === theme.value}
                onClick={() => void update({ theme: theme.value })}
                className={cx(
                  'flex gap-3 items-center p-3 rounded-lg border text-left transition-colors',
                  profile.theme === theme.value
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface-2 hover:border-border-strong',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'w-7 h-7 rounded-md border shrink-0',
                    theme.value === 'dark'
                      ? 'bg-[#0E1613] border-[#2A3B33]'
                      : 'bg-white border-[#DCE6E0]',
                  )}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-[14px]">{theme.title}</span>
                  <span className="block text-[13px] text-dim">{theme.description}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="О приложении">
          <Logo className="h-20 mx-auto mb-4" />

          <p className="text-[13px] text-muted leading-relaxed">
            Программа не предназначена для коммерческого использования и предназначена для
            использования внутри экосистемы фирмы АртЛандшафт.
          </p>
          <p className="text-[13px] text-muted leading-relaxed mt-2">
            Создатель OPTIK Design (Sergey Kasikhin)
          </p>

          {appInfo && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[12px] mt-4 pt-4 border-t border-border">
              <dt className="text-dim">Версия</dt>
              <dd className="iw-num">{appInfo.appVersion}</dd>
              <dt className="text-dim">Среда</dt>
              <dd className="iw-num">{appInfo.runtime}</dd>
              <dt className="text-dim">Каталог оборудования</dt>
              <dd>{appInfo.catalogEdition}</dd>
              <dt className="text-dim">База данных</dt>
              <dd className="iw-num break-all">{appInfo.databasePath}</dd>
              <dt className="text-dim">Сеть</dt>
              <dd>
                <Badge tone="ok">не используется</Badge>
              </dd>
            </dl>
          )}
        </Card>
      </div>

      <Card title="Удаление профиля">
        <p className="text-[13px] text-muted mb-4">
          Вместе с профилем удаляется весь его прогресс: пройденные уроки, история
          расчётов, попытки тренажёров и результаты экзамена. Отменить нельзя.
        </p>
        {confirmDelete ? (
          <div className="flex items-center gap-3">
            <Button variant="danger" onClick={() => void deleteProfile(profile.id)}>
              Да, удалить «{profile.name}»
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Удалить профиль
          </Button>
        )}
      </Card>
    </div>
  );
}
