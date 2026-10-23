import type { Translator } from '../i18n';
import type { Label } from '../navigation/model';

/** The text of a navigation label: translated when it is an i18n key, as given when it comes from the design data. */
export function labelText(t: Translator['t'], label: Label): string {
  if ('text' in label) return label.text;
  switch (label.key) {
    case 'shell.nav.home.label':
      return t('shell.nav.home.label');
    case 'shell.nav.tasks.label':
      return t('shell.nav.tasks.label');
    case 'shell.nav.notifications.label':
      return t('shell.nav.notifications.label');
  }
}
