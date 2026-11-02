import type { ReactNode } from 'react';

type WorkspacePageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode[];
  className?: string;
};

export function WorkspacePageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryActions = [],
  className = '',
}: WorkspacePageHeaderProps) {
  return (
    <header className={`workspace-page-header ${className}`.trim()}>
      <div className="workspace-page-header-copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {(primaryAction || secondaryActions.length) ? (
        <div className="workspace-page-header-actions" role="group" aria-label="Page actions">
          {secondaryActions.length ? (
            <div className="workspace-page-header-secondary-actions">
              {secondaryActions.map((action, index) => (
                <div key={`workspace-header-secondary-${index}`} className="workspace-page-header-secondary-action">{action}</div>
              ))}
            </div>
          ) : null}
          {primaryAction ? <div className="workspace-page-header-primary-action">{primaryAction}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
