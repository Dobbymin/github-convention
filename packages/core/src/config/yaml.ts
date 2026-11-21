/**
 * Lightweight, zero-dependency YAML parser and serializer
 * tailored for configuration files supporting objects, arrays, scalars,
 * comments, and multi-level indentation.
 */

const isWhitespaceOrComment = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
};

const getIndentation = (line: string): number => {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
};

const parseScalar = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "~") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "{}") {
    return {};
  }
  if (/^-?\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  // Remove inline comments if unquoted
  const commentIndex = trimmed.indexOf(" #");
  if (commentIndex !== -1) {
    return parseScalar(trimmed.slice(0, commentIndex));
  }
  return trimmed;
};

interface LineItem {
  indent: number;
  content: string;
  lineNo: number;
}

export const parseYaml = (yamlText: string): unknown => {
  const trimmedInput = yamlText.trim();
  if (trimmedInput.startsWith("{") && trimmedInput.endsWith("}")) {
    try {
      return JSON.parse(trimmedInput);
    } catch {
      // Fall through to YAML parser
    }
  }

  const rawLines = yamlText.split(/\r?\n/);
  const lines: LineItem[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isWhitespaceOrComment(line)) continue;
    const indent = getIndentation(line);
    const content = line.trim();
    lines.push({ indent, content, lineNo: i + 1 });
  }

  if (lines.length === 0) {
    return {};
  }

  let index = 0;

  const parseBlock = (currentIndent: number): unknown => {
    if (index >= lines.length) return null;

    const firstLine = lines[index];
    const isList = firstLine.content.startsWith("-");

    if (isList) {
      const result: unknown[] = [];
      while (index < lines.length) {
        const item = lines[index];
        if (item.indent < currentIndent) break;
        if (item.indent > currentIndent) {
          // Inner block belonging to previous item, handled below
          break;
        }
        if (!item.content.startsWith("-")) break;

        const afterDash = item.content.slice(1).trim();
        index++;

        if (afterDash === "") {
          // Nested block under list item
          if (index < lines.length && lines[index].indent > item.indent) {
            result.push(parseBlock(lines[index].indent));
          } else {
            result.push(null);
          }
        } else if (
          afterDash.includes(":") &&
          !afterDash.startsWith('"') &&
          !afterDash.startsWith("'")
        ) {
          // Inline object in list item, e.g. - key: val
          const colonIdx = afterDash.indexOf(":");
          const key = afterDash.slice(0, colonIdx).trim();
          const valStr = afterDash.slice(colonIdx + 1).trim();
          const obj: Record<string, unknown> = {};
          if (valStr === "") {
            if (index < lines.length && lines[index].indent > item.indent) {
              obj[key] = parseBlock(lines[index].indent);
            } else {
              obj[key] = null;
            }
          } else {
            obj[key] = parseScalar(valStr);
          }
          // Check if there are other keys at the same nested level
          while (index < lines.length && lines[index].indent > item.indent) {
            const nextLine = lines[index];
            if (nextLine.content.startsWith("-")) break;
            const nextColon = nextLine.content.indexOf(":");
            if (nextColon === -1) break;
            const nextKey = nextLine.content.slice(0, nextColon).trim();
            const nextVal = nextLine.content.slice(nextColon + 1).trim();
            index++;
            if (nextVal === "") {
              if (index < lines.length && lines[index].indent > nextLine.indent) {
                obj[nextKey] = parseBlock(lines[index].indent);
              } else {
                obj[nextKey] = null;
              }
            } else {
              obj[nextKey] = parseScalar(nextVal);
            }
          }
          result.push(obj);
        } else {
          result.push(parseScalar(afterDash));
        }
      }
      return result;
    } else {
      const result: Record<string, unknown> = {};
      while (index < lines.length) {
        const item = lines[index];
        if (item.indent < currentIndent) break;
        if (item.indent > currentIndent) {
          // Unexpected indentation skip or error
          break;
        }

        const colonIdx = item.content.indexOf(":");
        if (colonIdx === -1) {
          index++;
          continue;
        }

        const key = item.content.slice(0, colonIdx).trim();
        const valuePart = item.content.slice(colonIdx + 1).trim();
        index++;

        if (valuePart === "") {
          // Next lines may be nested
          if (index < lines.length && lines[index].indent > item.indent) {
            result[key] = parseBlock(lines[index].indent);
          } else {
            result[key] = null;
          }
        } else {
          result[key] = parseScalar(valuePart);
        }
      }
      return result;
    }
  };

  return parseBlock(lines[0].indent);
};

export const stringifyYaml = (value: unknown, indentLevel = 0): string => {
  const indent = "  ".repeat(indentLevel);

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    if (
      value === "" ||
      /[:#\n\r\t'"]/.test(value) ||
      /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(value)
    ) {
      return JSON.stringify(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const innerYaml = stringifyYaml(item, indentLevel + 1).trimStart();
          return `${indent}- ${innerYaml}`;
        }
        return `${indent}- ${stringifyYaml(item, indentLevel + 1)}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (
          typeof v === "object" &&
          v !== null &&
          (!Array.isArray(v) || (v as unknown[]).length > 0)
        ) {
          if (Array.isArray(v)) {
            const arrStr = stringifyYaml(v, indentLevel + 1);
            return `${indent}${k}:\n${arrStr}`;
          }
          const nested = stringifyYaml(v, indentLevel + 1);
          return `${indent}${k}:\n${nested}`;
        }
        return `${indent}${k}: ${stringifyYaml(v, indentLevel)}`;
      })
      .join("\n");
  }

  return String(value);
};
