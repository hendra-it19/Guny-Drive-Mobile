import { ActionPressable } from '@/components/ui/ActionPressable';
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  ChevronDown,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  List,
  X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { getPref, setPref } from '@/lib/storage';

import { AppText } from './AppText';
import { Surface } from './Surface';

export type FileGridLayout = 'list' | 'grid2' | 'grid3' | 'grid4';

export type FileSortOption =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc'
  | 'size_asc';

type StoredViewPref = {
  layout: FileGridLayout;
  sort: FileSortOption;
};

export const GRID_LAYOUT_OPTIONS: readonly {
  value: FileGridLayout;
  shortLabel: string;
  label: string;
  description: string;
  columns: number;
}[] = [
  {
    value: 'list',
    shortLabel: 'Daftar',
    label: 'Daftar Detail',
    description: '1 kolom dengan nama lengkap, ukuran, dan tanggal',
    columns: 1,
  },
  {
    value: 'grid2',
    shortLabel: '2×',
    label: 'Grid Besar (2 Kolom)',
    description: 'Pratinjau besar dengan info berkas yang jelas',
    columns: 2,
  },
  {
    value: 'grid3',
    shortLabel: '3×',
    label: 'Grid Sedang (3 Kolom)',
    description: 'Tampilan galeri seimbang untuk foto & berkas',
    columns: 3,
  },
  {
    value: 'grid4',
    shortLabel: '4×',
    label: 'Grid Rapat (4 Kolom)',
    description: 'Menampilkan lebih banyak pratinjau dalam satu layar',
    columns: 4,
  },
];

export const SORT_OPTIONS: readonly {
  value: FileSortOption;
  label: string;
  shortLabel: string;
}[] = [
  { value: 'newest', label: 'Tanggal Terbaru', shortLabel: 'Terbaru' },
  { value: 'oldest', label: 'Tanggal Terlama', shortLabel: 'Terlama' },
  { value: 'name_asc', label: 'Nama (A – Z)', shortLabel: 'Nama A–Z' },
  { value: 'name_desc', label: 'Nama (Z – A)', shortLabel: 'Nama Z–A' },
  { value: 'size_desc', label: 'Ukuran Terbesar', shortLabel: 'Terbesar' },
  { value: 'size_asc', label: 'Ukuran Terkecil', shortLabel: 'Terkecil' },
];

export function getSortLabel(sort: FileSortOption): string {
  return SORT_OPTIONS.find((o) => o.value === sort)?.shortLabel ?? 'Terbaru';
}

export function getGridMetrics(
  windowWidth: number,
  layout: FileGridLayout,
  horizontalPadding = Spacing.screen,
): { columns: number; gap: number; tileSize: number } {
  if (layout === 'list') {
    return {
      columns: 1,
      gap: 0,
      tileSize: Math.max(200, Math.floor(windowWidth - horizontalPadding * 2)),
    };
  }
  const columns = layout === 'grid2' ? 2 : layout === 'grid4' ? 4 : 3;
  const gap = layout === 'grid2' ? 10 : layout === 'grid4' ? 4 : 6;
  const usable = Math.max(200, windowWidth - horizontalPadding * 2 - gap * (columns - 1));
  const tileSize = Math.max(64, Math.floor(usable / columns));
  return { columns, gap, tileSize };
}

export function sortFileEntries<T>(
  items: readonly T[],
  sort: FileSortOption,
  getMeta: (item: T) => { name: string; dateMs: number; sizeBytes: number },
): T[] {
  if (items.length <= 1) return [...items];
  // Precompute metadata once per item (Schwartzian transform) to avoid repeated getter calls during O(n log n) sort
  const decorated = items.map((item) => ({ item, ...getMeta(item) }));
  decorated.sort((ma, mb) => {
    switch (sort) {
      case 'oldest':
        return ma.dateMs - mb.dateMs || (ma.name < mb.name ? -1 : ma.name > mb.name ? 1 : 0);
      case 'name_asc':
        return ma.name.localeCompare(mb.name, 'id-ID', { numeric: true, sensitivity: 'base' });
      case 'name_desc':
        return mb.name.localeCompare(ma.name, 'id-ID', { numeric: true, sensitivity: 'base' });
      case 'size_desc':
        return mb.sizeBytes - ma.sizeBytes || mb.dateMs - ma.dateMs;
      case 'size_asc':
        return ma.sizeBytes - mb.sizeBytes || mb.dateMs - ma.dateMs;
      case 'newest':
      default:
        return mb.dateMs - ma.dateMs || (ma.name < mb.name ? -1 : ma.name > mb.name ? 1 : 0);
    }
  });
  return decorated.map((d) => d.item);
}

