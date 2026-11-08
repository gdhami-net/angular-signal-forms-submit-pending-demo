import { ChangeDetectionStrategy, Component, Injector, inject, signal } from '@angular/core';
import { FormField, form, submit } from '@angular/forms/signals';
import { checksFinished } from './checks-finished';
import { Signup, createAccount, signupSchema } from './signup';

/** The form the post recommends: the click is kept, and sent once the check has answered. */
@Component({
  selector: 'app-root',
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .status { min-height: 1.5em; }
  `,
  template: `
    <h1>Pick a username</h1>
    <form (submit)="send($event)" novalidate>
      <label>
        Username
        <input id="username" autocomplete="off" [formField]="f.username" />
      </label>

      <p class="status">
        @if (waiting() || f().pending()) {
          <span id="checking">Checking that name...</span>
        }
        @for (error of f.username().errors(); track error.kind) {
          <span id="error">{{ error.message }}</span>
        }
      </p>

      <button id="send" type="submit" [disabled]="f().submitting()">Sign up</button>
    </form>
    <p id="result">{{ result() }}</p>
  `,
})
export class SignupForm {
  private readonly injector = inject(Injector);
  private readonly model = signal<Signup>({ username: '' });

  protected readonly f = form(this.model, signupSchema());
  protected readonly waiting = signal(false);
  protected readonly result = signal('');

  protected async send(event: Event) {
    event.preventDefault();
    if (this.waiting()) return;

    this.waiting.set(true);
    await checksFinished(this.f, this.injector);
    this.waiting.set(false);

    const sent = await submit(this.f, {
      ignoreValidators: 'none',
      action: () => this.post(),
    });
    this.result.set(sent ? 'Sent.' : 'Not sent.');
  }

  private async post() {
    const answer = await createAccount(this.f.username().value());
    return answer === 'taken'
      ? { kind: 'taken', message: 'The server says that name is taken.', fieldTree: this.f.username }
      : undefined;
  }
}
