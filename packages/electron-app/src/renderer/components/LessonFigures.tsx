/**
 * Схемы для уроков.
 *
 * Рисуются встроенным SVG, а не картинками: приложение полностью офлайн,
 * внешних источников нет (§13 ТЗ), а векторная схема остаётся резкой при любом
 * масштабе окна и подхватывает цвета темы.
 *
 * Цвета берутся из токенов интерфейса через `currentColor` и переменные, чтобы
 * схема не выпадала из темы при её изменении.
 */

import { PumpRigFigure, hasPumpRigFigure } from './PumpRigFigure.js';

const INK = 'rgb(var(--iw-text))';
const MUTED = 'rgb(var(--iw-text-muted))';
const DIM = 'rgb(var(--iw-text-dim))';
const LINE = 'rgb(var(--iw-border-strong))';
const ACCENT = 'rgb(var(--iw-accent-strong))';
const WARN = 'rgb(var(--iw-warn))';
const SURFACE = 'rgb(var(--iw-surface-3))';

export function LessonFigure({ figureKey }: { figureKey: string }) {
  switch (figureKey) {
    case 'system-chain':
      return <SystemChain />;
    case 'static-vs-dynamic':
      return <StaticVsDynamic />;
    case 'zone-sequence':
      return <ZoneSequence />;
    case 'pump-duty-point':
      return <PumpDutyPoint />;
    case 'head-to-head':
      return <HeadToHead />;
    default:
      // Схемы обвязки насосного узла (уровень 7) рисует один чертёж с разной
      // начинкой — перечислять тринадцать веток здесь незачем.
      if (hasPumpRigFigure(figureKey)) return <PumpRigFigure figureKey={figureKey} />;
      return (
        <p className="text-[13px] text-dim text-center py-6">
          Схема «{figureKey}» ещё не нарисована.
        </p>
      );
  }
}

/** Цепочка звеньев системы: источник → … → контроллер. */
function SystemChain() {
  const items = [
    'Источник',
    'Узел',
    'Магистраль',
    'Клапаны',
    'Зоны',
    'Дождеватели',
  ];

  const boxWidth = 108;
  const gap = 18;
  const height = 44;
  const width = items.length * boxWidth + (items.length - 1) * gap;

  return (
    <svg
      viewBox={`0 0 ${width} 130`}
      className="w-full h-auto"
      role="img"
      aria-label="Цепочка звеньев системы полива: источник, узел, магистраль, клапаны, зоны, дождеватели; сверху — контроллер, управляющий клапанами"
    >
      <defs>
        <marker id="chain-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={LINE} />
        </marker>
      </defs>

      {items.map((item, index) => {
        const x = index * (boxWidth + gap);
        return (
          <g key={item}>
            <rect
              x={x}
              y={58}
              width={boxWidth}
              height={height}
              rx={8}
              fill={SURFACE}
              stroke={index === 0 ? ACCENT : LINE}
              strokeWidth={index === 0 ? 2 : 1}
            />
            <text
              x={x + boxWidth / 2}
              y={85}
              textAnchor="middle"
              fill={index === 0 ? ACCENT : INK}
              fontSize="13"
            >
              {item}
            </text>
            {index < items.length - 1 && (
              <line
                x1={x + boxWidth + 2}
                y1={80}
                x2={x + boxWidth + gap - 4}
                y2={80}
                stroke={LINE}
                strokeWidth={1.5}
                markerEnd="url(#chain-arrow)"
              />
            )}
          </g>
        );
      })}

      {/* Контроллер управляет клапанами, но воду не несёт — отсюда пунктир. */}
      <rect
        x={3 * (boxWidth + gap) - 20}
        y={8}
        width={boxWidth}
        height={height - 8}
        rx={8}
        fill="none"
        stroke={WARN}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text
        x={3 * (boxWidth + gap) - 20 + boxWidth / 2}
        y={31}
        textAnchor="middle"
        fill={WARN}
        fontSize="13"
      >
        Контроллер
      </text>
      <line
        x1={3 * (boxWidth + gap) - 20 + boxWidth / 2}
        y1={44}
        x2={3 * (boxWidth + gap) + boxWidth / 2}
        y2={56}
        stroke={WARN}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />

      <text x={0} y={122} fill={DIM} fontSize="12">
        Дебит источника ограничивает всё, что правее
      </text>
    </svg>
  );
}

