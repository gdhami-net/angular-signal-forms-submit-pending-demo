import { ChangeDetectionStrategy, Component, Injector, computed, inject, signal } from '@angular/core';
import { FormField, form, submit } from '@angular/forms/signals';
import { checksFinished } from './checks-finished';
import { Signup, createAccount, signupSchema } from './signup';
import { mark } from './timeline';

type Strategy = 'default' | 'none' | 'all' | 'disabled' | 'wait';

/**
 * The test bench: one username field, one button. The URL picks what the button does.
 *   ?strategy=default | none | all | disabled | wait
 *   Optional: &checkMs=200 &validatorDebounceMs=300 &fieldDebounceMs=300 &start=name &flush=1
 */
@Component({
  selector: 'app-root',
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: grid; gap: 0.5rem; max-width: 20rem; }
    .status { min-height: 1.5em; }
    .error { color: crimson; }
  `,
  template: `
    <h1>Pick a username</h1>
    <p>What the button does: <code>{{ strategy }}</code></p>
    <form (submit)="send($event)" novalidate>
      <label>
        Username
        <input id="username" autocomplete="off" [formField]="f.username" />
      </label>

      <p class="status">
        @if (f().pending() || waiting()) {
          <span id="checking">Checking that name...</span>
        }
        @for (error of f.username().errors(); track error.kind) {
          <span id="error" class="error">{{ error.message }}</span>
        }
      </p>

      <button id="send" type="submit" [disabled]="blocked()">Sign up</button>
    </form>
    <p id="result">{{ result() }}</p>
  `,
})
export class App {
  private readonly injector = inject(Injector);
  private readonly query = new URLSearchParams(location.search);

  protected readonly strategy = (this.query.get('strategy') ?? 'wait') as Strategy;
  private readonly flushField = this.query.get('flush') === '1';

  private readonly model = signal<Signup>({ username: this.query.get('start') ?? '' });
  protected readonly f = form(
    this.model,
    signupSchema({
      checkMs: this.numberFromUrl('checkMs') ?? 200,
      validatorDebounceMs: this.numberFromUrl('validatorDebounceMs'),
      fieldDebounceMs: this.numberFromUrl('fieldDebounceMs'),
    }),
  );

  protected readonly waiting = signal(false);
  protected readonly result = signal('');
  protected readonly blocked = computed(
    () => this.strategy === 'disabled' && (this.f().pending() || this.f().submitting()),
  );

  private numberFromUrl(name: string): number | undefined {
    const value = this.query.get(name);
    return value === null ? undefined : Number(value);
  }

  private async post() {
    const answer = await createAccount(this.f.username().value());
    return answer === 'taken'
      ? { kind: 'taken', message: 'The server says that name is taken.', fieldTree: this.f.username }
      : undefined;
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();

    if (this.waiting()) {
      mark('ignored: already waiting');
      return;
    }

    const options = {
      action: () => this.post(),
      onInvalid: () => mark('onInvalid ran'),
    };

    let sent: boolean;
    switch (this.strategy) {
      case 'default':
        sent = await submit(this.f, options);
        break;
      case 'none':
      case 'disabled':
        sent = await submit(this.f, { ...options, ignoreValidators: 'none' });
        break;
      case 'all':
        sent = await submit(this.f, { ...options, ignoreValidators: 'all' });
        break;
      case 'wait':
        if (this.flushField) {
          this.f.username().markAsTouched();
        }
        this.waiting.set(true);
        await checksFinished(this.f, this.injector);
        this.waiting.set(false);
        sent = await submit(this.f, { ...options, ignoreValidators: 'none' });
        break;
    }

    mark(`submit returned ${sent}`);
    this.result.set(sent ? 'Sent.' : 'Not sent.');
  }
}
