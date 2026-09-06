/**
 * Схемы обвязки насосного узла для уроков уровня 7.
 *
 * Все тринадцать схем рисует один чертёж с разной начинкой, а не тринадцать
 * отдельных картинок. Так место элемента читается одинаково во всех уроках:
 * источник всегда слева, насос в середине, система справа, электрическая
 * часть сверху пунктиром. Ученик, перейдя к следующему уроку, узнаёт ту же
 * схему и видит на ней только новый элемент — это и есть цель.
 *
 * Цвета — токены темы, как и в остальных схемах приложения (LessonFigures).
 */

import { PUMP_RIGS } from '@shared/pump-rig-figures.js';
import type { RigPart } from '@shared/pump-rig-figures.js';

const INK = 'rgb(var(--iw-text))';
const MUTED = 'rgb(var(--iw-text-muted))';
const DIM = 'rgb(var(--iw-text-dim))';
const LINE = 'rgb(var(--iw-border-strong))';
const ACCENT = 'rgb(var(--iw-accent-strong))';
const WARN = 'rgb(var(--iw-warn))';
const SURFACE = 'rgb(var(--iw-surface-3))';

export function hasPumpRigFigure(figureKey: string): boolean {
  return figureKey in PUMP_RIGS;
}

/** Ширина чертежа во внутренних координатах SVG. */
const W = 900;
const H = 300;
/** Ось трубы. */
const PIPE_Y = 190;
const PUMP_X = 430;
const PART_W = 74;
const PART_H = 30;

function partsSpan(count: number, from: number, to: number): number[] {
  if (count === 0) return [];
  const step = (to - from) / count;
  return Array.from({ length: count }, (_, i) => from + step * (i + 0.5));
}

function Part({
  x,
  part,
  y,
  width,
}: {
  x: number;
  part: RigPart;
  y: number;
  width: number;
}) {
  const colour = part.highlight ? ACCENT : LINE;
  const text = part.highlight ? ACCENT : INK;

  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - PART_H / 2}
        width={width}
        height={PART_H}
        rx={6}
        fill={SURFACE}
        stroke={colour}
        strokeWidth={part.highlight ? 2 : 1}
      />
      <text x={x} y={y + 4} textAnchor="middle" fill={text} fontSize="11.5">
        {part.label}
      </text>
      {part.note && (
        <text x={x} y={y + PART_H / 2 + 14} textAnchor="middle" fill={DIM} fontSize="10.5">
          {part.note}
        </text>
      )}
    </g>
  );
}

