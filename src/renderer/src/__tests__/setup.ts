export {}

if (typeof window !== 'undefined') {
  // @ts-expect-error jest-dom augments matchers globally; no ES module exports
  await import('@testing-library/jest-dom')
}
