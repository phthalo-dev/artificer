import { type ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
} from 'react-aria-components';
import { tooltip as tooltipCls } from './tooltip.styles';

export type TooltipProps = {
  label: ReactNode;
  children: ReactNode;
  withArrow?: boolean;
  multiline?: boolean;
};

export function Tooltip({ label, children, withArrow }: TooltipProps) {
  return (
    <TooltipTrigger delay={400}>
      {children}
      <AriaTooltip className={tooltipCls}>
        {withArrow && (
          <OverlayArrow>
            <svg width={8} height={8}>
              <path d="M0 0 L4 4 L8 0" fill="black" />
            </svg>
          </OverlayArrow>
        )}
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
