function toCamelCase(code) {
  return code.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function finding(code, params = {}, severity = 'error') {
  return { code, severity, messageKey: `finding.${toCamelCase(code)}`, params };
}
