/**
 * Разбор таблиц каталога LEO по координатам текста.
 *
 * ── Чем это лучше плоского текста ──────────────────────────────────────────
 * Первый заход разбирал `LEO_Industrial_Pumps_text.txt` — тот же каталог, но
 * потоком строк без координат. Там колонки приходилось угадывать по порядку
 * слов, и как только распознавание теряло одно значение в шапке, ряд напоров
 * переставал сходиться с рядом расходов: из девятнадцати таблиц уцелело
 * 37 моделей.
 *
 * В PDF у каждого слова есть координата. Значение напора привязывается к
 * своему столбцу расхода по горизонтали, а не по номеру в строке, поэтому
 * пропуск в середине ряда больше не сдвигает всё остальное — он остаётся
 * пропуском в своей клетке.
 *
 * ── Что всё равно проверяется ──────────────────────────────────────────────
 * Распознавание остаётся распознаванием: оно теряет десятичные точки («19,5»
 * → «195») и подставляет кириллицу вместо цифр. Поэтому каждая строка
 * проходит те же инженерные проверки, что и в текстовом разборе, и строки,
 * которые «чинятся» сдвигом десятичной точки, по-прежнему отбрасываются:
 * восстановленное значение ничем не отличается от правдоподобной ошибки.
 */

const NUMBER = /^\d+([.,]\d+)?$/;

const clean = (token) =>
  token
    .replace(/\|/g, '')
    .replace(/^[.,;:]+|[.,;:]+$/g, '')
    .replace(/[{]/g, '(')
    .replace(/[}]/g, ')')
    .trim();

const isNumber = (token) => NUMBER.test(token);
const valueOf = (token) => Number(token.replace(',', '.'));
const isModelName = (token) => /^[A-Za-z][A-Za-z0-9()[\]/.\-]{1,24}$/.test(token);

/** Кривая насоса: не растёт и не проваливается ступенькой в разы. */
const MAX_ADJACENT_DROP = 5;
const MAX_HEAD_M = 500;

function curveLooksSane(heads) {
  if (heads.length < 4) return false;
  if (!(heads[0] > 0 && heads[0] <= MAX_HEAD_M)) return false;
  for (let i = 1; i < heads.length; i += 1) {
    if (heads[i] > heads[i - 1]) return false;
    if (heads[i] > 0 && heads[i - 1] / heads[i] > MAX_ADJACENT_DROP) return false;
  }
  return true;
}

/** Строка чинится сдвигом десятичной точки — такие мы не берём, но считаем. */
function repairable(heads) {
  const fixed = [...heads];
  for (let i = 1; i < fixed.length; i += 1) {
    if (fixed[i] <= fixed[i - 1]) continue;
    if (fixed[i] / 10 <= fixed[i - 1]) fixed[i] /= 10;
    else return false;
  }
  return curveLooksSane(fixed);
}

/**
 * Мощность на валу сверяется с гидравлической: P = Q · H / 367 (кВт при Q в
 * м³/ч и H в м). Отношение вне 0,8…8 означает, что в колонку мощности попало
 * чужое число — чаще всего крайний напор.
 */
function powerLooksSane(kw, curve) {
  if (!(kw >= 0.1 && kw <= 500)) return false;
  const middle = curve[Math.floor(curve.length / 2)];
  const hydraulic = (middle.qM3h * middle.hM) / 367;
  if (hydraulic <= 0) return false;
  const ratio = kw / hydraulic;
  return ratio >= 0.8 && ratio <= 8;
}

/** Группировка элементов страницы в строки по близости координаты Y. */
function toRows(items, tolerance = 3.5) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.y - b.y);
}

/**
 * Столбцы расхода в строке-шапке: самая длинная возрастающая цепочка чисел.
 *
 * Подпись «Q (м³/ч)» стоит то слева от ряда, то справа от него, поэтому
 * опираться на её положение нельзя — ищется сам ряд.
 */
