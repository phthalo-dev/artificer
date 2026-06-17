import { type ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const tooltipCls = styles.class('nb-tooltip', {
  background: color.border,
  color: color.bg,
  fontFamily: font.familySans,
  fontSize: font.sizeXs,
  fontWeight: font.w600,
  padding: `${space.xs} ${space.sm}`,
  borderRadius: '0',
  maxWidth: '280px',
  zIndex: 1001,
  animation: 'nb-fadein 100ms ease',
});

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
        {withArrow && <OverlayArrow><svg width={8} height={8}><path d="M0 0 L4 4 L8 0" fill="black"/></svg></OverlayArrow>}
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
