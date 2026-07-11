import {
  Button,
  Checkbox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Switch,
  Text,
  TextArea,
  TextField,
} from "react-aria-components";
import { usePlatform } from "../../theme/PlatformThemeProvider";

export function FormField({
  label,
  description,
  required,
  type = "text",
  value,
  onChange,
  enumOptions,
  selectOptions,
  multiline,
  disabled,
  placeholder,
}: {
  label: string;
  description?: string;
  required?: boolean;
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  enumOptions?: string[];
  selectOptions?: { value: string; label: string }[];
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const platform = usePlatform();
  const options = selectOptions ?? enumOptions?.map((opt) => ({ value: opt, label: opt }));

  if (options && options.length > 0) {
    return (
      <div className="ra-field">
        <FieldLabel name={label} required={required} description={description} />
        <Select
          aria-label={label}
          isDisabled={disabled}
          selectedKey={String(value ?? "") || null}
          onSelectionChange={(key) => onChange(key ? String(key) : "")}
          placeholder="请选择"
        >
          <Button className="ra-select-trigger">
            <SelectValue className="ra-select-value" />
            <span aria-hidden="true">▾</span>
          </Button>
          <Popover className="ra-popover" isNonModal>
            <ListBox className="ra-listbox">
              {options.map((opt) => (
                <ListBoxItem key={opt.value} id={opt.value} className="ra-listbox-item">
                  {opt.label}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      </div>
    );
  }

  if (type === "boolean") {
    const checked = Boolean(value);
    const onChecked = (next: boolean) => onChange(next);

    return (
      <div className="ra-field">
        <FieldLabel name={label} required={required} description={description} />
        {platform === "macos" ? (
          <Switch
            aria-label={label}
            isSelected={checked}
            onChange={onChecked}
            className="ra-switch"
          >
            <span className="ra-switch-track">
              <span className="ra-switch-thumb" />
            </span>
            <span>启用</span>
          </Switch>
        ) : (
          <Checkbox
            aria-label={label}
            isSelected={checked}
            onChange={onChecked}
            className="ra-checkbox"
          >
            <span className="ra-checkbox-box">✓</span>
            <span>启用</span>
          </Checkbox>
        )}
      </div>
    );
  }

  if (multiline || type === "array" || type === "object") {
    return (
      <div className="ra-field">
        <FieldLabel name={label} required={required} description={description} />
        <TextField
          aria-label={label}
          isDisabled={disabled}
          value={String(value ?? "")}
          onChange={onChange}
        >
          <TextArea
            className={`ra-textarea${type === "array" || type === "object" ? " font-mono" : ""}`}
            rows={type === "array" || type === "object" ? 3 : 4}
            placeholder={
              placeholder ??
              (type === "array" ? '["item1"]' : type === "object" ? '{"key":"value"}' : required ? "必填" : "可选")
            }
          />
        </TextField>
      </div>
    );
  }

  return (
    <div className="ra-field">
      <FieldLabel name={label} required={required} description={description} />
      <TextField
        aria-label={label}
        isDisabled={disabled}
        value={value === "" || value === undefined ? "" : String(value)}
        onChange={onChange}
      >
        <Input
          className="ra-input"
          type={type === "password" ? "password" : type === "number" || type === "integer" ? "number" : "text"}
          placeholder={placeholder ?? (required ? "必填" : "可选")}
        />
      </TextField>
    </div>
  );
}

function FieldLabel({
  name,
  required,
  description,
}: {
  name: string;
  required?: boolean;
  description?: string;
}) {
  return (
    <>
      <Label className="ra-label">
        <span className="ra-label-name">{name}</span>
        {required && <span className="ml-1 text-red-400">*</span>}
      </Label>
      {description && (
        <Text slot="description" className="ra-description">
          {description}
        </Text>
      )}
    </>
  );
}

export function FormJsonArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ra-field">
      <Label className="ra-label">参数 (JSON)</Label>
      <TextField aria-label="参数 JSON" value={value} onChange={onChange}>
        <TextArea className="ra-textarea font-mono" rows={5} placeholder="{}" />
      </TextField>
    </div>
  );
}
