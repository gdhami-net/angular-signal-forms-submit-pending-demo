import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { SignupForm } from './app/signup-form';

// ?page=recommended shows the form the post recommends. Anything else shows the
// test bench, where ?strategy= picks what the button does.
const recommended = new URLSearchParams(location.search).get('page') === 'recommended';

(recommended ? bootstrapApplication(SignupForm) : bootstrapApplication(App)).catch((err) => console.error(err));
