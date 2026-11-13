import { style, t } from '../styles/system';

export const dataCardTile = style('data-card-tile', {
  flex: 1,
  minWidth: '120px',
});

export const dataCardLabel = style('data-card-label', {
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const dataCardValueHero = style('data-card-value-hero', {
  fontSize: t.fontSize.xl.var,
  lineHeight: 1,
});
