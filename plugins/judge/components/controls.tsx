import { useId, type ComponentProps, type ReactNode } from "react";
export function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="judge-group" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="judge-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Feedback({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}

export { Input } from "./ui/input.tsx";
export { Textarea } from "./ui/textarea.tsx";
export { Checkbox } from "./ui/checkbox.tsx";
import { Button as RegistryButton } from "./ui/button.tsx";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group.tsx";
export function Button(props: ComponentProps<typeof RegistryButton>) {
  return <RegistryButton variant="outline" size="sm" {...props} />;
}
/** Fixed two/three-value domain choices do not need a popup or another catalog. */
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <fieldset>
      <legend>{label}</legend>
      <RadioGroup aria-label={label} value={value} onValueChange={onChange}>
        {options.map((option, index) => (
          <label
            className="judge-radio-label"
            key={option.value}
            htmlFor={`${id}-${index}`}
          >
            <RadioGroupItem id={`${id}-${index}`} value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
