import { useMemo, useRef } from 'react';
import type { CoverageResult, LayoutHead, LayoutPlan, LayoutPoint } from '@irrigo/core';
import { cx } from '@irrigo/ui';

/**
 * Канвас плана участка (§3.4 ТЗ).
 *
 * Рисуется на SVG, а не на растровом холсте: план состоит из десятков фигур,
 * каждая из которых должна оставаться кликабельной и резкой при любом
 * масштабе. Экспорт в PNG делается из того же SVG, так что вторая версия
 * отрисовки не нужна.
 *
 * Координаты плана — метры, ось Y вверх. У SVG ось Y вниз, поэтому весь
 * рисунок один раз переворачивается группой `transform`, а внутри всё
 * считается в понятных «математических» координатах. Подписи при этом
 * переворачиваются обратно, иначе текст оказался бы зеркальным.
 */

/** Отступ вокруг участка, м — чтобы был виден полив за границу. */
const MARGIN_M = 2.5;

const COLOR = {
  outside: 'rgb(var(--iw-bg))',
  site: 'rgb(var(--iw-surface-2))',
  siteEdge: 'rgb(var(--iw-border-strong))',
  obstacle: 'rgb(var(--iw-surface-3))',
  obstacleEdge: 'rgb(var(--iw-text-dim))',
  coverage: 'rgb(var(--iw-accent))',
  head: 'rgb(var(--iw-text))',
  headSelected: 'rgb(var(--iw-accent-strong))',
  dry: 'rgb(var(--iw-danger))',
  grid: 'rgb(var(--iw-border))',
  ink: 'rgb(var(--iw-text-muted))',
} as const;

export interface LayoutCanvasProps {
  plan: LayoutPlan;
  heads: LayoutHead[];
  coverage: CoverageResult | null;
  selectedId: string | null;
  /** Только просмотр — используется для показа эталона. */
  readOnly?: boolean;
  onSelect?: (id: string | null) => void;
  onPlace?: (point: LayoutPoint) => void;
  onMove?: (id: string, point: LayoutPoint) => void;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement>;
}

interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function viewBoxOf(plan: LayoutPlan): ViewBox {
  const xs = plan.boundary.points.map((p) => p.x);
  const ys = plan.boundary.points.map((p) => p.y);
  const minX = Math.min(...xs) - MARGIN_M;
  const maxX = Math.max(...xs) + MARGIN_M;
  const minY = Math.min(...ys) - MARGIN_M;
  const maxY = Math.max(...ys) + MARGIN_M;

  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

const path = (points: LayoutPoint[]): string =>
  `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} Z`;

/** Дуга сектора как замкнутый контур «центр → дуга → центр». */
function sectorPath(head: LayoutHead): string {
  const { x, y } = head.position;
  const r = head.radiusM;

  if (head.sweepDeg >= 360) {
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
  }

  const start = (head.startDeg * Math.PI) / 180;
  const end = ((head.startDeg + head.sweepDeg) * Math.PI) / 180;
  const x1 = x + r * Math.cos(start);
  const y1 = y + r * Math.sin(start);
  const x2 = x + r * Math.cos(end);
  const y2 = y + r * Math.sin(end);
  const largeArc = head.sweepDeg > 180 ? 1 : 0;

  // sweep-flag = 0: дуга идёт против часовой стрелки, как и углы в плане.
  return `M ${x} ${y} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2} Z`;
}

export function LayoutCanvas({
  plan,
  heads,
  coverage,
  selectedId,
  readOnly = false,
  onSelect,
  onPlace,
  onMove,
  className,
  svgRef,
}: LayoutCanvasProps) {
  const view = useMemo(() => viewBoxOf(plan), [plan]);
  const localRef = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? localRef;
  const dragging = useRef<string | null>(null);

  /** Экранные координаты события → метры плана. */
  const toPlan = (event: React.PointerEvent): LayoutPoint | null => {
    const svg = ref.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.round((view.minX + fx * view.width) * 100) / 100,
      // Ось Y перевёрнута: у SVG она растёт вниз, у плана — вверх.
      y: Math.round((view.minY + (1 - fy) * view.height) * 100) / 100,
    };
  };

  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const step = view.width > 30 ? 5 : 1;

    for (let x = Math.ceil(view.minX / step) * step; x < view.minX + view.width; x += step) {
      lines.push({ x1: x, y1: view.minY, x2: x, y2: view.minY + view.height });
    }
    for (let y = Math.ceil(view.minY / step) * step; y < view.minY + view.height; y += step) {
      lines.push({ x1: view.minX, y1: y, x2: view.minX + view.width, y2: y });
    }
    return lines;
  }, [view]);

  return (
    <svg
      ref={ref}
      viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
      className={cx('w-full h-auto select-none', !readOnly && 'cursor-crosshair', className)}
      /*
       * События указателя, а не мыши: на телефоне перетаскивание пальцем не
       * порождает mousemove вовсе — браузер шлёт touchmove, а мышиные события
       * подставляет только по окончании касания. С pointer-событиями один и
       * тот же код обслуживает и мышь, и палец, и стилус.
       *
       * touch-action отключается лишь у рабочего канваса: иначе браузер
       * посчитал бы протяжку прокруткой страницы и увёл бы голову из-под
       * пальца. У режима просмотра прокрутку отбирать не за что.
       */
      style={readOnly ? undefined : { touchAction: 'none' }}
      onPointerDown={(event) => {
        if (readOnly || dragging.current) return;
        // Касание пустого места ставит голову; касание головы её выбирает,
        // и туда событие не доходит — оно остановлено на самой голове.
        const point = toPlan(event);
        if (point) onPlace?.(point);
      }}
      onPointerMove={(event) => {
        if (readOnly || !dragging.current) return;
        const point = toPlan(event);
        if (point) onMove?.(dragging.current, point);
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onPointerCancel={() => {
        dragging.current = null;
      }}
      onPointerLeave={() => {
        dragging.current = null;
      }}
    >
      {/* Разворот оси Y: внутри группы всё рисуется в координатах плана. */}
      <g transform={`translate(0 ${2 * view.minY + view.height}) scale(1 -1)`}>
        <rect
          x={view.minX}
          y={view.minY}
          width={view.width}
          height={view.height}
          fill={COLOR.outside}
        />

        {gridLines.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={COLOR.grid}
            strokeWidth={0.03}
          />
        ))}

        <path
          d={path(plan.boundary.points)}
          fill={COLOR.site}
          stroke={COLOR.siteEdge}
          strokeWidth={0.12}
        />

        {/* Факелы рисуются полупрозрачными: в местах наложения заливка
            складывается, и перекрытие видно без отдельной легенды. */}
        {heads.map((head) => (
          <path
            key={`sector-${head.id}`}
            d={sectorPath(head)}
            fill={COLOR.coverage}
            fillOpacity={0.16}
            stroke={COLOR.coverage}
            strokeOpacity={0.35}
            strokeWidth={0.04}
            pointerEvents="none"
          />
        ))}

        {plan.obstacles.map((obstacle, i) => (
          <path
            key={`obstacle-${i}`}
            d={path(obstacle.polygon.points)}
            fill={COLOR.obstacle}
            stroke={COLOR.obstacleEdge}
            strokeWidth={0.08}
            pointerEvents="none"
          />
        ))}

        {/* §3.4: непокрытые зоны показываются красным. */}
        {coverage?.uncovered.map((cell, i) => (
          <rect
            key={`dry-${i}`}
            x={cell.x - coverage.cellSizeM / 2}
            y={cell.y - coverage.cellSizeM / 2}
            width={coverage.cellSizeM}
            height={coverage.cellSizeM}
            fill={COLOR.dry}
            fillOpacity={0.4}
            pointerEvents="none"
          />
        ))}

        {heads.map((head) => (
          <g key={`head-${head.id}`}>
            <circle
              cx={head.position.x}
              cy={head.position.y}
              r={0.35}
              fill={head.id === selectedId ? COLOR.headSelected : COLOR.head}
              stroke={COLOR.outside}
              strokeWidth={0.08}
              className={readOnly ? undefined : 'cursor-move'}
              onPointerDown={(event) => {
                if (readOnly) return;
                event.stopPropagation();
                dragging.current = head.id;
                onSelect?.(head.id);
                // Захват указателя: палец почти всегда сходит с кружка радиусом
                // 0,35 м, и без захвата перетаскивание обрывалось бы на первом
                // же движении.
                (event.currentTarget as SVGCircleElement).setPointerCapture?.(event.pointerId);
              }}
            />
            {head.id === selectedId && (
              <circle
                cx={head.position.x}
                cy={head.position.y}
                r={0.7}
                fill="none"
                stroke={COLOR.headSelected}
                strokeWidth={0.08}
                pointerEvents="none"
              />
            )}
          </g>
        ))}
      </g>

      {/* Масштабная линейка: без неё размеры на плане ни о чём не говорят. */}
      <g transform={`translate(${view.minX + 0.6} ${view.minY + view.height - 0.6})`}>
        <line x1={0} y1={0} x2={5} y2={0} stroke={COLOR.ink} strokeWidth={0.08} />
        <line x1={0} y1={-0.25} x2={0} y2={0.25} stroke={COLOR.ink} strokeWidth={0.08} />
        <line x1={5} y1={-0.25} x2={5} y2={0.25} stroke={COLOR.ink} strokeWidth={0.08} />
        <text x={2.5} y={-0.5} textAnchor="middle" fill={COLOR.ink} fontSize={0.7}>
          5 м
        </text>
      </g>
    </svg>
  );
}

export { viewBoxOf as layoutViewBox };
