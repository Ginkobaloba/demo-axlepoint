// break-test: unused variable triggers an eslint error (no-unused-vars is
// an error, not a warning, in eslint-config-next's typescript config).
const unusedBreakTestVar = 123;
export const breakTestNoop = () => 1;
