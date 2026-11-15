import { palette } from '@var-ui/core';

/**
 * Categorical hues for charts, dots, and role labels. Var UI semantic tones
 * (accent/success/warning/danger/info) cover status; these cover identity.
 * Literal oklch() values (not CSS vars) so they also work in SVG attributes.
 */
export const hue = {
  blue: palette['blue-6'],
  green: palette['green-6'],
  red: palette['red-6'],
  orange: palette['orange-6'],
  yellow: palette['amber-6'],
  gray: palette['gray-6'],
  cyan: palette['cyan-6'],
  violet: palette['violet-6'],
  indigo: palette['indigo-6'],
  teal: palette['teal-6'],
  grape: palette['purple-6'],
} as const;

export type Hue = keyof typeof hue;

/** Role colors for charts and visualizations. */
export const roleColor: Record<string, string> = {
  communicator: hue.grape,
  orchestrator: hue.indigo,
  planner: hue.blue,
  worker: hue.teal,
  reviewer: hue.violet,
  librarian: hue.orange,
};

/** Role color for charts/dots, falling back to a neutral gray. */
export function colorForRole(role: string): string {
  return roleColor[role] ?? hue.gray;
}

/** Token layer colors for stacked bar charts. */
export const tokenLayerColor = {
  blue: hue.blue,
  teal: hue.teal,
  gray: hue.gray,
  orange: hue.orange,
} as const;