export function PumpRigFigure({ figureKey }: { figureKey: string }) {
  const rig = PUMP_RIGS[figureKey];
  if (!rig) return null;

  const suctionFrom = 120;
  const suctionTo = PUMP_X - 46;
  const dischargeFrom = PUMP_X + 46;
  const dischargeTo = W - 110;

  const suctionX = partsSpan(rig.suction.length, suctionFrom, suctionTo);
  const dischargeX = partsSpan(rig.discharge.length, dischargeFrom, dischargeTo);
  const controlX = partsSpan(rig.control?.length ?? 0, PUMP_X - 150, PUMP_X + 250);

  /*
   * Ширина элемента подгоняется под шаг: на итоговой схеме их девять, и при
   * фиксированной ширине соседние коробки наезжали бы друг на друга.
   */
  const boxWidth = (count: number, from: number, to: number): number =>
    count === 0 ? PART_W : Math.min(PART_W, (to - from) / count - 6);

  const suctionW = boxWidth(rig.suction.length, suctionFrom, suctionTo);
  const dischargeW = boxWidth(rig.discharge.length, dischargeFrom, dischargeTo);

  /*
   * Верхняя полоса чертежа отведена электрической части. Когда её нет, эта
   * полоса остаётся пустой и схема висит в середине карточки — поэтому у
   * таких схем поле обзора начинается ниже.
   */
  const top = rig.control?.length ? 0 : 118;

  return (
    <svg
      viewBox={`0 ${top} ${W} ${H - top}`}
      className="w-full h-auto"
      role="img"
      aria-label={rig.alt}
    >
      <defs>
        <marker id="rig-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 z" fill={LINE} />
        </marker>
      </defs>

      {/* Труба: одна линия через весь чертёж, элементы стоят на ней. */}
      <line x1={96} y1={PIPE_Y} x2={W - 96} y2={PIPE_Y} stroke={LINE} strokeWidth={2.5} />
      <line
        x1={W - 150}
        y1={PIPE_Y}
        x2={W - 100}
        y2={PIPE_Y}
        stroke={LINE}
        strokeWidth={2.5}
        markerEnd="url(#rig-arrow)"
      />

      {/* Источник слева. */}
      <rect x={12} y={PIPE_Y - 26} width={84} height={52} rx={8} fill={SURFACE} stroke={LINE} />
      {(rig.sourceLabel ?? 'Источник').split('\n').map((line, i, all) => (
        <text
          key={line}
          x={54}
          y={PIPE_Y + 4 + (i - (all.length - 1) / 2) * 13}
          textAnchor="middle"
          fill={MUTED}
          fontSize="11.5"
        >
          {line}
        </text>
      ))}

      {/* Система справа. */}
      <rect x={W - 96} y={PIPE_Y - 26} width={84} height={52} rx={8} fill={SURFACE} stroke={LINE} />
      <text x={W - 54} y={PIPE_Y + 4} textAnchor="middle" fill={MUTED} fontSize="11.5">
        Система
      </text>

      {/* Насос. */}
      <circle cx={PUMP_X} cy={PIPE_Y} r={30} fill={SURFACE} stroke={INK} strokeWidth={2} />
      <text x={PUMP_X} y={PIPE_Y + 4} textAnchor="middle" fill={INK} fontSize="12" fontWeight="600">
        НАСОС
      </text>

      {/* Подписи веток: где всас, а где напор — это главное, что должно
          читаться со схемы. */}
      <text x={(120 + PUMP_X) / 2} y={PIPE_Y - 62} textAnchor="middle" fill={MUTED} fontSize="12.5">
        ВСАС
      </text>
      <text
        x={(PUMP_X + W - 110) / 2}
        y={PIPE_Y - 62}
        textAnchor="middle"
        fill={MUTED}
        fontSize="12.5"
      >
        НАПОР
      </text>
      <line x1={110} y1={PIPE_Y - 56} x2={PUMP_X - 40} y2={PIPE_Y - 56} stroke={DIM} strokeWidth={1} strokeDasharray="3 4" />
      <line x1={PUMP_X + 40} y1={PIPE_Y - 56} x2={W - 100} y2={PIPE_Y - 56} stroke={DIM} strokeWidth={1} strokeDasharray="3 4" />

      {rig.suction.map((part, i) => (
        <Part
          key={`s-${part.label}-${i}`}
          x={suctionX[i]!}
          y={PIPE_Y}
          part={part}
          width={suctionW}
        />
      ))}
      {rig.discharge.map((part, i) => (
        <Part
          key={`d-${part.label}-${i}`}
          x={dischargeX[i]!}
          y={PIPE_Y}
          part={part}
          width={dischargeW}
        />
      ))}

      {/* Электрическая часть: пунктир, потому что воду она не несёт. */}
      {rig.control?.map((part, i) => {
        const x = controlX[i]!;
        return (
          <g key={`c-${part.label}-${i}`}>
            <line
              x1={x}
              y1={62}
              x2={PUMP_X}
              y2={PIPE_Y - 32}
              stroke={part.highlight ? ACCENT : WARN}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <rect
              x={x - PART_W / 2 - 6}
              y={34}
              width={PART_W + 12}
              height={PART_H}
              rx={6}
              fill="none"
              stroke={part.highlight ? ACCENT : WARN}
              strokeWidth={part.highlight ? 2 : 1.5}
              strokeDasharray="4 3"
            />
            <text
              x={x}
              y={53}
              textAnchor="middle"
              fill={part.highlight ? ACCENT : WARN}
              fontSize="11.5"
            >
              {part.label}
            </text>
            {part.note && (
              <text x={x} y={78} textAnchor="middle" fill={DIM} fontSize="10.5">
                {part.note}
              </text>
            )}
          </g>
        );
      })}

      {rig.note && (
        <text x={12} y={H - 8} fill={DIM} fontSize="11.5">
          {rig.note}
        </text>
      )}
    </svg>
  );
}
