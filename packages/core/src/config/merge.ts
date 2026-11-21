/**
 * Recursive configuration merger adhering to FR-CFG-01 and FR-CFG-02.
 * - Project settings override only supplied keys; defaults are inherited.
 * - Objects merge recursively.
 * - Arrays replace inherited arrays completely.
 * - Scalars replace inherited scalars.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = deepClone(v);
  }
  return result as T;
};

export const mergeObjects = (
  base: Record<string, unknown>,
  override?: Record<string, unknown> | null,
): Record<string, unknown> => {
  const result = deepClone(base);
  if (!override || typeof override !== "object") {
    return result;
  }

  for (const [key, overrideVal] of Object.entries(override)) {
    if (overrideVal === undefined) {
      continue;
    }

    const baseVal = result[key];

    if (Array.isArray(overrideVal)) {
      // Arrays replace entirely
      result[key] = deepClone(overrideVal);
    } else if (isPlainObject(overrideVal) && isPlainObject(baseVal)) {
      // Objects merge recursively
      result[key] = mergeObjects(baseVal, overrideVal);
    } else {
      // Scalars or type changes replace
      result[key] = deepClone(overrideVal);
    }
  }

  return result;
};
