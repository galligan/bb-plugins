import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Card } from "./ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.tsx";

/** Match the host settings hierarchy without importing BB internals. */
export function Group({
  title,
  description,
  action,
  collapsed = false,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  collapsed?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
          {description}
        </p>
      )}
    </div>
  );
  const content = (
    <Card className="judge-group-body px-4 py-3.5">{children}</Card>
  );
  return collapsed ? (
    <details className="judge-group" aria-label={title}>
      <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        {heading}
      </summary>
      {content}
    </details>
  ) : (
    <section className="judge-group" aria-label={title}>
      <div className="judge-group-heading">
        {heading}
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {content}
    </section>
  );
}
export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{
          id?: string;
          "aria-describedby"?: string;
          "aria-label"?: string;
        }>,
        {
          id,
          "aria-label": label,
          "aria-describedby": description ? `${id}-description` : undefined,
        },
      )
    : children;
  return (
    <div className="judge-field">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-normal text-foreground">
          {label}
        </label>
        {description && (
          <p
            id={`${id}-description`}
            className="mt-0.5 text-xs leading-snug text-subtle-foreground/75"
          >
            {description}
          </p>
        )}
      </div>
      <div className="judge-control">{control}</div>
    </div>
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
import { Input as RegistryInput } from "./ui/input.tsx";
export function Input({
  className,
  ...props
}: ComponentProps<typeof RegistryInput>) {
  return (
    <RegistryInput className={`h-7 text-xs ${className ?? ""}`} {...props} />
  );
}
export { Textarea } from "./ui/textarea.tsx";
export { Checkbox } from "./ui/checkbox.tsx";
export { Switch } from "./ui/switch.tsx";
import { Button as RegistryButton } from "./ui/button.tsx";
export function Button({
  className,
  ...props
}: ComponentProps<typeof RegistryButton>) {
  return (
    <RegistryButton
      variant="outline"
      size="sm"
      className={`h-7 px-2 text-xs ${className ?? ""}`}
      {...props}
    />
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="judge-field">
      <label id={`${id}-label`} htmlFor={id} className="min-w-0 flex-1 text-sm">
        {label}
      </label>
      <div className="judge-control">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            id={id}
            aria-labelledby={`${id}-label`}
            className="h-7 w-full border-border/60 bg-card px-2 text-xs"
          >
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
