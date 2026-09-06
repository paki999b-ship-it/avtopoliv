import { cx } from '@irrigo/ui';
import logoUrl from '../assets/artlandshaft-logo.png';

/**
 * Логотип АртЛандшафт.
 *
 * В самом знаке уже есть название бренда, поэтому рядом с ним подпись не
 * ставится — иначе название читалось бы дважды.
 *
 * Картинка подключается обычным импортом: Vite кладёт её рядом со страницей,
 * и строгая CSP (§13 ТЗ) с `img-src 'self'` такой файл пропускает — проверено
 * в собранном приложении, которое открывается по `file://`. Сеть при этом не
 * нужна: файл лежит внутри сборки.
 *
 * Знак читается на обеих темах: тёмно-зелёная плашка светлее фона тёмной темы,
 * а светло-зелёные кроны различимы на белом.
 */
export function Logo({ className, title = 'АртЛандшафт' }: { className?: string; title?: string }) {
  return (
    <img
      src={logoUrl}
      alt={title}
      title={title}
      className={cx('block w-auto select-none', className)}
      draggable={false}
    />
  );
}
