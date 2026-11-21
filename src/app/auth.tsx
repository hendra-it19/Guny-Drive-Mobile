import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function OAuthRedirectRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;

  if (code) {
    return (
      <Redirect
        href={{
          pathname: '/settings/connect',
          params: { code },
        }}
      />
    );
  }

  return <Redirect href="/settings/connect" />;
}
