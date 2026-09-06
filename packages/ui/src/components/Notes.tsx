import { cx } from '../lib/cx.js';

/**
 * Замечание расчётного движка. Поля повторяют `CalcNote` из @irrigo/core
 * (что не так → почему → как исправить, §5.16 ТЗ), но объявлены здесь
 * структурно: дизайн-система не тянет за собой движок.
 */
export interface NoteLike {
  severity: 'info' | 'warning' | 'error' | 'success';
  /** Что не так. */
  message: string;
  /** Почему это плохо. */
  why?: string;
  /** Как исправить. */
  fix?: string;
}

const TONE: Record<NoteLike['severity'], { box: string; dot: string }> = {
  success: { box: 'border-ok/35 bg-ok-dim', dot: 'bg-ok' },
  info: { box: 'border-info/35 bg-info-dim', dot: 'bg-info' },
  warning: { box: 'border-warn/35 bg-warn-dim', dot: 'bg-warn' },
  error: { box: 'border-danger/35 bg-danger-dim', dot: 'bg-danger' },
};

export function NoteCard({ note, className }: { note: NoteLike; className?: string }) {
  const tone = TONE[note.severity];
  return (
    <div className={cx('flex gap-3 p-3.5 rounded-lg border', tone.box, className)}>
      <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', tone.dot)} aria-hidden />
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-snug">{note.message}</p>
        {note.why && <p className="text-[13px] text-muted mt-1">{note.why}</p>}
        {note.fix && (
          <p className="text-[13px] mt-1.5">
            <span className="text-dim">Как исправить: </span>
            {note.fix}
          </p>
        )}
      </div>
    </div>
  );
}

export function NoteList({ notes, className }: { notes: NoteLike[]; className?: string }) {
  if (notes.length === 0) return null;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {notes.map((note, i) => (
        <NoteCard key={`${note.severity}-${i}`} note={note} />
      ))}
    </div>
  );
}