function flowColumns(row) {
  const numeric = row.items
    .map((it) => ({ x: it.x, token: clean(it.str ?? '') }))
    .filter((it) => isNumber(it.token))
    .map((it) => ({ x: it.x, q: valueOf(it.token) }));

  if (numeric.length < 4) return null;

  let best = [];
  let run = [];
  for (const cell of numeric) {
    if (run.length === 0 || cell.q > run[run.length - 1].q) run.push(cell);
    else {
      if (run.length > best.length) best = run;
      run = [cell];
    }
  }
  if (run.length > best.length) best = run;

  if (best.length < 4) return null;

  /*
   * Шаг ряда расходов должен быть регулярным.
   *
   * Распознавание теряет десятичную точку и в шапке: «2,5 2,8 3,2» читается
   * как «25 28 32», и ряд остаётся возрастающим — прежние проверки этого не
   * ловят, а ось расхода уезжает на порядок. Настоящие каталожные ряды идут
   * ровным шагом (25 30 35 40 …), поэтому разброс шага и выдаёт подделку.
   * Последний шаг часто короче остальных (…55 58) — запас на это заложен.
   */
  const steps = best.slice(1).map((cell, i) => cell.q - best[i].q);
  const sorted = [...steps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;
  if (steps.some((step) => step > median * 3 || step < median / 3)) return null;

  return best;
}

/*
 * Шапка опознаётся по структуре, а не по подписи.
 *
 * Подпись расхода в распознанном тексте выглядит как угодно: «Q (м)», «a(n)»,
 * «Q(wm)», «@ (л/мин)» — опираться на неё значит терять таблицы. Признак
 * шапки — сам ряд: пять и больше возрастающих чисел в одной строке. Осями
 * графиков это тоже бывает, но под осью нет строк с названием модели слева,
 * и такая «таблица» не даёт ни одной записи.
 */
const MIN_FLOW_COLUMNS = 5;

export function parseLeoPages(pages) {
  const pumps = [];
  const stats = { tables: 0, accepted: 0, rejectedRepairable: 0, rejectedBroken: 0 };
  const seen = new Set();

  for (const { page, items } of pages) {
    if (!items || items.length === 0) continue;
    const rows = toRows(items);

    for (let r = 0; r < rows.length; r += 1) {
      const columns = flowColumns(rows[r]);
      if (!columns || columns.length < MIN_FLOW_COLUMNS) continue;

      const leftEdge = columns[0].x;
      let tableRows = 0;

      // Строки модели идут ниже шапки, пока попадают в те же столбцы.
      for (let k = r + 1; k < rows.length; k += 1) {
        const row = rows[k];
        // Разрыв по вертикали больше трёх строк — таблица кончилась.
        if (row.y - rows[k - 1].y > 40) break;

        const tokens = row.items
          .map((it) => ({ x: it.x, token: clean(it.str ?? '') }))
          .filter((it) => it.token);
        const names = tokens.filter((it) => it.x < leftEdge - 4 && isModelName(it.token));
        if (names.length === 0) continue;

        // Напор берётся из клетки под своим столбцом расхода.
        const heads = [];
        const flows = [];
        for (const column of columns) {
          const cell = tokens.find(
            (it) => Math.abs(it.x - column.x) <= 14 && isNumber(it.token),
          );
          if (!cell) continue;
          flows.push(column.q);
          heads.push(valueOf(cell.token));
        }

        // Пропуск в клетке остаётся пропуском: соседние точки не сдвигаются.
        while (heads.length > 0 && heads[heads.length - 1] === 0) {
          heads.pop();
          flows.pop();
        }
        if (heads.length < 4) continue;

        if (!curveLooksSane(heads)) {
          if (repairable(heads)) stats.rejectedRepairable += 1;
          else stats.rejectedBroken += 1;
          continue;
        }

        const curve = flows.map((q, i) => ({ qM3h: q, hM: heads[i] }));

        // Мощность — крайнее число слева от первого столбца расхода.
        const leftNumbers = tokens
          .filter((it) => it.x < leftEdge - 4 && isNumber(it.token))
          .map((it) => valueOf(it.token));
        const power = leftNumbers.length > 0 ? leftNumbers[0] : null;

        if (power === null || !powerLooksSane(power, curve)) {
          stats.rejectedBroken += 1;
          continue;
        }

        const model = names[0].token;
        if (seen.has(model)) continue;
        seen.add(model);

        tableRows += 1;
        pumps.push({
          model,
          ...(names.length > 1 ? { altModel: names.slice(1).map((n) => n.token).join(' ') } : {}),
          powerKw: power,
          page,
          curve,
        });
        stats.accepted += 1;
      }

      if (tableRows > 0) stats.tables += 1;
    }
  }

  return { pumps, stats };
}