/** Манометр при закрытом и открытом кране. */
function StaticVsDynamic() {
  return (
    <svg
      viewBox="0 0 520 180"
      className="w-full h-auto"
      role="img"
      aria-label="Слева: закрытый кран, манометр показывает 4 бара — статическое давление. Справа: открытый кран, тот же манометр показывает 2,4 бара — динамическое. Разница в 1,6 бара и есть потери"
    >
      {[
        { x: 20, label: 'Кран закрыт', value: '4,0 бар', sub: 'статическое', colour: MUTED },
        { x: 290, label: 'Кран открыт', value: '2,4 бар', sub: 'динамическое', colour: ACCENT },
      ].map((item) => (
        <g key={item.label}>
          <rect x={item.x} y={20} width={210} height={110} rx={10} fill={SURFACE} stroke={LINE} />
          <circle cx={item.x + 52} cy={70} r={30} fill="none" stroke={item.colour} strokeWidth={2} />
          <line
            x1={item.x + 52}
            y1={70}
            x2={item.x + (item.label === 'Кран закрыт' ? 72 : 36)}
            y2={item.label === 'Кран закрыт' ? 48 : 52}
            stroke={item.colour}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <text x={item.x + 100} y={58} fill={INK} fontSize="14">
            {item.label}
          </text>
          <text x={item.x + 100} y={80} fill={item.colour} fontSize="18" fontWeight="600">
            {item.value}
          </text>
          <text x={item.x + 100} y={100} fill={DIM} fontSize="12">
            {item.sub}
          </text>
        </g>
      ))}

      <text x={20} y={158} fill={WARN} fontSize="13">
        Разница 1,6 бара — это все потери при данном расходе
      </text>
    </svg>
  );
}

/** Перекрытие «голова в голову»: шаг равен радиусу. */
function HeadToHead() {
  const heads = [90, 190, 290, 390];
  const radius = 100;

  return (
    <svg
      viewBox="0 0 500 190"
      className="w-full h-auto"
      role="img"
      aria-label="Четыре дождевателя с шагом, равным радиусу: круги покрытия соседних голов достают до корпусов друг друга, и слабый край одной струи накладывается на сильную часть соседней"
    >
      {/* Круги покрытия рисуются полупрозрачной заливкой: в местах наложения
          она складывается, и перекрытие видно без дополнительных подписей. */}
      {heads.map((x) => (
        <circle
          key={x}
          cx={x}
          cy={95}
          r={radius}
          fill={ACCENT}
          fillOpacity={0.1}
          stroke={ACCENT}
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      ))}

      {heads.map((x) => (
        <g key={`head-${x}`}>
          <circle cx={x} cy={95} r={5} fill={SURFACE} stroke={INK} strokeWidth={2} />
        </g>
      ))}

      <line
        x1={heads[0]}
        y1={150}
        x2={heads[1]}
        y2={150}
        stroke={WARN}
        strokeWidth={1.5}
      />
      <text x={(heads[0]! + heads[1]!) / 2} y={166} textAnchor="middle" fill={WARN} fontSize="12">
        шаг = радиус
      </text>

      <text x={12} y={22} fill={DIM} fontSize="12">
        Струя каждой головы достаёт до соседней
      </text>
    </svg>
  );
}