export function useFileViewPreferences(
  prefKey: string,
  defaultLayout: FileGridLayout = 'grid3',
  defaultSort: FileSortOption = 'newest',
) {
  const [layout, setLayoutState] = useState<FileGridLayout>(defaultLayout);
  const [sort, setSortState] = useState<FileSortOption>(defaultSort);

  useEffect(() => {
    let active = true;
    void getPref<Partial<StoredViewPref>>(prefKey, {}).then((stored) => {
      if (!active) return;
      if (
        stored.layout === 'list' ||
        stored.layout === 'grid2' ||
        stored.layout === 'grid3' ||
        stored.layout === 'grid4'
      ) {
        setLayoutState(stored.layout);
      }
      if (
        stored.sort === 'newest' ||
        stored.sort === 'oldest' ||
        stored.sort === 'name_asc' ||
        stored.sort === 'name_desc' ||
        stored.sort === 'size_desc' ||
        stored.sort === 'size_asc'
      ) {
        setSortState(stored.sort);
      }
    });
    return () => {
      active = false;
    };
  }, [prefKey]);

  const setLayout = useCallback(
    (nextLayout: FileGridLayout) => {
      setLayoutState(nextLayout);
      void setPref<StoredViewPref>(prefKey, { layout: nextLayout, sort });
    },
    [prefKey, sort],
  );

  const setSort = useCallback(
    (nextSort: FileSortOption) => {
      setSortState(nextSort);
      void setPref<StoredViewPref>(prefKey, { layout, sort: nextSort });
    },
    [layout, prefKey],
  );

  return { layout, sort, setLayout, setSort };
}

function SortIcon({ sort, color, size = 16 }: { sort: FileSortOption; color: string; size?: number }) {
  switch (sort) {
    case 'oldest':
      return <CalendarArrowUp size={size} color={color} strokeWidth={2} />;
    case 'name_asc':
      return <ArrowDownAZ size={size} color={color} strokeWidth={2} />;
    case 'name_desc':
      return <ArrowUpAZ size={size} color={color} strokeWidth={2} />;
    case 'size_desc':
      return <ArrowDownWideNarrow size={size} color={color} strokeWidth={2} />;
    case 'size_asc':
      return <ArrowUpNarrowWide size={size} color={color} strokeWidth={2} />;
    case 'newest':
    default:
      return <CalendarArrowDown size={size} color={color} strokeWidth={2} />;
  }
}

function LayoutIcon({
  layout,
  color,
  size = 15,
}: {
  layout: FileGridLayout;
  color: string;
  size?: number;
}) {
  switch (layout) {
    case 'list':
      return <List size={size} color={color} strokeWidth={2.2} />;
    case 'grid2':
      return <Grid2x2 size={size} color={color} strokeWidth={2.1} />;
    case 'grid3':
      return <Grid3x3 size={size} color={color} strokeWidth={2.1} />;
    case 'grid4':
    default:
      return <LayoutGrid size={size} color={color} strokeWidth={2.1} />;
  }
}

type ToolbarProps = {
  layout: FileGridLayout;
  sort: FileSortOption;
  onChangeLayout: (next: FileGridLayout) => void;
  onChangeSort: (next: FileSortOption) => void;
  countLabel?: string;
};

