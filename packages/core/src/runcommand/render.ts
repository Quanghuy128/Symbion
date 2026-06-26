export interface RenderRunCommandInput {
  command: string;
  requirements?: string;
  model?: string;
  option?: string;
}

/**
 * renderRunCommand — pure string render of a structured "run command" prompt.
 * `/autoplan Add emoji reactions [claude-opus-4-8] [--gate]`
 * Empty model/option are omitted cleanly. No execution — string only (v1, STATE §8 #7).
 */
export function renderRunCommand(input: RenderRunCommandInput): string {
  const parts: string[] = [`/${input.command}`];

  if (input.requirements && input.requirements.trim().length > 0) {
    parts.push(input.requirements.trim());
  }
  if (input.model && input.model.trim().length > 0) {
    parts.push(`[${input.model.trim()}]`);
  }
  if (input.option && input.option.trim().length > 0) {
    parts.push(`[${input.option.trim()}]`);
  }

  return parts.join(" ");
}
