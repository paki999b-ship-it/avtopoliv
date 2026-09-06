import { describe, expect, it } from 'vitest';
import { flowVelocity, velocityMs } from './velocity.js';
import { selectPipeDiameter } from './pipe-sizing.js';
import { minorLosses } from './minor-losses.js';
import { waterHammer, zhukovskyPressureRisePa } from './water-hammer.js';
import { PIPE_CATALOG, nominalWallMm, findPipe } from '../data/pipes.js';
import { m3hToM3s } from '../units.js';

describe('§5.3 Скорость потока', () => {
  it('v = 4Q/(πD²): 13 м³/ч в трубе 55,4 мм → около 1,5 м/с', () => {
    expect(velocityMs(m3hToM3s(13), 0.0554)).toBeCloseTo(1.5, 1);
  });

  it('признаёт целевой диапазон 1,0–1,5 м/с', () => {
    const r = flowVelocity({ flowM3h: 13, innerDiameterMm: 55.4 });
    expect(r.values.status).toBe('ok');
    expect(r.notes.some((n) => n.severity === 'error')).toBe(false);
  });

  it('даёт ошибку при выходе за предел 2,0 м/с', () => {
    const r = flowVelocity({ flowM3h: 25, innerDiameterMm: 55.4 });
    expect(r.values.status).toBe('over_limit');
    const err = r.notes.find((n) => n.code === 'velocity-over-limit');
    expect(err?.severity).toBe('error');
    // Замечание построено как «что не так → почему → как исправить» (§5.16).
    expect(err?.why).toBeTruthy();
    expect(err?.fix).toBeTruthy();
  });

  it('предупреждает выше 1,5 м/с, но ниже 2,0 м/с', () => {
    const r = flowVelocity({ flowM3h: 16, innerDiameterMm: 55.4 });
    expect(r.values.status).toBe('above_target');
  });

  it('для всасывающей линии применяет более жёсткий предел 1,2 м/с', () => {
    const r = flowVelocity({ flowM3h: 13, innerDiameterMm: 55.4, role: 'suction' });
    expect(r.values.limitMs).toBe(1.2);
    expect(r.values.status).toBe('over_limit');
  });

  it('сообщает о заниженной скорости', () => {
    const r = flowVelocity({ flowM3h: 2, innerDiameterMm: 55.4 });
    expect(r.values.status).toBe('below_target');
  });
});

describe('§5.4 Подбор диаметра трубы', () => {
  it('под 13 м³/ч при цели 1,5 м/с требует внутренний диаметр около 55 мм', () => {
    const r = selectPipeDiameter({ flowM3h: 13, targetVelocityMs: 1.5 });
    expect(r.values.requiredIdMm).toBeCloseTo(55.4, 0);
  });

  it('рекомендует трубу со скоростью в пределах 2,0 м/с', () => {
    const r = selectPipeDiameter({ flowM3h: 13, standard: 'PE100 SDR17' });
    expect(r.values.recommended).not.toBeNull();
    expect(r.values.recommended!.velocityMs).toBeLessThanOrEqual(2.0);
    expect(r.values.recommended!.idMm).toBeGreaterThanOrEqual(r.values.requiredIdMm);
  });

  it('даёт соседние варианты вверх и вниз с их показателями', () => {
    const r = selectPipeDiameter({ flowM3h: 6, standard: 'PE100 SDR11' });
    expect(r.values.smaller).not.toBeNull();
    expect(r.values.larger).not.toBeNull();
    expect(r.values.smaller!.odMm).toBeLessThan(r.values.recommended!.odMm);
    expect(r.values.larger!.odMm).toBeGreaterThan(r.values.recommended!.odMm);
    // У меньшего диаметра скорость и потери выше.
    expect(r.values.smaller!.velocityMs).toBeGreaterThan(r.values.recommended!.velocityMs);
    expect(r.values.smaller!.headLossPer100mM).toBeGreaterThan(
      r.values.recommended!.headLossPer100mM,
    );
  });

  it('сообщает об ошибке, когда расход не помещается ни в один диаметр ряда', () => {
    const r = selectPipeDiameter({ flowM3h: 400, standard: 'PVC PN16' });
    expect(r.notes.some((n) => n.code === 'no-pipe-within-limit' && n.severity === 'error')).toBe(
      true,
    );
  });

  it('всасывающая линия подбирается на более низкую скорость', () => {
    const main = selectPipeDiameter({ flowM3h: 10, role: 'main' });
    const suction = selectPipeDiameter({ flowM3h: 10, role: 'suction' });
    expect(suction.values.requiredIdMm).toBeGreaterThan(main.values.requiredIdMm);
  });
});

