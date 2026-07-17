import { type ReactNode } from 'react';
import {
  TextField as AriaTextField,
  Input as AriaInput,
  TextArea as AriaTextArea,
  Label,
} from 'react-aria-components';
import { cx } from '../styles';
import {
  fieldLabel,
  fieldLeftSection,
  fieldRoot,
  fieldWrapper,
  inputBase,
  inputWithLeftSection,
  textarea as textareaCls,
} from './input.styles';

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

export function TextInput({
  label,
  leftSection,
  className,
  onChange,
  ...props
}: TextInputProps) {
  return (
    <AriaTextField onChange={onChange} className={fieldRoot}>
      {label && <Label className={fieldLabel}>{label}</Label>}
      <div className={fieldWrapper}>
        {leftSection && <span className={fieldLeftSection}>{leftSection}</span>}
        <AriaInput
          className={cx(
            inputBase,
            leftSection ? inputWithLeftSection : undefined,
            className,
          )}
          {...props}
        />
      </div>
    </AriaTextField>
  );
}

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

export function Textarea({
  autosize,
  minRows = 3,
  maxRows,
  className,
  ...props
}: TextareaProps) {
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