export function FileViewToolbar({
  layout,
  sort,
  onChangeLayout,
  onChangeSort,
  countLabel,
}: ToolbarProps) {
  const { palette } = useAppTheme();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <View style={styles.bar}>
        {/* Left: Sort & View Settings Pill */}
        <ActionPressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Urutkan: ${getSortLabel(sort)}. Buka pengaturan urutan dan grid`}
          style={[
            styles.sortPill,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}>
          <ArrowUpDown size={13.5} color={palette.accent} strokeWidth={2.2} />
          <AppText weight="bold" size={12} color="primary" numberOfLines={1}>
            {getSortLabel(sort)}
          </AppText>
          {countLabel ? (
            <AppText weight="medium" size={11.5} color="secondary" numberOfLines={1}>
              · {countLabel}
            </AppText>
          ) : null}
          <ChevronDown size={13} color={palette.textSecondary} strokeWidth={2.2} />
        </ActionPressable>

        {/* Right: Quick 1-Tap Grid Density Switcher (List / 2x / 3x / 4x) */}
        <View
          style={[
            styles.gridGroup,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}>
          {GRID_LAYOUT_OPTIONS.map((opt) => {
            const active = layout === opt.value;
            const fg = active ? palette.segActiveFg : palette.textSecondary;
            return (
              <ActionPressable
                key={opt.value}
                onPress={() => onChangeLayout(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={[
                  styles.gridBtn,
                  active && { backgroundColor: palette.segActiveBg },
                ]}>
                {opt.value === 'list' ? (
                  <List size={14} color={fg} strokeWidth={2.2} />
                ) : (
                  <AppText
                    weight={active ? 'extrabold' : 'semibold'}
                    size={11.5}
                    style={{ color: fg }}>
                    {opt.shortLabel}
                  </AppText>
                )}
              </ActionPressable>
            );
          })}
        </View>
      </View>

      {/* Full Grid & Sorting Settings Bottom Sheet */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <Surface solid style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <AppText weight="extrabold" size={17}>
                  Tampilan Grid &amp; Urutan
                </AppText>
                <ActionPressable
                  onPress={() => setSheetOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Tutup pengaturan tampilan">
                  <X size={20} color={palette.textSecondary} />
                </ActionPressable>
              </View>

              <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
                <AppText weight="bold" size={11.5} color="secondary" style={styles.sectionLabel}>
                  TATA LETAK PREVIEW FILE
                </AppText>
                <View style={styles.layoutGridCards}>
                  {GRID_LAYOUT_OPTIONS.map((opt) => {
                    const active = layout === opt.value;
                    return (
                      <ActionPressable
                        key={opt.value}
                        onPress={() => onChangeLayout(opt.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.layoutCard,
                          {
                            backgroundColor: active ? palette.activeBg : palette.background,
                            borderColor: active ? palette.accent : palette.border,
                          },
                        ]}>
                        <View style={styles.layoutCardTop}>
                          <LayoutIcon
                            layout={opt.value}
                            color={active ? palette.accent : palette.textSecondary}
                            size={16}
                          />
                          {active ? (
                            <Check size={14} color={palette.accent} strokeWidth={2.6} />
                          ) : null}
                        </View>
                        <AppText
                          weight="bold"
                          size={12.5}
                          color={active ? 'accent' : 'primary'}
                          numberOfLines={1}>
                          {opt.label}
                        </AppText>
                      </ActionPressable>
                    );
                  })}
                </View>

                <AppText
                  weight="bold"
                  size={11.5}
                  color="secondary"
                  style={[styles.sectionLabel, { marginTop: 16 }]}>
                  URUTKAN BERKAS
                </AppText>
                <View style={styles.sortList}>
                  {SORT_OPTIONS.map((opt) => {
                    const active = sort === opt.value;
                    return (
                      <ActionPressable
                        key={opt.value}
                        onPress={() => {
                          onChangeSort(opt.value);
                          setSheetOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.sortRow,
                          {
                            backgroundColor: active ? palette.activeBg : palette.background,
                            borderColor: active ? palette.accent : palette.border,
                          },
                        ]}>
                        <SortIcon
                          sort={opt.value}
                          color={active ? palette.accent : palette.textSecondary}
                          size={16}
                        />
                        <AppText
                          weight={active ? 'bold' : 'semibold'}
                          size={13.5}
                          color={active ? 'accent' : 'primary'}
                          style={{ flex: 1 }}>
                          {opt.label}
                        </AppText>
                        {active ? (
                          <Check size={16} color={palette.accent} strokeWidth={2.6} />
                        ) : null}
                      </ActionPressable>
                    );
                  })}
                </View>
              </ScrollView>
            </Surface>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sortPill: {
    flexShrink: 1,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  gridGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 999,
    borderWidth: 1,
    gap: 2,
  },
  gridBtn: {
    minWidth: 32,
    height: 30,
    paddingHorizontal: 7,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.54)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    padding: 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: {
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  layoutGridCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  layoutCard: {
    width: '48.5%',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: 1,
    gap: 6,
  },
  layoutCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortList: {
    gap: 7,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: 1,
  },
});
