import { Search, X } from 'lucide-react-native';
import React from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { FontFamily } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';

import { Surface } from './Surface';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Cari berkas dan folder',
}: Props) {
  const { palette } = useAppTheme();

  return (
    <Surface pill style={styles.container}>
      <Search size={18} color={palette.textSecondary} strokeWidth={1.8} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textSecondary}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[
          styles.input,
          {
            color: palette.text,
            fontFamily: FontFamily.medium,
          },
        ]}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Hapus pencarian"
          hitSlop={10}>
          <X size={16} color={palette.textSecondary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
});
