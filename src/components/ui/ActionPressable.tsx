import { Pressable, StyleSheet, type PressableProps } from 'react-native';

export function ActionPressable({ style, disabled, ...props }: PressableProps) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={state => [
        typeof style === 'function' ? style(state) : style,
        disabled ? styles.disabled : state.pressed && styles.pressed,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.48 },
});
