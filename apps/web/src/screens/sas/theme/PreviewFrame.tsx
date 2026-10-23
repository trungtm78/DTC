import { useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import { previewDocument } from './preview';
import type { PreviewMode, PreviewText } from './preview';
import type { ThemeConfig } from './types';

/** The sample words of the preview page, in the language of the screen. */
export function usePreviewText(): PreviewText {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      overview: t('sas.theme.preview.overview.text'),
      projects: t('sas.theme.preview.projects.text'),
      disbursement: t('sas.theme.preview.disbursement.text'),
      notifications: t('sas.theme.preview.notifications.text'),
      metricLabel: t('sas.theme.preview.metricLabel.text'),
      metricUnit: t('sas.theme.preview.metricUnit.text'),
      metricStatus: t('sas.theme.preview.metricStatus.text'),
      action: t('sas.theme.preview.action.text'),
      note: t('sas.theme.preview.note.text'),
    }),
    [t],
  );
}

export interface PreviewFrameProps {
  config: ThemeConfig;
  mode: PreviewMode;
  title: string;
  id?: string;
}

/**
 * The theme on a sample page, in a frame of its own. `sandbox=""` gives the document no permission at all (no script, no
 * form, no access to the application), and the document carries its own style: nothing of a draft reaches the screen
 * around it, and the screen's stylesheet does not reach the sample.
 */
export function PreviewFrame({ config, mode, title, id }: PreviewFrameProps) {
  const { locale } = useTranslation();
  const text = usePreviewText();
  const document = useMemo(() => previewDocument(config, mode, text, locale), [config, mode, text, locale]);
  return <iframe id={id} sandbox="" title={title} srcDoc={document} />;
}
