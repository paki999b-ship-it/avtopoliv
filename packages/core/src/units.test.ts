import { describe, expect, it } from 'vitest';
import {
  barToMwc,
  barToPsi,
  barToKpa,
  m3hToLmin,
  m3hToLs,
  m3hToGpm,
  inchToMm,
  inHToMmH,
  sotkaToM2,
  convert,
  convertAll,
  listUnits,
  kinematicViscosity,
  mwcToBar,
  psiToBar,
} from './units.js';

describe('§5.1 Конвертер единиц — соотношения из ТЗ', () => {
  it('1 бар = 10,2 м вод. ст. = 14,5 psi = 100 кПа', () => {
    expect(barToMwc(1)).toBeCloseTo(10.2, 6);
    expect(barToPsi(1)).toBeCloseTo(14.5, 6);
    expect(barToKpa(1)).toBeCloseTo(100, 6);
  });

  it('1 м³/ч = 16,67 л/мин = 4,40 GPM = 0,278 л/с', () => {
    expect(m3hToLmin(1)).toBeCloseTo(16.67, 2);
    expect(m3hToGpm(1)).toBeCloseTo(4.4, 2);
    expect(m3hToLs(1)).toBeCloseTo(0.278, 3);
  });

  it('1 дюйм = 25,4 мм, 1 in/ч = 25,4 мм/ч, 1 сотка = 100 м²', () => {
    expect(inchToMm(1)).toBe(25.4);
    expect(inHToMmH(1)).toBe(25.4);
    expect(sotkaToM2(1)).toBe(100);
  });

  it('обратные преобразования возвращают исходное значение', () => {
    expect(mwcToBar(barToMwc(3.7))).toBeCloseTo(3.7, 10);
    expect(psiToBar(barToPsi(2.5))).toBeCloseTo(2.5, 10);
  });
});

describe('convertAll / convert', () => {
  it('переводит давление во все родственные единицы', () => {
    const rows = convertAll('pressure', 3, 'бар');
    expect(rows.find((r) => r.unit === 'psi')!.value).toBeCloseTo(43.5, 4);
    expect(rows.find((r) => r.unit === 'м вод. ст.')!.value).toBeCloseTo(30.6, 4);
    expect(rows.find((r) => r.unit === 'кПа')!.value).toBeCloseTo(300, 4);
  });

  it('переводит расход из л/мин в м³/ч и обратно', () => {
    expect(convert('flow', 16.666666, 'л/мин', 'м³/ч')).toBeCloseTo(1, 5);
    expect(convert('flow', 1, 'м³/ч', 'GPM')).toBeCloseTo(4.4, 2);
  });

  it('мм осадков и л/м² — одна и та же величина', () => {
    expect(convert('depth', 12, 'мм', 'л/м²')).toBe(12);
    expect(convert('precipitation', 30, 'мм/ч', 'л/(м²·ч)')).toBe(30);
  });

  it('переводит интенсивность из мм/ч в дюймы в час', () => {
    expect(convert('precipitation', 25.4, 'мм/ч', 'in/ч')).toBeCloseTo(1, 6);
  });

  it('бросает понятную ошибку для неизвестной единицы', () => {
    expect(() => convert('flow', 1, 'вёдер/ч', 'м³/ч')).toThrow(/Неизвестная единица/);
  });

  it('все объявленные единицы обратимы сами в себя', () => {
    const quantities = ['pressure', 'flow', 'length', 'area', 'volume', 'depth', 'precipitation'] as const;
    for (const q of quantities) {
      for (const { unit } of listUnits(q)) {
        expect(convert(q, 7.3, unit, unit)).toBeCloseTo(7.3, 8);
      }
    }
  });
});

describe('Кинематическая вязкость воды', () => {
  it('при 20 °C близка к табличным 1,0·10⁻⁶ м²/с', () => {
    expect(kinematicViscosity(20)).toBeGreaterThan(0.9e-6);
    expect(kinematicViscosity(20)).toBeLessThan(1.1e-6);
  });

  it('убывает с ростом температуры', () => {
    expect(kinematicViscosity(30)).toBeLessThan(kinematicViscosity(10));
  });
});
