export const TSX_IMPORT_ARGUMENTS = Object.freeze([
  "--import",
  "tsx"
] as const);

export function typescriptCommandArgs(
  scriptPath: string,
  ...args: readonly string[]
): string[] {
  return [
    ...TSX_IMPORT_ARGUMENTS,
    scriptPath,
    ...args
  ];
}
