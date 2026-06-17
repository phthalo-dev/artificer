import { type ReactNode, forwardRef } from 'react';
import {
  TextField as AriaTextField,
  Input as AriaInput,
  TextArea as AriaTextArea,
  Label,
  FieldError,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const inputBaseCls = styles.class('nb-input-base', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: `${space.xs} ${space.sm}`,
  width: '100%',
  outline: 'none',
  boxShadow: `2px 2px 0 0 ${color.border}`,
  '&:focus': { boxShadow: `3px 3px 0 0 ${color.border}`, outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  '&::placeholder': { color: color.dimmed },
});

const textareaCls = styles.class('nb-textarea', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: space.sm,
  width: '100%',
  outline: 'none',
  resize: 'vertical',
  boxShadow: `2px 2px 0 0 ${color.border}`,
  '&:focus': { boxShadow: `3px 3px 0 0 ${color.border}`, outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  '&::placeholder': { color: color.dimmed },
});

// ── TextInput ─────────────────────────────────────────────────────────

export type TextInputProps = {
  label?: ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  leftSection?: ReactNode;
  'aria-label'?: string;
  className?: string;
  autoFocus?: boolean;
  name?: string;
  type?: string;
};

export function TextInput({ label, leftSection, className, onChange, ...props }: TextInputProps) {
  return (
    <AriaTextField onChange={onChange} style={{ position: 'relative' }}>
      {label && <Label style={{ display: 'block', fontSize: font.sizeSm, fontWeight: 600, marginBottom: '4px' }}>{label}</Label>}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leftSection && (
          <span style={{ position: 'absolute', left: '8px', color: color.dimmed, display: 'flex', pointerEvents: 'none' }}>
            {leftSection}
          </span>
        )}
        <AriaInput
          className={cx(inputBaseCls, className)}
          style={leftSection ? { paddingLeft: '30px' } : undefined}
          {...props}
        />
      </div>
    </AriaTextField>
  );
}

// ── Textarea ──────────────────────────────────────────────────────────

export type TextareaProps = {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  className?: string;
};

export function Textarea({ autosize, minRows = 3, maxRows, className, ...props }: TextareaProps) {
  return (
    <AriaTextField>
      <AriaTextArea
        rows={minRows}
        className={cx(textareaCls, className)}
        style={maxRows ? { maxHeight: `${maxRows * 1.5 * 14}px` } : undefined}
        {...props}
      />
    </AriaTextField>
  );
}
