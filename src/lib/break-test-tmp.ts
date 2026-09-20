// break-test: prefer-const is an ESLint ERROR (not warning) in this
// config; breakTestVal is never reassigned.
export function breakTestNoop(): number {
  let breakTestVal = 1;
  return breakTestVal;
}
