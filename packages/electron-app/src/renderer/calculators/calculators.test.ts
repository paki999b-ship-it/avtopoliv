import { describe, expect, it } from 'vitest';
import { CALCULATORS } from '@irrigo/core';
import {
  CALCULATOR_DEFINITIONS,
  calculatorDefinition,
  calculatorEntries,
  missingDefinitions,
} from './index.js';
import type { CalcDefinition, FormValues, NumberFieldSpec } from './types.js';
import { asRecord } from './types.js';
import { displayUnit, fromMetric, toMetric } from './units-adapter.js';
import { buildCsvReport, buildTextReport } from './report.js';

/**
 * Тесты раздела «Калькуляторы».
 *
 * Проверяют не арифметику — она покрыта тестами движка, — а стык между
 * движком и формами: что у каждого расчёта есть форма, что значения по
 * умолчанию считаются, что выводимые поля действительно существуют в
 * результате и что перевод единиц обратим.
 */

/** Значения по умолчанию с раскрытыми списками — то, с чем открывается форма. */
function defaults(definition: CalcDefinition): FormValues {
  return structuredClone(definition.defaults);
}

describe('Реестр калькуляторов (§3.2, §5)', () => {
  it('у каждого калькулятора движка есть форма', () => {
    expect(missingDefinitions()).toEqual([]);
  });

  it('форм ровно столько же, сколько калькуляторов в движке', () => {
    expect(CALCULATOR_DEFINITIONS).toHaveLength(CALCULATORS.length);
    expect(calculatorEntries()).toHaveLength(CALCULATORS.length);
  });

  it('ключи форм не дублируются', () => {
    const keys = CALCULATOR_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('порядок в разделе повторяет порядок §5 из реестра движка', () => {
    expect(calculatorEntries().map((e) => e.meta.key)).toEqual(CALCULATORS.map((c) => c.key));
  });

  it('каждая форма находится по ключу', () => {
    for (const meta of CALCULATORS) {
      expect(calculatorDefinition(meta.key), meta.key).toBeDefined();
    }
  });
});

describe('Значения по умолчанию считаются во всех калькуляторах', () => {
  for (const definition of CALCULATOR_DEFINITIONS) {
    it(`«${definition.key}» считается без ошибок`, () => {
      const result = definition.run({ values: defaults(definition) });
      expect(result.values).toBeTypeOf('object');
      expect(Array.isArray(result.steps)).toBe(true);
      expect(Array.isArray(result.notes)).toBe(true);
    });
  }

  it('каждый калькулятор показывает вывод формулы — §3.2 требует подстановку, а не только ответ', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      const result = definition.run({ values: defaults(definition) });
      expect(result.steps.length, definition.key).toBeGreaterThan(0);
      for (const step of result.steps) {
        expect(step.formula.length, `${definition.key}: пустая формула`).toBeGreaterThan(0);
        expect(step.substitution.length, `${definition.key}: пустая подстановка`).toBeGreaterThan(0);
        expect(step.result.length, `${definition.key}: пустой результат`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Наборы значений, покрывающие все режимы калькулятора.
 *
 * У части калькуляторов есть переключатель режима («PR по голове» против
 * «PR зоны», «линия» против «интенсивности капельной зоны»), и часть
 * выводимых величин существует только в одном из них. Проверять надо каждый.
 */
function valueSetsPerMode(definition: CalcDefinition): Array<{ mode: string; values: FormValues }> {
  const modeField = definition.fields.find((f) => f.kind === 'select' && f.name === 'mode');
  if (!modeField || modeField.kind !== 'select') {
    return [{ mode: 'единственный', values: defaults(definition) }];
  }

  return modeField.options.map((option) => ({
    mode: option.value,
    values: { ...defaults(definition), mode: option.value },
  }));
}

describe('Описания выводимых величин совпадают с результатом движка', () => {
  for (const definition of CALCULATOR_DEFINITIONS) {
    if (definition.outputs.length === 0) continue;

    it(`«${definition.key}»: каждое выводимое поле есть хотя бы в одном режиме`, () => {
      const produced = new Set<string>();

      for (const { mode, values } of valueSetsPerMode(definition)) {
        const raw = asRecord(definition.run({ values }).values);
        for (const key of Object.keys(raw)) produced.add(key);

        // Поля, которых в этом режиме нет, обязаны быть помечены как
        // скрываемые — иначе на экране появится «undefined».
        for (const output of definition.outputs) {
          if (!(output.name in raw) && !output.hideIfNull) {
            throw new Error(
              `${definition.key} / режим «${mode}»: поле «${output.name}» отсутствует ` +
                'в результате и не помечено hideIfNull',
            );
          }
        }
      }

      for (const output of definition.outputs) {
        expect([...produced], `${definition.key}.${output.name}`).toContain(output.name);
      }
    });
  }
});

describe('Все режимы калькуляторов считаются', () => {
  for (const definition of CALCULATOR_DEFINITIONS) {
    const sets = valueSetsPerMode(definition);
    if (sets.length < 2) continue;

    it(`«${definition.key}»: ${sets.length} режима считаются на значениях по умолчанию`, () => {
      for (const { mode, values } of sets) {
        const result = definition.run({ values });
        expect(result.steps.length, `${definition.key} / ${mode}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('Таблицы результата строятся без исключений', () => {
  for (const definition of CALCULATOR_DEFINITIONS) {
    if (!definition.tables) continue;

    it(`«${definition.key}»: таблицы согласованы по числу колонок`, () => {
      const values = defaults(definition);
      const tables = definition.tables!(definition.run({ values }), values);
      for (const table of tables) {
        for (const row of table.rows) {
          expect(row, `${definition.key} / ${table.title}`).toHaveLength(table.columns.length);
        }
      }
    });
  }
});

describe('Подписи в истории и пояснения', () => {
  it('у каждого калькулятора есть непустая подпись для истории', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      const values = defaults(definition);
      const title = definition.historyTitle(values, definition.run({ values }));
      expect(title.trim().length, definition.key).toBeGreaterThan(0);
    }
  });

  it('кнопка «Пояснить» есть у каждого калькулятора и не пуста (§3.2)', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      expect(definition.explain.length, definition.key).toBeGreaterThan(0);
      for (const paragraph of definition.explain) {
        expect(paragraph.trim().length, definition.key).toBeGreaterThan(20);
      }
    }
  });

  it('каждый калькулятор связан с уроком Академии', () => {
    for (const meta of CALCULATORS) {
      expect(meta.lessonKey.trim().length, meta.key).toBeGreaterThan(0);
    }
  });
});

describe('Согласованность описаний форм', () => {
  it('имена полей внутри одной формы не повторяются', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      // Заголовок группы — не поле ввода: у него нет ни имени, ни значения.
      const names = definition.fields.filter((f) => f.kind !== 'section').map((f) => f.name);
      expect(new Set(names).size, definition.key).toBe(names.length);
    }
  });

  it('у каждого поля есть значение по умолчанию', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind === 'section') continue;
        expect(
          Object.prototype.hasOwnProperty.call(definition.defaults, field.name),
          `${definition.key}.${field.name}`,
        ).toBe(true);
      }
    }
  });

  it('заголовок группы полей не пуст', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind !== 'section') continue;
        expect(field.title.trim().length, definition.key).toBeGreaterThan(0);
      }
    }
  });

  it('значение списка по умолчанию не короче минимума', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind !== 'list') continue;
        const rows = definition.defaults[field.name];
        expect(Array.isArray(rows), `${definition.key}.${field.name}`).toBe(true);
        expect((rows as unknown[]).length).toBeGreaterThanOrEqual(field.minItems);
      }
    }
  });

  it('значение выпадающего списка по умолчанию есть среди его вариантов', () => {
    for (const definition of CALCULATOR_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind !== 'select') continue;
        const options = field.optionsFor
          ? field.optionsFor(definition.defaults)
          : field.options;
        const current = String(definition.defaults[field.name]);
        expect(
          options.map((o) => o.value),
          `${definition.key}.${field.name}`,
        ).toContain(current);
      }
    }
  });
});

describe('Переключение систем единиц (§13)', () => {
  it('перевод в имперскую и обратно возвращает исходное значение', () => {
    const quantities = [
      'pressure',
      'flow',
      'flowLph',
      'length',
      'diameter',
      'area',
      'volume',
      'depth',
      'precipitation',
      'velocity',
    ] as const;

    for (const quantity of quantities) {
      for (const value of [0.5, 3, 42, 1234]) {
        const imperial = fromMetric(quantity, value, 'imperial');
        expect(toMetric(quantity, imperial, 'imperial'), quantity).toBeCloseTo(value, 6);
      }
    }
  });

  it('в метрической системе значения не трогаются', () => {
    expect(fromMetric('pressure', 3.5, 'metric')).toBe(3.5);
    expect(toMetric('flow', 12.7, 'metric')).toBe(12.7);
  });

  it('подписи единиц меняются вместе с системой', () => {
    expect(displayUnit('pressure', 'бар', 'metric').unit).toBe('бар');
    expect(displayUnit('pressure', 'бар', 'imperial').unit).toBe('psi');
    expect(displayUnit('flow', 'м³/ч', 'imperial').unit).toBe('GPM');
    // Поле без физической величины (проценты, штуки) не переводится никогда.
    expect(displayUnit(undefined, '%', 'imperial').unit).toBe('%');
  });

  it('известные переводы совпадают со справочными значениями', () => {
    expect(fromMetric('pressure', 1, 'imperial')).toBeCloseTo(14.5, 3);
    expect(fromMetric('flow', 1, 'imperial')).toBeCloseTo(4.403, 2);
    expect(fromMetric('diameter', 25.4, 'imperial')).toBeCloseTo(1, 6);
    expect(fromMetric('precipitation', 25.4, 'imperial')).toBeCloseTo(1, 6);
  });

  it('все числовые поля с величиной имеют её среди поддерживаемых', () => {
    const supported = new Set([
      'pressure',
      'flow',
      'flowLph',
      'length',
      'diameter',
      'area',
      'volume',
      'depth',
      'precipitation',
      'velocity',
      'power',
    ]);

    const numberFields: NumberFieldSpec[] = [];
    for (const definition of CALCULATOR_DEFINITIONS) {
      for (const field of definition.fields) {
        if (field.kind === 'number') numberFields.push(field);
        if (field.kind === 'list') {
          for (const sub of field.fields) if (sub.kind === 'number') numberFields.push(sub);
        }
      }
    }

    for (const field of numberFields) {
      if (field.quantity) expect(supported, field.name).toContain(field.quantity);
    }
  });
});

describe('Выгрузка расчёта (§3.2)', () => {
  const definition = calculatorDefinition('friction-loss')!;
  const meta = CALCULATORS.find((c) => c.key === 'friction-loss')!;

  const values = defaults(definition);
  const result = definition.run({ values });

  const input = {
    meta,
    fields: definition.fields,
    values,
    fieldUnits: { flowM3h: 'м³/ч', innerDiameterMm: 'мм', lengthM: 'м' },
    result,
    outputs: [{ label: 'Потери напора', value: '3,93', unit: 'м вод. ст.' }],
    tables: [],
    profileName: 'Тест',
  };

  it('текстовый отчёт содержит и исходные данные, и вывод формулы', () => {
    const text = buildTextReport(input);
    expect(text).toContain('ИСХОДНЫЕ ДАННЫЕ');
    expect(text).toContain('РАСЧЁТ');
    expect(text).toContain('Потери напора');
    // §10 п.1: пометка об учебном характере уходит вместе с расчётом.
    expect(text).toContain('учебная программа');
  });

  it('CSV экранирует разделитель и кавычки', () => {
    const csv = buildCsvReport({
      ...input,
      tables: [
        {
          title: 'Проверка',
          columns: ['Что', 'Значение'],
          rows: [['Строка; с разделителем', 'Кавычка " внутри']],
        },
      ],
    });

    expect(csv).toContain('"Строка; с разделителем"');
    expect(csv).toContain('"Кавычка "" внутри"');
    // Разделитель строк CRLF — Excel на Windows читает его без вопросов.
    expect(csv).toContain('\r\n');
  });
});
