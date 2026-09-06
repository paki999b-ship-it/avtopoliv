/**
 * @irrigo/ui — дизайн-система АртЛандшафт.
 *
 * Пакет не знает ни про Electron, ни про расчётный движок: только React,
 * классы Tailwind и токены темы из `./theme/theme.css`.
 */
export { cx } from './lib/cx.js';

export { Button } from './components/Button.js';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button.js';

export { Card } from './components/Card.js';
export type { CardProps } from './components/Card.js';

export { ProgressBar } from './components/ProgressBar.js';
export type { ProgressBarProps } from './components/ProgressBar.js';

export { Badge } from './components/Badge.js';
export type { BadgeTone } from './components/Badge.js';

export { Field, TextInput, NumberInput, Select } from './components/Field.js';
export type { FieldProps, NumberInputProps } from './components/Field.js';

export { NoteCard, NoteList } from './components/Notes.js';
export type { NoteLike } from './components/Notes.js';

export { StepList } from './components/Steps.js';
export type { StepLike } from './components/Steps.js';

export { Stat } from './components/Stat.js';
export type { StatProps } from './components/Stat.js';

export { EmptyState } from './components/EmptyState.js';

export {
  PUMP_CURVE_COLORS,
  MAX_PUMP_CURVES_ON_CHART,
  SYSTEM_CURVE_COLOR,
  pumpCurveColor,
} from './constants/pumpCurveColors.js';
