export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const OSC = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
const CSI = /\u001B\[[0-?]*[ -\/]*[@-~]/g;
const ESCAPE = /\u001B(?:[@-_]|[ -\/][@-~]?)/g;
const DISALLOWED_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const sanitizeText = (value: string): string =>
  value
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(ESCAPE, "")
    .replace(DISALLOWED_CONTROLS, "");

export const sanitizeValue = <T extends JsonValue>(value: T): T => {
  if (typeof value === "string") {
    return sanitizeText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitizeText(key), sanitizeValue(item)]),
    ) as T;
  }
  return value;
};
