import { resource } from '@angular/core';
import { debounce, required, schema, validateAsync } from '@angular/forms/signals';
import { mark } from './timeline';

export interface Signup {
  username: string;
}

export interface SignupOptions {
  /** How long the fake availability check takes. */
  checkMs?: number;
  /** The `debounce` option of validateAsync: delays only this validator. */
  validatorDebounceMs?: number;
  /** The `debounce()` schema rule: delays the write from the input to the model. */
  fieldDebounceMs?: number;
  /** Called when the check really starts. */
  onCheckStarted?: (name: string) => void;
  /** Called when the check's answer comes back. */
  onCheckAnswered?: (name: string, taken: boolean) => void;
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The fake availability endpoint behind the validator. */
export async function isTaken(name: string, ms: number): Promise<boolean> {
  mark(`check started for "${name}"`);
  await delay(ms);
  const taken = name === 'khaled';
  mark(`check answered "${name}": ${taken ? 'taken' : 'free'}`);
  return taken;
}

/** The fake POST. "raced" stands for a name somebody took after the check said it was free. */
export async function createAccount(name: string): Promise<'created' | 'taken'> {
  mark(`request left with "${name}"`);
  await delay(50);
  mark('request answered');
  return name === 'raced' ? 'taken' : 'created';
}

export function signupSchema(options: SignupOptions = {}) {
  const { checkMs = 200, validatorDebounceMs, fieldDebounceMs } = options;

  return schema<Signup>((path) => {
    required(path.username);

    if (fieldDebounceMs !== undefined) {
      debounce(path.username, fieldDebounceMs);
    }

    validateAsync(path.username, {
      params: ({ value }) => value(),
      debounce: validatorDebounceMs,
      factory: (params) =>
        resource({
          params,
          loader: async ({ params: name }) => {
            options.onCheckStarted?.(name);
            const taken = await isTaken(name, checkMs);
            options.onCheckAnswered?.(name, taken);
            return taken;
          },
        }),
      onSuccess: (taken) =>
        taken ? { kind: 'taken', message: 'That name is taken.' } : undefined,
      onError: () => undefined,
    });
  });
}