describe('Сортамент труб', () => {
  it('внутренний диаметр ПНД 63 SDR17 равен 55,4 мм (контрольный пример ТЗ)', () => {
    expect(findPipe('pe100-sdr17-63')!.idMm).toBeCloseTo(55.4, 2);
  });

  it('номинальная толщина стенки согласуется с D/SDR', () => {
    // SDR — величина номинальная, а ряд толщин стандарта округлён: допускается
    // отклонение до 0,05 мм вниз (например, ПЭ100 SDR11 Ø75: 6,8 при D/SDR = 6,818)
    // и до 0,5 мм вверх. Более крупное расхождение — почти наверняка опечатка.
    for (const p of PIPE_CATALOG) {
      const computed = p.odMm / p.sdr;
      expect(p.wallMm).toBeGreaterThanOrEqual(computed - 0.05);
      expect(p.wallMm - computed).toBeLessThanOrEqual(0.5);
    }
  });

  it('внутренний диаметр = наружный минус две стенки', () => {
    for (const p of PIPE_CATALOG) {
      expect(p.idMm).toBeCloseTo(p.odMm - 2 * p.wallMm, 6);
      expect(p.idMm).toBeGreaterThan(0);
    }
  });

  it('у каждой строки заполнено поле source (§7 ТЗ)', () => {
    for (const p of PIPE_CATALOG) {
      expect(p.source.trim().length).toBeGreaterThan(0);
    }
  });

  it('резервный расчёт стенки округляет вверх до 0,1 мм с минимумом 2,0', () => {
    expect(nominalWallMm(63, 17)).toBeCloseTo(3.8, 6);
    expect(nominalWallMm(20, 17)).toBe(2.0);
  });

  it('ключи сортамента уникальны', () => {
    const keys = PIPE_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('§5.5 Местные потери', () => {
  it('доля на фитингах по умолчанию 15 % от потерь на трение', () => {
    const r = minorLosses({ frictionLossM: 10 });
    expect(r.values.fittingsLossM).toBeCloseTo(1.5, 6);
  });

  it('складывает паспортные потери устройств узла', () => {
    const r = minorLosses({
      frictionLossM: 10,
      devices: [
        { name: 'Дисковый фильтр 1"', kind: 'filter', lossBar: 0.3, source: 'техкарта' },
        { name: 'Клапан 1"', kind: 'valve', lossBar: 0.25, source: 'график потерь' },
      ],
    });
    // 0,55 бар = 5,61 м
    expect(r.values.devicesLossM).toBeCloseTo(5.61, 2);
    expect(r.values.totalMinorLossM).toBeCloseTo(7.11, 2);
    expect(r.values.grandTotalM).toBeCloseTo(17.11, 2);
    expect(r.values.breakdown).toHaveLength(2);
  });

  it('требует источник для паспортных значений', () => {
    const r = minorLosses({
      frictionLossM: 5,
      devices: [{ name: 'Клапан', kind: 'valve', lossBar: 0.3 }],
    });
    expect(r.notes.some((n) => n.code === 'device-no-source')).toBe(true);
  });

  it('предупреждает при доле выше 20 %', () => {
    const r = minorLosses({ frictionLossM: 10, fittingsShare: 0.35 });
    expect(r.notes.some((n) => n.code === 'fittings-share-high')).toBe(true);
  });
});

describe('§5.13 Гидроудар (Жуковский)', () => {
  it('при v = 1,5 м/с в стали даёт скачок порядка 18 бар (пример ТЗ)', () => {
    const r = waterHammer({ velocityChangeMs: 1.5, material: 'steel', waveSpeedMs: 1200 });
    expect(r.values.surgeBar).toBeCloseTo(18, 1);
  });

  it('диапазон по материалу: сталь 1000–1200 м/с', () => {
    const r = waterHammer({ velocityChangeMs: 1.5, material: 'steel' });
    expect(r.values.surgeBarMin).toBeCloseTo(15, 1);
    expect(r.values.surgeBarMax).toBeCloseTo(18, 1);
  });

  it('полиэтилен гасит удар в разы сильнее стали', () => {
    const pe = waterHammer({ velocityChangeMs: 1.5, material: 'pe' });
    const steel = waterHammer({ velocityChangeMs: 1.5, material: 'steel' });
    expect(steel.values.surgeBar / pe.values.surgeBar).toBeGreaterThan(2.5);
  });

  it('Δp = ρ·c·Δv в паскалях', () => {
    expect(zhukovskyPressureRisePa(1200, 1.5)).toBeCloseTo(1_800_000, 6);
  });

  it('считает фазу 2L/c и отличает быстрое закрытие от медленного', () => {
    const fast = waterHammer({
      velocityChangeMs: 1.5,
      material: 'steel',
      lengthM: 100,
      closingTimeS: 0.1,
    });
    expect(fast.values.phaseS).toBeCloseTo(0.182, 2);
    expect(fast.values.isFastClosure).toBe(true);

    const slow = waterHammer({
      velocityChangeMs: 1.5,
      material: 'steel',
      lengthM: 100,
      closingTimeS: 2,
    });
    expect(slow.values.isFastClosure).toBe(false);
  });

  it('добавляет рабочее давление к пику', () => {
    const r = waterHammer({
      velocityChangeMs: 1.0,
      material: 'pe',
      waveSpeedMs: 350,
      workingPressureBar: 3,
    });
    expect(r.values.peakPressureBar).toBeCloseTo(3 + 3.5, 2);
  });

  it('на сильном ударе выдаёт ошибку с разбором', () => {
    const r = waterHammer({ velocityChangeMs: 2, material: 'steel' });
    const err = r.notes.find((n) => n.code === 'hammer-severe');
    expect(err?.severity).toBe('error');
    expect(err?.fix).toBeTruthy();
  });
});
