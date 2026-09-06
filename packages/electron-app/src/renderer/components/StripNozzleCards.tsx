import { Badge, Card, cx } from '@irrigo/ui';
import {
  STRIP_NOZZLES,
  STRIP_NOZZLE_COMMON,
  STRIP_NOZZLE_SOURCE,
  STRIP_NOZZLE_SOURCE_URL,
  STRIP_RECOMMENDED_PRESSURE_BAR,
  fmt,
  stripNozzlePrecipitationRate,
} from '@irrigo/core';
import type { StripNozzleModel, StripPattern } from '@irrigo/core';

/**
 * Карточки полосовых форсунок (§3.3.1).
 *
 * Схема формы полива нарисована SVG прямо здесь, а не картинкой: у полосовой
 * форсунки вся геометрия — это прямоугольник и точка, где стоит сама форсунка.
 * Растровая иллюстрация на это ушла бы в шесть файлов, которые нечем
 * проверить, а SVG строится из тех же чисел, что и таблица.
 *
 * Интенсивность в карточке считается движком по §5.6, а не берётся из базы:
 * карточка и справочная таблица показывают одно число, полученное одним
 * способом.
 */

/** Где стоит форсунка относительно полосы, в долях от её габарита. */
const HEAD_POSITION: Record<StripPattern, { x: number; y: number; title: string }> = {
  left_corner: { x: 0, y: 0.5, title: 'форсунка в левом углу полосы' },
  right_corner: { x: 1, y: 0.5, title: 'форсунка в правом углу полосы' },
  side: { x: 0.5, y: 1, title: 'форсунка на длинной стороне, полоса в обе стороны' },
  side_wide: { x: 0.5, y: 1, title: 'форсунка на длинной стороне, полоса шире' },
  center: { x: 0.5, y: 0.5, title: 'форсунка в середине полосы' },
  end: { x: 0.5, y: 1, title: 'форсунка на торце полосы' },
};

/** Схема полосы: прямоугольник в масштабе и точка установки форсунки. */
function StripShape({ model }: { model: StripNozzleModel }) {
  const row =
    model.rows.find((r) => r.recommended) ?? model.rows[model.rows.length - 1]!;

  // Масштаб один на все модели, чтобы карточки можно было сравнивать глазом:
  // самая длинная полоса группы — 9,1 м.
  const maxLengthM = 9.1;
  const maxWidthM = 2.7;
  const boxW = 200;
  const boxH = 70;

  const w = (row.lengthM / maxLengthM) * boxW;
  const h = (row.widthM / maxWidthM) * (boxH - 16);
  const x = (boxW - w) / 2;
  const y = (boxH - h) / 2;

  const pos = HEAD_POSITION[model.pattern];
  const hx = x + pos.x * w;
  const hy = y + pos.y * h;

  return (
    <svg
      viewBox={`0 0 ${boxW} ${boxH}`}
      className="w-full h-auto"
      role="img"
      aria-label={`${model.patternRu}: ${pos.title}`}
    >
      <title>{pos.title}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        fill="rgb(var(--iw-accent))"
        fillOpacity={0.18}
        stroke="rgb(var(--iw-accent))"
        strokeOpacity={0.55}
        strokeWidth={1}
      />
      <circle cx={hx} cy={hy} r={4} fill="rgb(var(--iw-text))" stroke="rgb(var(--iw-bg))" strokeWidth={1.5} />
      <text x={boxW / 2} y={boxH - 2} textAnchor="middle" fontSize={9} fill="rgb(var(--iw-text-muted))">
        {fmt(row.widthM, 1)} × {fmt(row.lengthM, 1)} м при {fmt(row.pressureBar, 1)} бар
      </text>
    </svg>
  );
}

export function StripNozzleCards() {
  return (
    <div className="mb-6">
      <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 mb-4 text-[12px] text-dim leading-relaxed">
        <p>
          <span className="text-muted">{STRIP_NOZZLE_COMMON.purpose}</span>
        </p>
        <p className="mt-2">
          Резьба входа {STRIP_NOZZLE_COMMON.inletThread}. Сектор не регулируется — форма полива
          задана самой форсункой. Рекомендованное рабочее давление{' '}
          {fmt(STRIP_RECOMMENDED_PRESSURE_BAR, 1)} бар. {STRIP_NOZZLE_COMMON.compatibility}{' '}
          Гарантия производителя {STRIP_NOZZLE_COMMON.warrantyYears} года.
        </p>
        <p className="mt-2">
          Источник: {STRIP_NOZZLE_SOURCE}.{' '}
          <a
            href={STRIP_NOZZLE_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-accent-ink hover:underline"
          >
            технический лист ↗
          </a>{' '}
          Сверьте значения с актуальной техкартой производителя перед заказом.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {STRIP_NOZZLES.map((model) => {
          const best = model.rows.find((r) => r.recommended)!;
          const pr = stripNozzlePrecipitationRate({
            flowLph: best.flowM3h * 1000,
            widthM: best.widthM,
            lengthM: best.lengthM,
          });

          return (
            <Card key={model.model} className="h-full">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-medium">{model.model}</span>
                <Badge tone="accent">{model.patternRu}</Badge>
              </div>
              <p className="text-[12px] text-muted leading-relaxed mb-3">{model.description}</p>

              <StripShape model={model} />

              <dl className="mt-3 flex flex-col gap-1 text-[12px]">
                <Row label="Рабочая точка">
                  {fmt(best.pressureBar, 1)} бар ({best.pressureKpa} кПа)
                </Row>
                <Row label="Полоса">
                  {fmt(best.widthM, 1)} × {fmt(best.lengthM, 1)} м
                </Row>
                <Row label="Расход">
                  {fmt(best.flowM3h, 2)} м³/ч · {fmt(best.flowLmin, 1)} л/мин
                </Row>
                <Row label="Интенсивность">
                  {fmt(pr.values.precipitationRateMmH, 1)} мм/ч
                </Row>
                <Row label="Расход на метр">
                  {fmt(pr.values.flowPerMetreLphM, 1)} л/ч·м
                </Row>
              </dl>

              <p className="text-[11px] text-dim mt-3">
                Полная таблица давлений — ниже, строка «{model.model}».
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-2')}>
      <dt className="text-dim">{label}</dt>
      <dd className="iw-num text-right">{children}</dd>
    </div>
  );
}
