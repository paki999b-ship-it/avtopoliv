/**
 * Оценка тренажёра «Найди ошибку» (§3.5 ТЗ).
 *
 * Сценарий — это набор фактов об объекте, часть из которых ошибочна.
 * Пользователь отмечает те, что считает ошибками.
 *
 * Правило счёта одно и объявляется пользователю до начала: за отмеченную
 * ошибку — плюс, за отмеченный исправный узел — минус того же веса.
 *
 *   оценка = (найдено − ложных срабатываний) / всего ошибок
 *
 * Почему именно так. Если ложные срабатывания не штрафовать, выигрышной
 * стратегией становится «отметить всё», и тренажёр перестаёт чему-либо учить.
 * Если считать долю правильных решений по всем карточкам, то сценарий из
 * шести карточек с двумя ошибками даёт 67 % за полное бездействие. Штраф
 * ровно того же веса, что и находка, делает угадывание бессмысленным:
 * матожидание случайной отметки — ноль.
 *
 * Оценка ограничена снизу нулём: отрицательный результат ничего не добавляет
 * к «совсем не справился», а в прогрессе выглядел бы странно.
 */

export interface ScenarioItemMark {
  key: string;
  isError: boolean;
}

export interface ScenarioScore {
  /** Итог 0…1. */
  score: number;
  /** Сколько ошибок в сценарии всего. */
  totalErrors: number;
  /** Ошибки, которые пользователь нашёл. */
  found: string[];
  /** Ошибки, которые пользователь пропустил. */
  missed: string[];
  /** Исправные узлы, ошибочно отмеченные как ошибки. */
  falsePositives: string[];
}

export function scoreScenario(
  items: readonly ScenarioItemMark[],
  markedKeys: readonly string[],
): ScenarioScore {
  const known = new Set(items.map((i) => i.key));
  // Незнакомые ключи молча отбрасываются: сценарий мог измениться между
  // открытием экрана и отправкой ответа, и это не повод ронять проверку.
  const marked = new Set([...markedKeys].filter((key) => known.has(key)));

  const found: string[] = [];
  const missed: string[] = [];
  const falsePositives: string[] = [];

  for (const item of items) {
    if (item.isError) {
      (marked.has(item.key) ? found : missed).push(item.key);
    } else if (marked.has(item.key)) {
      falsePositives.push(item.key);
    }
  }

  const totalErrors = found.length + missed.length;
  if (totalErrors === 0) {
    // Сценарий без единой ошибки — дефект контента, а не задание.
    // Проверка при наполнении базы такое не пропускает; здесь просто ноль.
    return { score: 0, totalErrors: 0, found, missed, falsePositives };
  }

  const raw = (found.length - falsePositives.length) / totalErrors;

  return {
    score: Math.max(0, Math.round(raw * 1000) / 1000),
    totalErrors,
    found,
    missed,
    falsePositives,
  };
}
