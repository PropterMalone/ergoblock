import { cloneElement, isValidElement, type ComponentChildren, type VNode } from 'preact';

interface ControlProps {
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export function associateSettingControl(
  children: ComponentChildren,
  id: string
): ComponentChildren {
  if (!isValidElement(children)) return children;
  const control = children as VNode<ControlProps>;
  return cloneElement(control, {
    id: control.props.id ?? id,
    'aria-labelledby': `${id}-label`,
    'aria-describedby': `${id}-description`,
  });
}

export type SettingControlProps = ControlProps;
