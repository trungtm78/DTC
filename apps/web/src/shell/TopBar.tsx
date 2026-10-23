import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { Breadcrumb } from './Breadcrumb';
import { Icon } from './Icon';

export interface TopBarProps {
  module: string | undefined;
  title: string;
  /** The screen id to pin; undefined when the address is not a screen. */
  screenId: string | undefined;
  pinned: boolean;
  helpPath: string | undefined;
  period: string;
  drawerOpen: boolean;
  menuButton: RefObject<HTMLButtonElement>;
  onOpenDrawer(): void;
  onOpenModule(): void;
  onTogglePin(): void;
}

/** The bar above every screen: drawer button, breadcrumb, reporting period, pin and help. */
export function TopBar(props: TopBarProps) {
  const { t } = useTranslation();
  const pinLabel = props.pinned ? t('shell.nav.unpin.label') : t('shell.nav.pin.label');
  return (
    <header className="topbar workspace-topbar">
      <button
        type="button"
        className="workspace-menu-toggle"
        ref={props.menuButton}
        onClick={props.onOpenDrawer}
        aria-label={t('shell.nav.open.label')}
        aria-controls="workspace-sidebar"
        aria-expanded={props.drawerOpen}
      >
        <Icon name="menu" />
      </button>
      <Breadcrumb module={props.module} title={props.title} onOpenModule={props.onOpenModule} />
      <div className="page-utilities">
        <span className="period-label">{props.period}</span>
        {props.screenId === undefined ? null : (
          <button type="button" id="pin-current-screen" onClick={props.onTogglePin} aria-label={pinLabel} aria-pressed={props.pinned} title={t('shell.nav.pin.title')}>
            <Icon name="star" />
          </button>
        )}
        {props.helpPath === undefined ? null : (
          <Link to={props.helpPath} aria-label={t('shell.nav.help.label')}>
            <Icon name="help" />
          </Link>
        )}
      </div>
    </header>
  );
}
