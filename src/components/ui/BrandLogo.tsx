import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';

const appIcon = require('../../../assets/images/icon.png');

type Props = {
  size?: number;
  iconSize?: number;
  radius?: number;
};

export function BrandLogo({ size = 32, radius = 10 }: Props) {
  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: radius,
        },
      ]}>
      <Image
        source={appIcon}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: radius,
          },
        ]}
        contentFit="cover"
      />
      <View
        pointerEvents="none"
        style={[
          styles.innerRim,
          {
            borderRadius: radius,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  innerRim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
  },
});
