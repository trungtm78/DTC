// A finding is the unit every check returns. Display text is resolved later
// from messages/<locale>.json through messageKey, never stored here.

function toCamelCase(code) {
  return code.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function finding(code, params, severity = 'error') {
  return { code, severity, messageKey: `check.finding.${toCamelCase(code)}`, params };
}
