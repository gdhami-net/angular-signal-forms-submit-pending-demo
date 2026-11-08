import { Injector, effect } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';

/** Resolves once no async validator under `field` is still running. */
export function checksFinished<T>(field: FieldTree<T>, injector: Injector): Promise<void> {
  return new Promise((resolve) => {
    const watcher = effect(
      () => {
        if (!field().pending()) {
          watcher.destroy();
          resolve();
        }
      },
      { injector },
    );
  });
}
