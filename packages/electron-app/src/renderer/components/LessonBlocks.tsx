import { Fragment, type ReactNode } from 'react';
import { Badge, Button, Card, cx } from '@irrigo/ui';
import type { Audience, LessonBlock } from '@shared/academy.js';
import type { SkillLevel } from '@shared/types.js';
import { LessonFigure } from './LessonFigures.js';

/**
 * Отрисовка блоков урока.
 *
 * Уровень подачи (§1 ТЗ) реализован здесь: блок с полем `audience` виден
 * только соответствующему профилю. Владелец участка не видит вывод формул,
 * проектировщик видит их дополнительно к общему тексту.
 *
 * Разметка внутри текста — минимальная и своя: `**жирный**`, `` `код` `` и
 * `[[термин]]` со ссылкой на глоссарий. Полноценный markdown здесь не нужен,
 * а его разбор — лишняя зависимость и лишний источник неожиданностей.
 */

export function isVisibleFor(audience: Audience | Audience[] | undefined, skill: SkillLevel): boolean {
  if (!audience) return true;
  const list = Array.isArray(audience) ? audience : [audience];
  return list.includes('all') || list.includes(skill);
}

interface LessonBlocksProps {
  blocks: LessonBlock[];
  skillLevel: SkillLevel;
  onOpenCalculator: (key: string) => void;
  onOpenReference: (section: string, table?: string) => void;
  onOpenTerm: (term: string) => void;
}

export function LessonBlocks({
  blocks,
  skillLevel,
  onOpenCalculator,
  onOpenReference,
  onOpenTerm,
}: LessonBlocksProps) {
  const visible = blocks.filter((b) => isVisibleFor(b.audience, skillLevel));

  return (
    <div className="flex flex-col gap-4">
      {visible.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          onOpenCalculator={onOpenCalculator}
          onOpenReference={onOpenReference}
          onOpenTerm={onOpenTerm}
        />
      ))}
    </div>
  );
}

const CALLOUT_TONE = {
  note: { box: 'border-info/35 bg-info-dim', dot: 'bg-info', label: 'Заметка' },
  success: { box: 'border-ok/35 bg-ok-dim', dot: 'bg-ok', label: 'Как надо' },
  warning: { box: 'border-warn/35 bg-warn-dim', dot: 'bg-warn', label: 'Внимание' },
  danger: { box: 'border-danger/35 bg-danger-dim', dot: 'bg-danger', label: 'Опасно' },
} as const;

function BlockView({
  block,
  onOpenCalculator,
  onOpenReference,
  onOpenTerm,
}: {
  block: LessonBlock;
  onOpenCalculator: (key: string) => void;
  onOpenReference: (section: string, table?: string) => void;
  onOpenTerm: (term: string) => void;
}) {
  switch (block.type) {
    case 'heading':
      return (
        <h2 className="text-[19px] font-semibold tracking-tight mt-4">
          <Inline text={block.text} onOpenTerm={onOpenTerm} />
        </h2>
      );

    case 'text':
      return (
        <p className="text-[15px] leading-relaxed text-text/90">
          <Inline text={block.text} onOpenTerm={onOpenTerm} />
        </p>
      );

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          className={cx(
            'text-[15px] leading-relaxed text-text/90 pl-6 space-y-2',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} onOpenTerm={onOpenTerm} />
            </li>
          ))}
        </Tag>
      );
    }

    case 'callout': {
      const tone = CALLOUT_TONE[block.tone];
      return (
        <div className={cx('flex gap-3 p-4 rounded-lg border', tone.box)}>
          <span className={cx('mt-2 w-2 h-2 rounded-full shrink-0', tone.dot)} aria-hidden />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{block.title ?? tone.label}</p>
            <p className="text-[14px] text-muted mt-1 leading-relaxed">
              <Inline text={block.text} onOpenTerm={onOpenTerm} />
            </p>
          </div>
        </div>
      );
    }

    case 'formula':
      return (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="iw-num text-[15px] text-accent-ink">{block.formula}</p>
          {block.substitution && (
            <p className="iw-num text-[13px] text-text/80 mt-2">{block.substitution}</p>
          )}
          {block.result && (
            <p className="iw-num text-[15px] font-semibold mt-1">= {block.result}</p>
          )}
          {block.where && block.where.length > 0 && (
            <ul className="text-[13px] text-dim mt-3 space-y-1">
              {block.where.map((line, i) => (
                <li key={i}>
                  <Inline text={line} onOpenTerm={onOpenTerm} />
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case 'table':
      return (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="text-left border-b border-border bg-surface-2/60 text-dim">
                  {block.columns.map((column, i) => (
                    <th key={i} className="py-2.5 px-4 font-medium">
                      <Inline text={column} onOpenTerm={onOpenTerm} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className={cx('py-2.5 px-4 align-top', j > 0 && 'text-muted')}>
                        <Inline text={cell} onOpenTerm={onOpenTerm} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <p className="text-[12px] text-dim px-4 py-2.5 border-t border-border">
              {block.caption}
            </p>
          )}
        </div>
      );

    case 'calculator':
      return (
        <Card
          title={`🧮 ${block.title}`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => onOpenCalculator(block.calculatorKey)}>
              Открыть расчёт →
            </Button>
          }
        >
          <p className="text-[14px] text-muted">{block.text}</p>
        </Card>
      );

    case 'reference':
      return (
        <Card
          title={`📚 ${block.title}`}
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenReference(block.section, block.table)}
            >
              Открыть справочник →
            </Button>
          }
        >
          <p className="text-[14px] text-muted">{block.text}</p>
        </Card>
      );

    case 'figure':
      return (
        <figure className="rounded-lg border border-border bg-surface-2 p-5">
          <LessonFigure figureKey={block.figureKey} />
          <figcaption className="text-[13px] text-dim mt-3 text-center">
            {block.caption}
          </figcaption>
        </figure>
      );

    default:
      return null;
  }
}

/**
 * Встроенная разметка: `**жирный**`, `` `код` `` и `[[термин]]` либо
 * `[[термин|подпись]]`. Ссылка на термин открывает его в глоссарии (§3.3.8:
 * «термины в уроках подсвечиваются и раскрываются по клику»).
 */
export function Inline({
  text,
  onOpenTerm,
}: {
  text: string;
  onOpenTerm: (term: string) => void;
}): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\*\*([^*]+)\*\*|`([^`]+)`/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    const [, term, label, bold, code] = match;

    if (term !== undefined) {
      parts.push(
        <button
          key={key++}
          type="button"
          onClick={() => onOpenTerm(term)}
          title="Открыть термин в глоссарии"
          className="text-accent-ink border-b border-dashed border-accent/50 hover:border-accent transition-colors"
        >
          {label ?? term}
        </button>,
      );
    } else if (bold !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold text-text">
          {bold}
        </strong>,
      );
    } else if (code !== undefined) {
      parts.push(
        <code key={key++} className="iw-num text-[13px] px-1 py-0.5 rounded bg-surface-3">
          {code}
        </code>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return <>{parts}</>;
}
