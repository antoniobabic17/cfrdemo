import { Label } from '../ui/label';

interface ReadOnlyFieldProps {
  label: string;
  value: string | number | null | undefined;
  formatValue?: (v: string | number) => string;
}

export function ReadOnlyField({ label, value, formatValue }: ReadOnlyFieldProps) {
  const displayValue =
    value == null
      ? '\u2014'
      : formatValue
        ? formatValue(value)
        : String(value);

  return (
    <div className="flex flex-col gap-1">
      <Label className="font-semibold">{label}</Label>
      <span className="text-sm text-foreground">{displayValue}</span>
    </div>
  );
}
