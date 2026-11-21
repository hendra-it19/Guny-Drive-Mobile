import React from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';

import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

export type AppTextWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

export type AppTextProps = TextProps & {
  weight?: AppTextWeight;
  color?: 'primary' | 'secondary' | 'accent' | 'onAccent' | 'success' | 'warning' | 'danger';
  size?: number;
  tabular?: boolean;
  style?: StyleProp<TextStyle>;
};

export function AppText({
  weight = 'regular',
  color = 'primary',
  size = 14,
  tabular = false,
  style,
  ...rest
}: AppTextProps) {
  const { palette } = useAppTheme();

  const resolvedColor =
    color === 'secondary'
      ? palette.textSecondary
      : color === 'accent'
        ? palette.accent
        : color === 'onAccent'
          ? palette.onAccent
          : color === 'success'
            ? palette.success
            : color === 'warning'
              ? palette.warning
              : color === 'danger'
                ? palette.danger
                : palette.text;

  return (
    <Text
      style={[
        {
          fontFamily: FontFamily[weight],
          fontSize: size,
          color: resolvedColor,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    />
  );
}
