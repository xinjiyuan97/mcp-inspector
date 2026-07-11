import { useMemo, useState } from "react";
import { FormField, FormJsonArea } from "./ui/FormControls";

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
}

type FormValues = Record<string, unknown>;

function resolveType(prop: JsonSchemaProperty): string {
  if (Array.isArray(prop.type)) {
    return prop.type.find((t) => t !== "null") ?? "string";
  }
  return prop.type ?? "string";
}

function isLongTextField(name: string, prop: JsonSchemaProperty): boolean {
  const type = resolveType(prop);
  if (type !== "string") return false;
  return (
    name === "prompt" ||
    name.includes("instruction") ||
    (prop.description?.length ?? 0) > 80
  );
}

export function buildInitialValues(schema: unknown, defaults?: Record<string, unknown>): FormValues {
  if (!schema || typeof schema !== "object") return {};
  const props = (schema as { properties?: Record<string, JsonSchemaProperty> }).properties ?? {};
  const values: FormValues = {};
  for (const [key, prop] of Object.entries(props)) {
    if (defaults && defaults[key] !== undefined && defaults[key] !== "") {
      values[key] = defaults[key];
    } else if (prop.default !== undefined) {
      values[key] = prop.default;
    } else if (resolveType(prop) === "boolean") {
      values[key] = false;
    } else if (resolveType(prop) === "number" || resolveType(prop) === "integer") {
      values[key] = "";
    } else {
      values[key] = "";
    }
  }
  return values;
}

export function buildArgsFromForm(values: FormValues, schema: unknown): Record<string, unknown> {
  const required = new Set(
    ((schema as { required?: string[] })?.required ?? []) as string[],
  );
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === false) {
      result[key] = false;
      continue;
    }
    if (value === "" || value === undefined || value === null) {
      if (required.has(key)) {
        result[key] = value;
      }
      continue;
    }
    if (typeof value === "string" && (resolveType((schema as any)?.properties?.[key] ?? {}) === "number" || resolveType((schema as any)?.properties?.[key] ?? {}) === "integer")) {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        result[key] = num;
        continue;
      }
    }
    result[key] = value;
  }
  return result;
}

export function canRenderForm(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as { type?: string; properties?: Record<string, unknown> };
  return s.type === "object" && !!s.properties && Object.keys(s.properties).length > 0;
}

export default function ToolForm({
  schema,
  values,
  onChange,
}: {
  schema: unknown;
  values: FormValues;
  onChange: (values: FormValues) => void;
}) {
  const [showSchema, setShowSchema] = useState(false);
  const properties = useMemo(() => {
    if (!canRenderForm(schema)) return [];
    const props = (schema as { properties: Record<string, JsonSchemaProperty> }).properties;
    const required = new Set((schema as { required?: string[] }).required ?? []);
    return Object.entries(props).map(([name, prop]) => ({
      name,
      prop,
      required: required.has(name),
      type: resolveType(prop),
    }));
  }, [schema]);

  if (!canRenderForm(schema)) {
    return (
      <FormJsonArea
        value={typeof values.__raw === "string" ? values.__raw : "{}"}
        onChange={(raw) => onChange({ __raw: raw })}
      />
    );
  }

  const updateField = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="space-y-3">
      {properties.map(({ name, prop, required, type }) => (
        <FormField
          key={name}
          label={name}
          description={prop.description}
          required={required}
          type={type}
          value={values[name]}
          onChange={(value) => updateField(name, value)}
          enumOptions={prop.enum}
          multiline={isLongTextField(name, prop)}
        />
      ))}

      <button
        type="button"
        onClick={() => setShowSchema((v) => !v)}
        className="ra-link-button"
      >
        {showSchema ? "隐藏 Schema" : "查看 Schema"}
      </button>
      {showSchema && (
        <pre className="max-h-40 overflow-auto rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-400">
          {JSON.stringify(schema, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function parseFormArgs(values: FormValues, schema: unknown): Record<string, unknown> {
  if (!canRenderForm(schema)) {
    const raw = values.__raw;
    if (typeof raw !== "string" || !raw.trim()) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  }

  const args = buildArgsFromForm(values, schema);
  const props = (schema as { properties?: Record<string, JsonSchemaProperty> }).properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) continue;
    const type = resolveType(prop);
    if ((type === "array" || type === "object") && typeof value === "string" && value.trim()) {
      args[key] = JSON.parse(value);
    }
  }
  return args;
}

export function validateForm(values: FormValues, schema: unknown): string | null {
  if (!canRenderForm(schema)) {
    try {
      parseFormArgs(values, schema);
      return null;
    } catch {
      return "JSON 参数格式不正确";
    }
  }
  const required = (schema as { required?: string[] }).required ?? [];
  for (const key of required) {
    const value = values[key];
    if (value === "" || value === undefined || value === null) {
      return `请填写必填字段: ${key}`;
    }
  }
  try {
    parseFormArgs(values, schema);
    return null;
  } catch {
    return "复杂字段 JSON 格式不正确";
  }
}
