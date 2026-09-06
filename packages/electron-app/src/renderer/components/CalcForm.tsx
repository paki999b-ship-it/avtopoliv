import { Button, Field, NumberInput, Select, TextInput, cx } from '@irrigo/ui';
import type { UnitSystem } from '@shared/types.js';
import type {
  CalcFieldSpec,
  FormValues,
  ListFieldSpec,
  NumberFieldSpec,
  SelectFieldSpec,
  TextFieldSpec,
} from '../calculators/types.js';
import { displayUnit } from '../calculators/units-adapter.js';

/**
 * Форма калькулятора, собранная по описанию полей.
 *
 * Значения хранятся в тех единицах, которые видит пользователь; перевод в
 * метрику для движка делает вызывающая сторона. Здесь только ввод.
 */

interface CalcFormProps {
  fields: CalcFieldSpec[];
  values: FormValues;
  unitSystem: UnitSystem;
  onChange: (values: FormValues) => void;
}

export function CalcForm({ fields, values, unitSystem, onChange }: CalcFormProps) {
  const visible = fields.filter((f) => !('visibleIf' in f) || !f.visibleIf || f.visibleIf(values));

  const set = (name: string, value: FormValues[string]) => onChange({ ...values, [name]: value });

  return (
    <div className="grid gap-5">
      {visible.map((field) => {
        if (field.kind === 'section') {
          return (
            <div
              key={`section-${field.title}`}
              // Первый заголовок стоит вплотную к верху карточки, остальные
              // отбиваются линией: она и делит форму на шаги.
              className="first:mt-0 first:pt-0 first:border-t-0 mt-1 pt-5 border-t border-border"
            >
              <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">
                {field.title}
              </h3>
              {field.description && (
                <p className="text-[12px] text-dim mt-1 leading-relaxed">{field.description}</p>
              )}
            </div>
          );
        }

        if (field.kind === 'list') {
          return (
            <ListInput
              key={field.name}
              spec={field}
              values={values}
              unitSystem={unitSystem}
              onChange={onChange}
            />
          );
        }

        if (field.kind === 'toggle') {
          return (
            <label
              key={field.name}
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={values[field.name] === true}
                onChange={(e) => set(field.name, e.target.checked)}
                className="mt-1 w-4 h-4 accent-[rgb(var(--iw-accent))]"
              />
              <span className="min-w-0">
                <span className="block text-[14px]">{field.label}</span>
                {field.hint && <span className="block text-[12px] text-dim">{field.hint}</span>}
              </span>
            </label>
          );
        }

        if (field.kind === 'select') {
          return (
            <SelectInput
              key={field.name}
              spec={field}
              values={values}
              onChange={(value) => set(field.name, value)}
            />
          );
        }

        if (field.kind === 'text') {
          return (
            <TextField
              key={field.name}
              spec={field}
              value={typeof values[field.name] === 'string' ? (values[field.name] as string) : ''}
              onChange={(value) => set(field.name, value)}
            />
          );
        }

        return (
          <NumberField
            key={field.name}
            spec={field}
            unitSystem={unitSystem}
            value={typeof values[field.name] === 'number' ? (values[field.name] as number) : null}
            onChange={(value) => set(field.name, value)}
          />
        );
      })}
    </div>
  );
}

function NumberField({
  spec,
  value,
  unitSystem,
  onChange,
}: {
  spec: NumberFieldSpec;
  value: number | null;
  unitSystem: UnitSystem;
  onChange: (value: number | null) => void;
}) {
  const { unit } = displayUnit(spec.quantity, spec.unit, unitSystem);
  const hint = spec.optional ? [spec.hint, 'необязательно'].filter(Boolean).join(' · ') : spec.hint;

  return (
    <Field label={spec.label} unit={unit} hint={hint}>
      <NumberInput value={value} onValueChange={onChange} />
    </Field>
  );
}

function SelectInput({
  spec,
  values,
  onChange,
}: {
  spec: SelectFieldSpec;
  values: FormValues;
  onChange: (value: string) => void;
}) {
  const options = spec.optionsFor ? spec.optionsFor(values) : spec.options;
  const current = String(values[spec.name] ?? '');
  // Список мог смениться вместе с соседним полем — тогда выбираем первый пункт.
  const valid = options.some((o) => o.value === current);

  return (
    <Field label={spec.label} hint={spec.hint}>
      <Select
        value={valid ? current : (options[0]?.value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function TextField({
  spec,
  value,
  onChange,
}: {
  spec: TextFieldSpec;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={spec.label} hint={spec.hint}>
      <TextInput
        value={value}
        placeholder={spec.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function ListInput({
  spec,
  values,
  unitSystem,
  onChange,
}: {
  spec: ListFieldSpec;
  values: FormValues;
  unitSystem: UnitSystem;
  onChange: (values: FormValues) => void;
}) {
  const rows = Array.isArray(values[spec.name]) ? (values[spec.name] as FormValues[]) : [];

  const update = (next: FormValues[]) => onChange({ ...values, [spec.name]: next });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] text-muted">{spec.label}</span>
        <Button size="sm" variant="ghost" onClick={() => update([...rows, spec.newItem()])}>
          ＋ {spec.addLabel}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-lg border border-border bg-surface-2 p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] text-dim">Строка {index + 1}</span>
              <button
                type="button"
                disabled={rows.length <= spec.minItems}
                onClick={() => update(rows.filter((_, i) => i !== index))}
                className={cx(
                  'text-[12px] transition-colors',
                  rows.length <= spec.minItems
                    ? 'text-dim/40 cursor-not-allowed'
                    : 'text-dim hover:text-danger',
                )}
              >
                Удалить
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {spec.fields.map((sub) => {
                const setSub = (value: FormValues[string]) =>
                  update(rows.map((r, i) => (i === index ? { ...r, [sub.name]: value } : r)));

                if (sub.kind === 'select') {
                  const options = sub.optionsFor ? sub.optionsFor(row) : sub.options;
                  return (
                    <Field key={sub.name} label={sub.label}>
                      <Select
                        value={String(row[sub.name] ?? options[0]?.value ?? '')}
                        onChange={(e) => setSub(e.target.value)}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  );
                }

                if (sub.kind === 'text') {
                  return (
                    <Field key={sub.name} label={sub.label}>
                      <TextInput
                        value={typeof row[sub.name] === 'string' ? (row[sub.name] as string) : ''}
                        placeholder={sub.placeholder}
                        onChange={(e) => setSub(e.target.value)}
                      />
                    </Field>
                  );
                }

                const { unit } = displayUnit(sub.quantity, sub.unit, unitSystem);
                return (
                  <Field key={sub.name} label={sub.label} unit={unit}>
                    <NumberInput
                      value={typeof row[sub.name] === 'number' ? (row[sub.name] as number) : null}
                      onValueChange={(value) => setSub(value)}
                    />
                  </Field>
                );
              })}
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="text-[13px] text-dim">
            Ни одной строки. Нажмите «{spec.addLabel}».
          </p>
        )}
      </div>
    </div>
  );
}
