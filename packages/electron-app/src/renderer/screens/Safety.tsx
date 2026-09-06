import { useEffect, useState } from 'react';
import { Badge, Button, ProgressBar, cx } from '@irrigo/ui';
import type { SafetyTopicDetail, SafetyTopicSummary } from '@shared/safety.js';
import { SAFETY_CATEGORY_ICONS, SAFETY_CATEGORY_TITLES } from '@shared/safety.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { errorText, invoke } from '../lib/bridge.js';
import { LessonBlocks } from '../components/LessonBlocks.js';

/**
 * Раздел «Безопасность и границы» (§3.8 ТЗ).
 *
 * Тексты собраны из тех же блоков, что и уроки, поэтому здесь работают и
 * врезки, и переключение подачи по уровню профиля, и переходы на калькуляторы.
 *
 * Пометка об учебном характере стоит на самом видном месте раздела, а не в
 * подвале: §10 п.1 требует, чтобы граница ответственности была очевидна до
 * чтения, а не после.
 */

export function Safety() {
  const route = useRouter((s) => s.route);
  const topicKey = route.name === 'safety' ? route.topicKey : undefined;

  return topicKey ? <TopicView topicKey={topicKey} /> : <TopicList />;
}

function TopicList() {
  const profile = useSession((s) => s.activeProfile);
  const navigate = useRouter((s) => s.navigate);
  const [topics, setTopics] = useState<SafetyTopicSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void invoke('safety:topics', profile.id)
      .then((list) => !cancelled && setTopics(list))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!topics) return <div className="px-8 py-8 text-dim">Загрузка раздела…</div>;

  const read = topics.filter((t) => t.read).length;

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Безопасность и границы</h1>
        <p className="text-muted mt-1">
          Восемь тем, в которых ошибка стоит дороже переделки: электрика, питьевая вода,
          скважина, земляные работы, химия, давление, продувка и первая помощь.
        </p>
      </header>

      <div className="rounded-xl border border-danger/40 bg-danger-dim px-5 py-4 mb-6">
        <p className="text-[13px] leading-relaxed">
          <strong>Приложение обучает методике и не является проектной документацией.</strong>{' '}
          Работы под напряжением выполняет квалифицированный электрик; присоединение к
          питьевому водопроводу и тип защиты от обратного потока определяются местными
          правилами и согласованием с водоснабжающей организацией. Материалы раздела не
          заменяют инструктаж по охране труда.
        </p>
      </div>

      <ProgressBar
        className="mb-6"
        value={read / topics.length}
        label="Прочитано тем"
        hint={`${read} из ${topics.length}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {topics.map((topic) => (
          <button
            key={topic.key}
            type="button"
            onClick={() => navigate({ name: 'safety', topicKey: topic.key })}
            className={cx(
              'flex flex-col gap-2 p-4 text-left rounded-xl border transition-colors h-full',
              'bg-surface border-border hover:border-accent/60 hover:bg-surface-2',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-[18px]" aria-hidden>
                {SAFETY_CATEGORY_ICONS[topic.category]}
              </span>
              <span className="font-medium flex-1">{topic.title}</span>
              {topic.read && <Badge tone="ok">прочитано</Badge>}
            </span>
            <span className="text-[13px] text-muted">{topic.summary}</span>
            <span className="text-[12px] text-dim mt-auto pt-1">
              {SAFETY_CATEGORY_TITLES[topic.category]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TopicView({ topicKey }: { topicKey: string }) {
  const profile = useSession((s) => s.activeProfile);
  const refreshProgress = useSession((s) => s.refreshProgress);
  const navigate = useRouter((s) => s.navigate);
  const back = useRouter((s) => s.back);

  const [topic, setTopic] = useState<SafetyTopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setTopic(null);
    void invoke('safety:topic', profile.id, topicKey)
      .then((data) => {
        if (cancelled) return;
        setTopic(data);
        // Тема считается прочитанной по открытию: теста здесь нет, и требовать
        // отдельного нажатия ради галочки незачем.
        return invoke('safety:read', profile.id, topicKey).then(() => refreshProgress());
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [profile?.id, topicKey]);

  if (!profile) return null;
  if (error) return <div className="px-8 py-8 text-danger">{error}</div>;
  if (!topic) return <div className="px-8 py-8 text-dim">Загрузка темы…</div>;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <button
        type="button"
        onClick={back}
        className="text-[13px] text-dim hover:text-fg transition-colors mb-4"
      >
        ← Все темы
      </button>

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[18px]" aria-hidden>
            {SAFETY_CATEGORY_ICONS[topic.category]}
          </span>
          <Badge tone="warn">{SAFETY_CATEGORY_TITLES[topic.category]}</Badge>
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight">{topic.title}</h1>
        <p className="text-muted mt-1">{topic.summary}</p>
      </header>

      <article>
        <LessonBlocks
          blocks={topic.blocks}
          skillLevel={profile.skillLevel}
          onOpenCalculator={(key) => navigate({ name: 'calculators', calculatorKey: key })}
          onOpenReference={(section, table) => navigate({ name: 'reference', section, table })}
          onOpenTerm={(term) => navigate({ name: 'reference', section: 'glossary', query: term })}
        />
      </article>

      {topic.lessons.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[13px] uppercase tracking-wider text-dim mb-3">
            Подробнее в Академии
          </h2>
          <div className="flex flex-wrap gap-2">
            {topic.lessons.map((lesson) => (
              <Button
                key={lesson.key}
                variant="ghost"
                size="sm"
                onClick={() => navigate({ name: 'lesson', lessonKey: lesson.key })}
              >
                {lesson.title}
              </Button>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-dim mt-10 leading-relaxed">
        Материалы носят учебный характер. Конкретные требования, типы защиты и допустимые
        режимы определяются действующими нормами вашей юрисдикции и согласованием с
        ресурсоснабжающей организацией.
      </p>
    </div>
  );
}
