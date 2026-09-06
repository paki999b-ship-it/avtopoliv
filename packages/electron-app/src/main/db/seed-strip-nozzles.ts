import {
  STRIP_NOZZLES,
  STRIP_NOZZLE_COLLECTED_AT,
  STRIP_NOZZLE_COMMON,
  STRIP_NOZZLE_SOURCE,
  STRIP_NOZZLE_SOURCE_URL,
  STRIP_RECOMMENDED_PRESSURE_BAR,
  m3hToLmin,
  round,
  stripNozzlePrecipitationRate,
} from '@irrigo/core';
import type { Db } from './connection.js';

/**
 * Полосовые форсунки Hunter в справочник сопел.
 *
 * Из технического листа берутся только измеренные производителем величины:
 * давление, размер полосы и расход — они лежат в `@irrigo/core`, потому что
 * нужны и справочнику, и калькулятору §5.6. Интенсивность (PR) здесь
 * **вычисляется** движком по формуле для прямоугольной полосы: переписывать
 * её значило бы завести второй источник правды об одном числе.
 *
 * Сверка расхода: в листе он дан и в м³/ч, и в л/мин. Оба значения округлены
 * производителем, поэтому при наполнении проверяется их согласованность —
 * расхождение больше допустимого означает опечатку при переносе.
 */

/**
 * Допустимое расхождение между м³/ч и л/мин из технического листа: оба числа
 * округлены (до сотых и до десятых), поэтому 0,11 л/мин — шум округления.
 */
const FLOW_CONSISTENCY_TOLERANCE_LMIN = 0.11;

export function stripNozzlesSignature(): string {
  const rows = STRIP_NOZZLES.reduce((sum, m) => sum + m.rows.length, 0);
  return `${STRIP_NOZZLE_COLLECTED_AT}:${STRIP_NOZZLES.length}:${rows}`;
}

export function seedStripNozzles(db: Db): number {
  const insert = db.prepare(`
    INSERT INTO equipment_nozzles
      (brand, family, model, nozzle, sector_deg, pressure_bar, radius_m, flow_m3h,
       flow_lpm, pr_square_mm_h, pr_triangle_mm_h, emitter_class, verified, issue,
       source, source_page, pattern_width_m, pattern_length_m, is_recommended,
       pattern_title, source_url)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'strip', 1, NULL, ?, NULL, ?, ?, ?, ?, ?)
  `);

  let count = 0;

  for (const model of STRIP_NOZZLES) {
    if (model.rows.length === 0) throw new Error(`${model.model}: нет строк производительности`);

    let recommended = 0;

    for (const row of model.rows) {
      // Согласованность двух форм записи расхода из одного технического листа.
      const derivedLmin = m3hToLmin(row.flowM3h);
      if (Math.abs(derivedLmin - row.flowLmin) > FLOW_CONSISTENCY_TOLERANCE_LMIN) {
        throw new Error(
          `${model.model} при ${row.pressureBar} бар: ${row.flowM3h} м³/ч — это ` +
            `${round(derivedLmin, 2)} л/мин, а в листе указано ${row.flowLmin}`,
        );
      }

      // PR считается движком по §5.6 для прямоугольной полосы.
      const pr = stripNozzlePrecipitationRate({
        flowLph: row.flowM3h * 1000,
        widthM: row.widthM,
        lengthM: row.lengthM,
      });

      if (row.recommended) {
        recommended += 1;
        if (row.pressureBar !== STRIP_RECOMMENDED_PRESSURE_BAR) {
          throw new Error(
            `${model.model}: рекомендованной помечена точка ${row.pressureBar} бар, ` +
              `а производитель рекомендует ${STRIP_RECOMMENDED_PRESSURE_BAR} бар`,
          );
        }
      }

      insert.run(
        STRIP_NOZZLE_COMMON.brand,
        STRIP_NOZZLE_COMMON.family,
        model.model,
        // Съёмной насадки у полосовых нет: в этой колонке — форма полива.
        model.patternRu,
        row.pressureBar,
        // Радиуса у полосы нет; для сортировки и сравнения кладём длину.
        row.lengthM,
        row.flowM3h,
        row.flowLmin,
        pr.values.precipitationRateMmH,
        `${STRIP_NOZZLE_SOURCE} (сверено ${STRIP_NOZZLE_COLLECTED_AT})`,
        row.widthM,
        row.lengthM,
        row.recommended ? 1 : 0,
        model.patternRu,
        STRIP_NOZZLE_SOURCE_URL,
      );
      count += 1;
    }

    // Рекомендованная рабочая точка должна быть ровно одна: две означали бы,
    // что в справочнике две «правильные» настройки одной модели.
    if (recommended !== 1) {
      throw new Error(
        `${model.model}: рекомендованных рабочих точек ${recommended}, должна быть одна`,
      );
    }
  }

  return count;
}
