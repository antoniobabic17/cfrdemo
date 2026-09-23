export interface TaskLabelChip {
  labelId: string;
  colorIndex: number;
  labelText: string;
}

export const PLANNER_NAMES = [
  'Pink', 'Red', 'Yellow', 'Green', 'Blue', 'Purple', 'Bronze', 'Lime',
  'Aqua', 'Gray', 'Silver', 'Brown', 'Cranberry', 'Orange', 'Peach',
  'Marigold', 'Light green', 'Dark green', 'Teal', 'Light blue',
  'Dark blue', 'Lavender', 'Plum', 'Light gray', 'Dark gray',
] as const;

export const PALETTE = [
  'bg-pink-400 text-white', 'bg-red-600 text-white', 'bg-yellow-300 text-yellow-900',
  'bg-green-600 text-white', 'bg-blue-600 text-white', 'bg-violet-600 text-white',
  'bg-amber-700 text-white', 'bg-lime-500 text-lime-900', 'bg-cyan-500 text-white',
  'bg-gray-400 text-white', 'bg-gray-300 text-gray-700', 'bg-amber-900 text-white',
  'bg-rose-800 text-white', 'bg-orange-500 text-white', 'bg-orange-300 text-orange-900',
  'bg-amber-400 text-amber-900', 'bg-emerald-400 text-emerald-900', 'bg-emerald-800 text-white',
  'bg-teal-600 text-white', 'bg-sky-400 text-sky-900', 'bg-blue-800 text-white',
  'bg-violet-300 text-violet-900', 'bg-purple-800 text-white', 'bg-slate-300 text-slate-700',
  'bg-slate-600 text-white',
] as const;

// Msdyn colorindex offsets by 192350000 for option-set values
const paletteIdx = (ci: number) => (ci >= 192350000 ? ci - 192350000 : ci) % 25;

export function labelColorClass(ci: number): string {
  return PALETTE[paletteIdx(ci)] ?? 'bg-muted text-foreground';
}

export function labelDotClass(ci: number): string {
  // Returns only the bg- portion for dot indicators
  const cls = PALETTE[paletteIdx(ci)] ?? 'bg-muted';
  return cls.split(' ')[0];
}

export function labelNameFor(text: string | undefined, colorIndex: number): string {
  return text || PLANNER_NAMES[paletteIdx(colorIndex)] || 'Label';
}
