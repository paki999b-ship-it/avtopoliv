import { describe, expect, it } from 'vitest';
import {
  CABLE_CROSS_SECTIONS_MM2,
  CABLE_TABLE,
  SOLENOID_INRUSH_50HZ_A,
  cableRowsForSection,
  maxCableLengthM,
  minimumCrossSection,
} from './cable.js';
import { valveCableDrop } from '../electrical/voltage-drop.js';
import { VALVE_CABLE } from '../constants.js';

/**
 * Справочник кабеля выводится из формулы §5.12, поэтому главная проверка —
 * что он совпадает с калькулятором, а не живёт своей жизнью.
 */

describe('Таблица кабеля (§3.3.6)', () => {
  it('покрывает весь ряд сечений', () => {
    for (const section of CABLE_CROSS_SECTIONS_MM2) {
      expect(cableRowsForSection(section).length, `${section} мм²`).toBeGreaterThan(0);
    }
  });

  it('у каждой строки непустой источник (§0 п.6)', () => {
    for (const row of CABLE_TABLE) {
      expect(row.source.trim().length).toBeGreaterThan(0);
    }
  });

  it('совпадает с калькулятором §5.12 строка в строку', () => {
    for (const row of CABLE_TABLE) {
      const calc = valveCableDrop({
        lengthM: row.maxLengthM,
        crossSectionMm2: row.crossSectionMm2,
        currentA: row.currentA,
      });
      // На заявленной длине допуск ещё соблюдён.
      expect(calc.values.acceptable, `${row.crossSectionMm2} мм² / ${row.currentA} А`).toBe(true);
      expect(calc.values.maxLengthM).toBeGreaterThanOrEqual(row.maxLengthM);
    }
  });

  it('на метр длиннее заявленного допуск уже нарушен', () => {
    for (const row of CABLE_TABLE) {
      const calc = valveCableDrop({
        lengthM: row.maxLengthM + 1,
        crossSectionMm2: row.crossSectionMm2,
        currentA: row.currentA,
      });
      // Округление вниз должно быть плотным: следующий метр обязан выходить
      // за допуск, иначе таблица занижает возможности кабеля.
      expect(calc.values.dropV).toBeGreaterThan(VALVE_CABLE.maxDropV - 1e-9);
    }
  });

  it('длина растёт с сечением и падает с током', () => {
    const oneValve = CABLE_TABLE.filter((r) => r.solenoids === 1).sort(
      (a, b) => a.crossSectionMm2 - b.crossSectionMm2,
    );
    for (let i = 1; i < oneValve.length; i += 1) {
      expect(oneValve[i]!.maxLengthM).toBeGreaterThan(oneValve[i - 1]!.maxLengthM);
    }

    const oneSection = cableRowsForSection(1).sort((a, b) => a.currentA - b.currentA);
    for (let i = 1; i < oneSection.length; i += 1) {
      expect(oneSection[i]!.maxLengthM).toBeLessThan(oneSection[i - 1]!.maxLengthM);
    }
  });

  it('воспроизводит типовую ошибку §11 п.6: 0,5 мм² на 150 м не проходит', () => {
    const row = CABLE_TABLE.find((r) => r.crossSectionMm2 === 0.5 && r.solenoids === 1);
    expect(row).toBeDefined();
    expect(row!.maxLengthM).toBeLessThan(150);
  });

  it('подбирает минимальное достаточное сечение', () => {
    const current = SOLENOID_INRUSH_50HZ_A;
    const section = minimumCrossSection(100, current);
    expect(section).not.toBeNull();
    expect(maxCableLengthM(section!, current)).toBeGreaterThanOrEqual(100);

    // Ряд заканчивается на 2,5 мм²: на запредельной длине честнее вернуть null,
    // чем молча предложить самое толстое сечение.
    expect(minimumCrossSection(100000, current)).toBeNull();
  });

  it('не принимает нулевые и отрицательные аргументы', () => {
    expect(() => maxCableLengthM(0, 0.37)).toThrow();
    expect(() => maxCableLengthM(1, 0)).toThrow();
  });
});