/** Кривая насоса против характеристики системы: где они пересекаются. */
function PumpDutyPoint() {
  // Кривая насоса падает, характеристика системы растёт — схема качественная,
  // числовой расчёт делает калькулятор §5.11.
  const pump = 'M 60,55 C 160,60 260,95 400,175';
  const system = 'M 60,190 C 160,185 260,155 400,80';

  return (
    <svg
      viewBox="0 0 460 240"
      className="w-full h-auto"
      role="img"
      aria-label="Кривая насоса падает с ростом расхода, характеристика системы растёт; точка их пересечения — рабочая точка"
    >
      <line x1={55} y1={200} x2={430} y2={200} stroke={LINE} strokeWidth={1} />
      <line x1={55} y1={40} x2={55} y2={200} stroke={LINE} strokeWidth={1} />

      <path d={pump} fill="none" stroke={ACCENT} strokeWidth={2} />
      <path d={system} fill="none" stroke={WARN} strokeWidth={2} />

      {/* Пересечение отмечено кольцом, а не точкой: так его видно на обеих линиях. */}
      <circle cx={222} cy={135} r={7} fill={SURFACE} stroke={INK} strokeWidth={2.5} />
      <line x1={222} y1={135} x2={222} y2={200} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" />
      <line x1={55} y1={135} x2={222} y2={135} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" />
      <text x={232} y={128} fill={INK} fontSize="13">
        рабочая точка
      </text>

      <text x={300} y={168} fill={ACCENT} fontSize="12">
        насос H(Q)
      </text>
      <text x={300} y={72} fill={WARN} fontSize="12">
        система
      </text>

      <text x={396} y={220} fill={DIM} fontSize="12">
        расход Q
      </text>
      <text x={18} y={48} fill={DIM} fontSize="12">
        напор H
      </text>
      <text x={60} y={232} fill={DIM} fontSize="12">
        При нулевом расходе напор максимален — и полива нет вовсе
      </text>
    </svg>
  );
}

/** Зоны отрабатывают последовательно внутри окна полива. */
function ZoneSequence() {
  const zones = [
    { name: 'Зона 1', start: 0, length: 35 },
    { name: 'Зона 2', start: 35, length: 30 },
    { name: 'Зона 3', start: 65, length: 40 },
    { name: 'Зона 4', start: 105, length: 25 },
  ];

  const windowMinutes = 240;
  const scale = 460 / windowMinutes;

  return (
    <svg
      viewBox="0 0 500 150"
      className="w-full h-auto"
      role="img"
      aria-label="Четыре зоны работают последовательно внутри окна полива с 3:00 до 7:00, занимая 130 минут из 240 доступных"
    >
      <line x1={20} y1={100} x2={480} y2={100} stroke={LINE} strokeWidth={1} />
      {[0, 60, 120, 180, 240].map((minute) => (
        <g key={minute}>
          <line
            x1={20 + minute * scale}
            y1={96}
            x2={20 + minute * scale}
            y2={104}
            stroke={LINE}
            strokeWidth={1}
          />
          <text x={20 + minute * scale} y={120} textAnchor="middle" fill={DIM} fontSize="11">
            {3 + minute / 60}:00
          </text>
        </g>
      ))}

      {zones.map((zone) => (
        <g key={zone.name}>
          <rect
            x={20 + zone.start * scale}
            y={48}
            width={zone.length * scale - 3}
            height={40}
            rx={5}
            fill={SURFACE}
            stroke={ACCENT}
          />
          <text
            x={20 + zone.start * scale + (zone.length * scale - 3) / 2}
            y={73}
            textAnchor="middle"
            fill={INK}
            fontSize="12"
          >
            {zone.name}
          </text>
        </g>
      ))}

      <text x={20} y={30} fill={MUTED} fontSize="13">
        Окно полива 4 часа · зоны заняли 130 минут
      </text>
      <text x={20} y={142} fill={DIM} fontSize="12">
        Одновременно работает только одна зона — дебита на две не хватит
      </text>
    </svg>
  );
}
