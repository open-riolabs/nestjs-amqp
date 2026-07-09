import { SchematicContext } from '@angular-devkit/schematics';

/**
 * Shared interactive-prompt plumbing for the YAML schematics, mirroring nest-add's behaviour:
 * prompt only when attached to a TTY, not in CI, and no flags were provided; otherwise fall back
 * to the flags/defaults so the schematics stay CI-safe and scriptable.
 */

/** Returns the `@inquirer/prompts` module when interactive, or `undefined` to signal "use defaults". */
export function loadPrompts(context: SchematicContext, flagsProvided: boolean): any | undefined {
  const isTty = !!process.stdout && !!(process.stdout as unknown as { isTTY?: boolean }).isTTY;
  const canPrompt = isTty && !process.env.CI && !flagsProvided;
  if (!canPrompt) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@inquirer/prompts');
  } catch {
    context.logger.warn('[rlb-amqp] @inquirer/prompts not found; falling back to flags/defaults.');
    return undefined;
  }
}

/** Ask for a string, or return `fallback` when non-interactive. */
export async function askText(
  prompts: any | undefined,
  message: string,
  fallback: string,
): Promise<string> {
  if (!prompts) return fallback;
  return (await prompts.input({ message, default: fallback })) || fallback;
}

/** Ask yes/no, or return `fallback` when non-interactive. */
export async function askConfirm(
  prompts: any | undefined,
  message: string,
  fallback: boolean,
): Promise<boolean> {
  if (!prompts) return fallback;
  return prompts.confirm({ message, default: fallback });
}

/** Ask to pick one of `choices`, or return `fallback` when non-interactive. */
export async function askSelect<T extends string>(
  prompts: any | undefined,
  message: string,
  choices: readonly T[],
  fallback: T,
): Promise<T> {
  if (!prompts) return fallback;
  return prompts.select({
    message,
    default: fallback,
    choices: choices.map((c) => ({ name: c, value: c })),
  });
}

/** Ask for a positive integer, or return `fallback` when non-interactive. Empty input → fallback. */
export async function askNumber(
  prompts: any | undefined,
  message: string,
  fallback: number | undefined,
): Promise<number | undefined> {
  if (!prompts) return fallback;
  const raw: string = await prompts.input({
    message,
    default: fallback === undefined ? '' : String(fallback),
  });
  if (!raw?.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Log a `created/updated/unchanged` outcome consistently across schematics. */
export function logOutcome(
  context: SchematicContext,
  what: string,
  outcome: 'created' | 'updated' | 'unchanged',
): void {
  const verb = outcome === 'created' ? 'created' : outcome === 'updated' ? 'updated' : 'already present';
  context.logger.info(`[rlb-amqp] ${what}: ${verb}.`);
}
