import { describe, expect, it } from 'vitest';
import { STRIP_MIXING_WARNING, stripNozzlePrecipitationRate } from './strip-nozzle.js';

/**
 * Полосовые форсунки: контрольный пример из технического листа Hunter.
 */

describe('Интенсивность полосовой форсунки (§5.6)', () => {
  it('контрольный пример SS-530 при 2,1 бар → около 22 мм/ч', () => {
    // 5,0 л/мин = 300 л/ч, полоса 1,5 × 9,1 м.
    const result = stripNozzlePrecipitationRate({ flowLph: 300, widthM: 1.5, lengthM: 9.1 });

    expect(result.values.wettedAreaM2).toBeCloseTo(13.65, 2);
    expect(result.values.precipitationRateMmH).toBeCloseTo(22, 0);
  });

  it('площадь считается как прямоугольник, а не как сектор круга', () => {
    const result = stripNozzlePrecipitationRate({ flowLph: 150, widthM: 1.5, lengthM: 4.5 });

    expect(result.values.wettedAreaM2).toBeCloseTo(6.75, 2);
    expect(result.values.precipitationRateMmH).toBeCloseTo(22.2, 1);
  });

  it('показывает формулу и подстановку', () => {
    const result = stripNozzlePrecipitationRate({ flowLph: 300, widthM: 1.5, lengthM: 9.1 });

    expect(result.steps.map((s) => s.formula)).toEqual([
      'A = ширина × длина',
      'PR = q / A',
    ]);
    expect(result.steps[1]!.substitution).toBe('300,0 / 13,65');
  });

  it('предупреждает о несовместимости с веерными и роторными соплами', () => {
    const result = stripNozzlePrecipitationRate({ flowLph: 300, widthM: 1.5, lengthM: 9.1 });
    const note = result.notes.find((n) => n.code === 'strip-not-matched');

    expect(note?.message).toBe(STRIP_MIXING_WARNING);
    expect(note?.fix).toMatch(/отдельную зону/);
  });

  it('расход на метр полосы у семейства одинаков — на этом строится согласование', () => {
    // Боковая SS-530 и центральная CS-530 при 2,1 бар: 300 л/ч на 9,1 м.
    const side = stripNozzlePrecipitationRate({ flowLph: 300, widthM: 1.5, lengthM: 9.1 });
    const center = stripNozzlePrecipitationRate({ flowLph: 300, widthM: 1.5, lengthM: 9.1 });

    expect(side.values.flowPerMetreLphM).toBeCloseTo(center.values.flowPerMetreLphM, 3);
  });

  it('нулевые и отрицательные размеры отвергаются', () => {
    expect(() => stripNozzlePrecipitationRate({ flowLph: 300, widthM: 0, lengthM: 9.1 })).toThrow(
      /Ширина полосы/,
    );
    expect(() => stripNozzlePrecipitationRate({ flowLph: 0, widthM: 1.5, lengthM: 9.1 })).toThrow(
      /Расход форсунки/,
    );
  });
});
