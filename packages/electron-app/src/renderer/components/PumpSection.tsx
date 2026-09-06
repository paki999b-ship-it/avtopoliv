import type { FormValues } from '../calculators/types.js';
import { PumpCurveChart } from './PumpCurveChart.js';
import { PumpHeadBreakdown } from './PumpHeadBreakdown.js';
import { PumpMatches } from './PumpMatches.js';

/**
 * Блок под результатом калькулятора §5.11.
 *
 * Порядок частей повторяет порядок вопросов, которые задаёт человек:
 *
 *  1. **Из чего сложился напор.** Почему требуется именно столько и что из
 *     этого можно уменьшить.
 *  2. **Какой насос взять.** Модели из каталогов, разобранных из PDF в
 *     `/content`, которые покрывают требуемую точку без избыточного запаса.
 *  3. **Что будет с этим насосом.** Если насос уже есть или предложен
 *     поставщиком — две-три точки из его паспорта и пересечение с
 *     характеристикой системы.
 *
 * Раньше третья часть шла первой и была включена по умолчанию: человек видел
 * шесть полей ввода паспортной кривой раньше, чем ответ на вопрос «а какой
 * вообще нужен насос». Теперь она необязательный шаг 3 в форме.
 *
 * Заменять подбор проверкой по паспорту нельзя и наоборот: в каталогах
 * приложения есть не всё, а конкретную машину всегда проверяют по паспорту.
 */
export function PumpSection({ values, result }: { values: FormValues; result: unknown }) {
  return (
    <div className="flex flex-col gap-5">
      <PumpHeadBreakdown values={values} result={result} />
      <PointsLegend />
      <PumpMatches values={values} result={result} />
      <PumpCurveChart values={values} result={result} />
    </div>
  );
}

/**
 * Три точки, которые в разговоре о насосах постоянно путают.
 *
 * Различие между ними — не терминологическая придирка: именно на нём стоит
 * типовая ошибка §11 п.5, когда насос подбирают по максимальному напору из
 * рекламы. Поэтому определения даются один раз и на видном месте, а не
 * россыпью подписей на графиках.
 */
function PointsLegend() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">
        Три точки, которые легко перепутать
      </h3>
      <dl className="mt-3 flex flex-col gap-2.5 text-[13px] leading-relaxed">
        <div>
          <dt className="inline font-medium">Требуемая точка</dt>
          <dd className="inline text-muted">
            {' '}
            — расход вашей самой тяжёлой зоны и напор, который посчитан выше. Это то, что
            нужно системе.
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Кривая насоса</dt>
          <dd className="inline text-muted">
            {' '}
            — сколько напора машина даёт при разном расходе. Чем больше расход, тем меньше
            напор; максимальный напор из рекламы — это точка при нулевом расходе, то есть
            при закрытом кране.
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Рабочая точка</dt>
          <dd className="inline text-muted">
            {' '}
            — пересечение кривой насоса с характеристикой системы. Это то, что вы получите
            в действительности, и подбирают насос именно по ней.
          </dd>
        </div>
      </dl>
    </div>
  );
}
