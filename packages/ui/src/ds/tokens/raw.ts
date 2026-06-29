/** Raw hex values for SVG attributes and non-CSS contexts. */
export const RAW = {
  border: '#000000',
  bg: '#ffffff',
  surface: '#f9f8f6',
  dimmed: '#888888',
  muted: '#555555',
  blue: '#2563eb',
  blueLight: '#dbeafe',
  green: '#16a34a',
  greenLight: '#dcfce7',
  red: '#dc2626',
  redLight: '#fee2e2',
  orange: '#ea580c',
  orangeLight: '#ffedd5',
  gray: '#6b7280',
  grayLight: '#f3f4f6',
  grayBg: '#e5e7eb',
  cyan: '#0891b2',
  cyanLight: '#cffafe',
  violet: '#7c3aed',
  violetLight: '#ede9fe',
  indigo: '#4338ca',
  indigoLight: '#e0e7ff',
  teal: '#0f766e',
  tealLight: '#ccfbf1',
  grape: '#9333ea',
  grapeLight: '#f3e8ff',
  yellow: '#ca8a04',
  yellowLight: '#fef9c3',
} as const;

/** Role colors for charts and visualizations. */
export const roleColor: Record<string, string> = {
  communicator: RAW.grape,
  orchestrator: RAW.indigo,
  planner: RAW.blue,
  worker: RAW.teal,
  reviewer: RAW.violet,
  librarian: RAW.orange,
};

/** Token layer colors for stacked bar charts. */
export const tokenLayerColor = {
  blue: RAW.blue,
  teal: RAW.teal,
  gray: RAW.gray,
  orange: RAW.orange,
} as const;
