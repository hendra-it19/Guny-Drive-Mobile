import { ActionPressable } from '@/components/ui/ActionPressable';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Browser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Fingerprint,
  Globe,
  KeyRound,
  LogIn,
  Mail,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { Segmented } from '@/components/ui/Segmented';
import { Surface } from '@/components/ui/Surface';
import { FontFamily, Spacing } from '@/constants/theme';
import { useApp } from '@/context/app-context';
import { useAppTheme } from '@/context/theme-context';
import { configuredServer } from '@/lib/api';
import {
  consumePendingOAuthVerifier,
  loadStoredPasskey,
  savePendingOAuthVerifier,
} from '@/lib/credentials';

Browser.maybeCompleteAuthSession();

type AuthMode = 'login' | 'register' | 'token';

const MODE_ORDER: readonly AuthMode[] = ['login', 'register', 'token'];

function extractErrorMessage(
  data: {
    message?: string;
    errors?: Record<string, string[] | string>;
  } | null,
  fallback: string,
): string {
  if (data?.errors && typeof data.errors === 'object') {
    for (const value of Object.values(data.errors)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return value[0];
      }
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  if (typeof data?.message === 'string' && data.message.trim().length > 0) {
    return data.message;
  }
  return fallback;
}

export default function ConnectServerScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ code?: string }>();
  const { palette, themeId, scheme } = useAppTheme();
  const { credentials, me, passkeyInfo, connectServer } = useApp();

  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [verifiedInfo, setVerifiedInfo] = useState<string | null>(null);

  const [mode, setMode] = useState<AuthMode>('login');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');

  // Dedicated OTP activation page state
  const [otpPageOpen, setOtpPageOpen] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const otpInputRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);
  const handledGrantCodesRef = useRef<Set<string>>(new Set());

  // Animations for tab shifting & page transition
  const [tabShiftX] = useState(() => new Animated.Value(0));
  const [tabOpacity] = useState(() => new Animated.Value(1));
  const [pageSlideX] = useState(() => new Animated.Value(0));
  const [pageOpacity] = useState(() => new Animated.Value(1));

  const animateModeSwitch = (nextMode: AuthMode) => {
    if (nextMode === mode || connecting) return;
    const prevIdx = MODE_ORDER.indexOf(mode);
    const nextIdx = MODE_ORDER.indexOf(nextMode);
    const direction = nextIdx >= prevIdx ? 1 : -1;

    setMode(nextMode);
    setErrorText(null);
    setVerifiedInfo(null);

    tabShiftX.setValue(direction * 30);
    tabOpacity.setValue(0.35);

    Animated.parallel([
      Animated.spring(tabShiftX, {
        toValue: 0,
        damping: 20,
        stiffness: 230,
        mass: 0.75,
        useNativeDriver: true,
      }),
      Animated.timing(tabOpacity, {
        toValue: 1,
        duration: 185,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const openOtpPage = useCallback(
    (infoMessage?: string) => {
      setErrorText(null);
      setVerificationCode('');
      setVerifiedInfo(
        infoMessage ||
          'Kode OTP 6 digit dan tautan verifikasi telah dikirim ke email Anda.',
      );
      setOtpPageOpen(true);

      pageSlideX.setValue(48);
      pageOpacity.setValue(0.3);

      Animated.parallel([
        Animated.spring(pageSlideX, {
          toValue: 0,
          damping: 20,
          stiffness: 220,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(pageOpacity, {
          toValue: 1,
          duration: 210,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(() => otpInputRef.current?.focus(), 100);
      });
    },
    [pageOpacity, pageSlideX],
  );

  const confirmAndCloseOtpPage = useCallback(() => {
    setConfirmExitOpen(false);
    setOtpPageOpen(false);
    setVerificationCode('');
    setErrorText(null);
    setVerifiedInfo(null);
    setMode('login');

    pageSlideX.setValue(-42);
    pageOpacity.setValue(0.35);

    Animated.parallel([
      Animated.spring(pageSlideX, {
        toValue: 0,
        damping: 20,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.timing(pageOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pageOpacity, pageSlideX]);

  useEffect(() => {
    if (!otpPageOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setConfirmExitOpen(true);
      return true;
    });
    return () => sub.remove();
  }, [otpPageOpen]);

  const exchangeGrantCode = useCallback(
    async (grantCode: string, verifier: string) => {
      if (handledGrantCodesRef.current.has(grantCode)) {
        return;
      }
      handledGrantCodesRef.current.add(grantCode);
      setConnecting(true);
      setErrorText(null);
      try {
        const base = configuredServer();
        const response = await fetch(`${base}/api/v1/auth/exchange`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: grantCode, verifier, theme: themeId, scheme }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.token) {
          throw Error(extractErrorMessage(data, 'Autentikasi Google gagal.'));
        }
        await connectServer(data.token);
        router.replace('/(tabs)');
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : 'Login Google gagal.');
      } finally {
        setConnecting(false);
      }
    },
    [connectServer, router, scheme, themeId],
  );

  // Handle deep-linked Google OAuth grant code (?code=...) if Android resumed Activity via deep link
  useEffect(() => {
    const incomingCode =
      typeof searchParams.code === 'string' ? searchParams.code.trim() : '';
    if (!incomingCode || handledGrantCodesRef.current.has(incomingCode)) {
      return;
    }

    void (async () => {
      const savedVerifier = await consumePendingOAuthVerifier();
      if (savedVerifier) {
        await exchangeGrantCode(incomingCode, savedVerifier);
      }
    })();
  }, [exchangeGrantCode, searchParams.code]);

  const handlePasskeyBiometricLogin = async () => {
    setConnecting(true);
    setErrorText(null);
    setVerifiedInfo(null);
    try {
      const stored = passkeyInfo ?? (await loadStoredPasskey());
      if (!stored?.passkeyToken) {
        throw Error(
          'Passkey belum diaktifkan di perangkat ini. Masuk terlebih dahulu dengan email/kata sandi atau Google, lalu klik "Aktifkan" pada menu Passkey Biometrik di Profil.',
        );
      }

      if (Platform.OS !== 'web') {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware || !isEnrolled) {
          throw Error(
            'Sensor sidik jari atau wajah belum aktif pada perangkat ini.',
          );
        }

        const biometricResult = await LocalAuthentication.authenticateAsync({
          promptMessage: `Masuk ke GunyDrive (${stored.email})`,
          cancelLabel: 'Batal',
          fallbackLabel: 'Gunakan PIN Perangkat',
        });

        if (!biometricResult.success) {
          return;
        }
      }

      const base = configuredServer();
      const response = await fetch(`${base}/api/v1/auth/passkey/login`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passkey_token: stored.passkeyToken }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.token) {
        throw Error(
          extractErrorMessage(
            data,
            'Passkey tidak berlaku. Silakan masuk dengan akun Anda lalu aktifkan kembali Passkey di Profil.',
          ),
        );
      }

      await connectServer(data.token);
      router.replace('/(tabs)');
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Login Passkey gagal.');
    } finally {
      setConnecting(false);
    }
  };

  const authenticate = async (
    provider?: 'google',
    resend = false,
    forceLogin = false,
  ) => {
    setErrorText(null);
    if (!resend) {
      setVerifiedInfo(null);
    }

    if (provider === 'google') {
      setConnecting(true);
      try {
        const base = configuredServer();
        const verifier = (Crypto.randomUUID() + Crypto.randomUUID()).replaceAll('-', '');
        const challenge = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          verifier,
        );
        await savePendingOAuthVerifier(verifier);

        const returnUrl = Linking.createURL('settings/connect');
        const startUrl = `${base}/mobile/start?provider=google&challenge=${challenge}&return_url=${encodeURIComponent(returnUrl)}`;

        let deepLinkedCode: string | null = null;
        const linkingSub = Linking.addEventListener('url', (event) => {
          try {
            const parsed = Linking.parse(event.url);
            const rawCode = parsed.queryParams?.code;
            if (typeof rawCode === 'string' && rawCode.length > 0) {
              deepLinkedCode = rawCode;
            }
          } catch {
            // Ignore malformed URL
          }
        });

        let result: Browser.WebBrowserAuthSessionResult;
        try {
          // Uses system Chrome Custom Tabs / ASWebAuthenticationSession so Google accounts
          // already signed in on the user's device are automatically recognized!
          result = await Browser.openAuthSessionAsync(startUrl, returnUrl);
        } finally {
          linkingSub.remove();
        }

        let grantCode: string | null = deepLinkedCode;
        if (!grantCode && result.type === 'success' && result.url) {
          try {
            const parsed = Linking.parse(result.url);
            const rawCode = parsed.queryParams?.code;
            if (typeof rawCode === 'string' && rawCode.length > 0) {
              grantCode = rawCode;
            } else {
              grantCode = new URL(result.url).searchParams.get('code');
            }
          } catch {
            grantCode = null;
          }
        }

        if (!grantCode) {
          const pollRes = await fetch(
            `${base}/api/v1/auth/poll?challenge=${encodeURIComponent(challenge)}`,
            {
              method: 'GET',
              headers: { Accept: 'application/json' },
            },
          ).catch(() => null);
          const pollData = await pollRes?.json().catch(() => null);
          if (typeof pollData?.code === 'string' && pollData.code.length > 0) {
            grantCode = pollData.code;
          }
        }

        if (!grantCode) {
          if (result.type === 'cancel' || result.type === 'dismiss') {
            return;
          }
          throw Error('Kode autentikasi Google tidak diterima.');
        }

        await consumePendingOAuthVerifier();
        await exchangeGrantCode(grantCode, verifier);
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : 'Gagal membuka login Google.');
      } finally {
        setConnecting(false);
      }
      return;
    }

    setConnecting(true);
    try {
      const base = configuredServer();
      const effectiveMode = forceLogin ? 'login' : mode;

      if (!identity.trim()) {
        throw Error(
          effectiveMode === 'register'
            ? 'Masukkan alamat email untuk mendaftar.'
            : 'Masukkan email atau username Anda.',
        );
      }
      if (!password) {
        throw Error('Masukkan kata sandi Anda.');
      }
      if (effectiveMode === 'register' && password.length < 8) {
        throw Error('Kata sandi minimal 8 karakter.');
      }

      const path = resend ? 'verification/resend' : effectiveMode;
      const body =
        effectiveMode === 'register'
          ? { email: identity.trim(), password }
          : { login: identity.trim(), password };

      const response = await fetch(`${base}/api/v1/auth/${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...body, theme: themeId, scheme }),
      });

      const data = await response.json().catch(() => null);
      if (data?.code === 'email_verification_required') {
        if (!otpPageOpen) {
          openOtpPage(data.message);
        } else {
          setErrorText(
            'Akun belum terverifikasi. Masukkan 6 digit kode OTP atau klik tautan verifikasi di email Anda terlebih dahulu.',
          );
        }
        return;
      }

      if (!response.ok) {
        throw Error(extractErrorMessage(data, 'Autentikasi gagal.'));
      }

      if (resend) {
        setVerifiedInfo(
          data?.message ||
            'Kode OTP 6 digit dan tautan verifikasi baru telah dikirim ke email Anda.',
        );
        return;
      }

      if (!data?.token) throw Error('Token perangkat belum diterima.');
      await connectServer(data.token);
      setPassword('');
      setVerificationCode('');
      setOtpPageOpen(false);
      router.replace('/(tabs)');
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : 'Koneksi gagal.');
    } finally {
      setConnecting(false);
    }
  };

  const handleVerifyCode = async () => {
    const cleanCode = verificationCode.replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      setErrorText('Masukkan lengkap 6 digit angka kode OTP dari email Anda.');
      return;
    }
    if (!identity.trim()) {
      setErrorText('Email atau username tidak ditemukan.');
      return;
    }

    setConnecting(true);
    setErrorText(null);
    setVerifiedInfo(null);
    try {
      const base = configuredServer();
      const response = await fetch(`${base}/api/v1/auth/verification/verify`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          login: identity.trim(),
          code: cleanCode,
          password: password || undefined,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw Error(
          extractErrorMessage(
            data,
            'Kode OTP 6 digit tidak valid atau sudah kedaluwarsa.',
          ),
        );
      }

      setVerificationCode('');

      if (data?.token) {
        await connectServer(data.token);
        setPassword('');
        setOtpPageOpen(false);
        router.replace('/(tabs)');
        return;
      }

      setOtpPageOpen(false);
      setMode('login');
      setVerifiedInfo(
        data?.message || 'Akun berhasil diaktifkan! Silakan masuk.',
      );
    } catch (e) {
      setErrorText(
        e instanceof Error ? e.message : 'Gagal memverifikasi kode OTP 6 digit.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!token.trim()) {
      setErrorText('Isi token perangkat dari dashboard Akses API.');
      return;
    }
    setConnecting(true);
    setErrorText(null);
    setVerifiedInfo(null);
    try {
      const info = await connectServer(token);
      setVerifiedInfo(
        `Terhubung ke ${info.server.name} sebagai ${info.owner.name} (${info.device?.name ?? 'Perangkat'}).`,
      );
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 900);
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : 'Gagal terhubung ke server. Periksa koneksi dan token.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const digits = verificationCode.padEnd(6, ' ').split('').slice(0, 6);

  return (
    <AuroraBackdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollPad}
          keyboardShouldPersistTaps="handled">
          <Animated.View
            style={{
              opacity: pageOpacity,
              transform: [{ translateX: pageSlideX }],
            }}>
            {otpPageOpen ? (
              /* ============================================================
               * DEDICATED OTP ACCOUNT ACTIVATION PAGE
               * ============================================================ */
              <View>
                <ActionPressable
                  onPress={() => setConfirmExitOpen(true)}
                  style={styles.backRow}
                  accessibilityRole="button"
                  accessibilityLabel="Kembali ke halaman login">
                  <ChevronLeft size={22} color={palette.accent} strokeWidth={2.2} />
                  <AppText weight="semibold" size={15} color="accent">
                    Kembali
                  </AppText>
                </ActionPressable>

                <View style={styles.headerBrandRow}>
                  <BrandLogo size={38} iconSize={21} radius={12} />
                  <AppText weight="extrabold" size={28} style={{ letterSpacing: -0.8 }}>
                    Aktivasi Akun
                  </AppText>
                </View>
                <AppText size={13} color="secondary" style={{ marginBottom: 16 }}>
                  Selesaikan verifikasi email untuk mengaktifkan akun GunyDrive Anda.
                </AppText>

                <Surface solid style={styles.formCard}>
                  <View
                    style={[
                      styles.emailBadge,
                      {
                        backgroundColor: palette.activeBg,
                        borderColor: palette.border,
                      },
                    ]}>
                    <Mail size={16} color={palette.accent} strokeWidth={2.2} />
                    <AppText
                      weight="bold"
                      size={13}
                      color="accent"
                      style={{ flex: 1 }}
                      numberOfLines={1}>
                      {identity.trim()}
                    </AppText>
                  </View>

                  <View
                    style={[
                      styles.infoCard,
                      {
                        backgroundColor: palette.background,
                        borderColor: palette.border,
                      },
                    ]}>
                    <AppText weight="bold" size={13.5}>
                      2 Cara Aktivasi di Email Anda:
                    </AppText>
                    <View style={styles.infoStep}>
                      <View
                        style={[
                          styles.stepCircle,
                          { backgroundColor: palette.activeBg },
                        ]}>
                        <AppText weight="extrabold" size={11} color="accent">
                          1
                        </AppText>
                      </View>
                      <AppText size={12.5} color="secondary" style={{ flex: 1 }}>
                        <AppText weight="bold" size={12.5}>
                          Kode OTP 6 Digit:{' '}
                        </AppText>
                        Masukkan 6 digit angka yang tertera di dalam email pada kotak di
                        bawah ini.
                      </AppText>
                    </View>
                    <View style={styles.infoStep}>
                      <View
                        style={[
                          styles.stepCircle,
                          { backgroundColor: palette.activeBg },
                        ]}>
                        <AppText weight="extrabold" size={11} color="accent">
                          2
                        </AppText>
                      </View>
                      <AppText size={12.5} color="secondary" style={{ flex: 1 }}>
                        <AppText weight="bold" size={12.5}>
                          Link Verifikasi Langsung:{' '}
                        </AppText>
                        Atau klik tombol/tautan verifikasi di dalam email (yang akan
                        membuka halaman informasi bahwa akun telah aktif), lalu ketuk{' '}
                        <AppText weight="semibold" size={12.5} color="accent">
                          &ldquo;Sudah Verifikasi Lewat Link? Masuk&rdquo;
                        </AppText>
                        .
                      </AppText>
                    </View>
                  </View>

                  <View style={{ gap: 8 }}>
                    <AppText weight="semibold" size={13}>
                      Masukkan Kode OTP 6 Digit
                    </AppText>
                    <Pressable
                      onPress={() => otpInputRef.current?.focus()}
                      style={styles.otpSlotsRow}
                      accessibilityRole="button"
                      accessibilityLabel="Kotak input 6 digit kode OTP">
                      {digits.map((char, idx) => {
                        const isCurrent =
                          idx === verificationCode.length ||
                          (verificationCode.length === 6 && idx === 5);
                        const isFilled = char.trim().length > 0;
                        return (
                          <View
                            key={idx}
                            style={[
                              styles.otpSlot,
                              {
                                backgroundColor: palette.background,
                                borderColor: isCurrent
                                  ? palette.accent
                                  : isFilled
                                    ? palette.accent
                                    : palette.border,
                                borderWidth: isCurrent ? 2 : 1,
                              },
                            ]}>
                            <AppText
                              weight="extrabold"
                              size={22}
                              style={{
                                color: isFilled ? palette.text : palette.textSecondary,
                              }}
                              tabular>
                              {isFilled ? char : '·'}
                            </AppText>
                          </View>
                        );
                      })}
                      <TextInput
                        ref={otpInputRef}
                        value={verificationCode}
                        onChangeText={(val) => {
                          const cleaned = val.replace(/\D/g, '').slice(0, 6);
                          setVerificationCode(cleaned);
                          if (errorText) setErrorText(null);
                        }}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                        caretHidden
                        style={styles.hiddenOtpInput}
                        accessibilityLabel="Input Kode OTP 6 Digit"
                      />
                    </Pressable>
                  </View>

                  {errorText ? (
                    <View style={styles.statusRow}>
                      <ShieldAlert size={16} color={palette.danger} />
                      <AppText
                        weight="semibold"
                        size={12.5}
                        color="danger"
                        style={{ flex: 1 }}>
                        {errorText}
                      </AppText>
                    </View>
                  ) : null}

                  {verifiedInfo ? (
                    <View style={styles.statusRow}>
                      <CheckCircle2 size={16} color={palette.success} />
                      <AppText
                        weight="semibold"
                        size={12.5}
                        color="success"
                        style={{ flex: 1 }}>
                        {verifiedInfo}
                      </AppText>
                    </View>
                  ) : null}

                  <ActionPressable
                    disabled={connecting}
                    onPress={() => void handleVerifyCode()}
                    accessibilityRole="button"
                    style={[styles.submitBtn, { backgroundColor: palette.accent }]}>
                    {connecting ? (
                      <ActivityIndicator color={palette.onAccent} />
                    ) : (
                      <>
                        <KeyRound
                          size={17}
                          color={palette.onAccent}
                          strokeWidth={2.2}
                        />
                        <AppText weight="bold" size={15} color="onAccent">
                          Verifikasi Kode OTP &amp; Masuk
                        </AppText>
                      </>
                    )}
                  </ActionPressable>

                  <ActionPressable
                    disabled={connecting}
                    onPress={() => void authenticate(undefined, false, true)}
                    accessibilityRole="button"
                    style={[
                      styles.providerBtn,
                      {
                        borderColor: palette.accent,
                        backgroundColor: palette.activeBg,
                      },
                    ]}>
                    <ExternalLink size={16} color={palette.accent} />
                    <AppText weight="bold" size={13.5} color="accent">
                      Sudah Verifikasi Lewat Link? Masuk
                    </AppText>
                  </ActionPressable>

                  <ActionPressable
                    disabled={connecting}
                    onPress={() => void authenticate(undefined, true, true)}
                    accessibilityRole="button"
                    style={[styles.providerBtn, { borderColor: palette.border }]}>
                    <RefreshCw size={15} color={palette.textSecondary} />
                    <AppText weight="semibold" size={13} color="secondary">
                      Kirim ulang kode OTP &amp; link email
                    </AppText>
                  </ActionPressable>
                </Surface>
              </View>
            ) : (
              /* ============================================================
               * MAIN AUTHENTICATION PAGE (MASUK / DAFTAR / TOKEN)
               * ============================================================ */
              <View>
                {credentials ? (
                  <ActionPressable
                    onPress={() => router.back()}
                    style={styles.backRow}
                    accessibilityRole="button">
                    <ChevronLeft
                      size={22}
                      color={palette.accent}
                      strokeWidth={2.2}
                    />
                    <AppText weight="semibold" size={15} color="accent">
                      Pengaturan
                    </AppText>
                  </ActionPressable>
                ) : null}

                <View style={styles.headerBrandRow}>
                  <BrandLogo size={38} iconSize={21} radius={12} />
                  <AppText
                    weight="extrabold"
                    size={30}
                    style={{ letterSpacing: -0.8 }}>
                    Akun GunyDrive
                  </AppText>
                </View>
                <AppText size={13} color="secondary" style={{ marginBottom: 18 }}>
                  Masuk atau daftar untuk membuka berkas dan melanjutkan backup.
                </AppText>

                <Surface solid style={styles.formCard}>
                  {me ? (
                    <View
                      style={[
                        styles.connectedNote,
                        { backgroundColor: palette.activeBg },
                      ]}>
                      <CheckCircle2 size={17} color={palette.success} />
                      <AppText weight="semibold" size={12.5} style={{ flex: 1 }}>
                        Saat ini terhubung sebagai {me.owner.name} (
                        {me.device?.name ?? 'Perangkat'})
                      </AppText>
                    </View>
                  ) : null}

                  <Segmented
                    options={[
                      { value: 'login', label: 'Masuk' },
                      { value: 'register', label: 'Daftar' },
                      { value: 'token', label: 'Token' },
                    ]}
                    value={mode}
                    onChange={animateModeSwitch}
                  />

                  <Animated.View
                    style={{
                      gap: 14,
                      opacity: tabOpacity,
                      transform: [{ translateX: tabShiftX }],
                    }}>
                    {mode !== 'token' ? (
                      <View style={styles.field}>
                        <AppText weight="semibold" size={13}>
                          {mode === 'register' ? 'Email' : 'Email atau username'}
                        </AppText>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: palette.text,
                              borderColor: palette.border,
                              backgroundColor: palette.background,
                            },
                          ]}
                          value={identity}
                          onChangeText={setIdentity}
                          placeholder={
                            mode === 'register'
                              ? 'nama@email.com'
                              : 'nama@email.com atau username'
                          }
                          placeholderTextColor={palette.textSecondary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType={
                            mode === 'register' ? 'email-address' : 'default'
                          }
                          accessibilityLabel={
                            mode === 'register' ? 'Email' : 'Email atau username'
                          }
                        />
                        <AppText weight="semibold" size={13}>
                          Kata sandi
                        </AppText>
                        <TextInput
                          style={[
                            styles.input,
                            {
                              color: palette.text,
                              borderColor: palette.border,
                              backgroundColor: palette.background,
                            },
                          ]}
                          value={password}
                          onChangeText={setPassword}
                          placeholder={
                            mode === 'register'
                              ? 'Minimal 8 karakter'
                              : 'Masukkan kata sandi'
                          }
                          placeholderTextColor={palette.textSecondary}
                          secureTextEntry
                          autoComplete={
                            mode === 'register'
                              ? 'new-password'
                              : 'current-password'
                          }
                          accessibilityLabel="Kata sandi"
                        />
                      </View>
                    ) : (
                      <View style={styles.field}>
                        <AppText weight="semibold" size={13}>
                          Token Perangkat
                        </AppText>
                        <TextInput
                          value={token}
                          onChangeText={setToken}
                          placeholder="gd_dev_..."
                          placeholderTextColor={palette.textSecondary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry
                          style={[
                            styles.input,
                            {
                              borderColor: palette.border,
                              backgroundColor: palette.background,
                              color: palette.text,
                              fontFamily: FontFamily.medium,
                            },
                          ]}
                        />
                      </View>
                    )}

                    {errorText ? (
                      <View style={styles.statusRow}>
                        <ShieldAlert size={16} color={palette.danger} />
                        <AppText
                          weight="semibold"
                          size={12.5}
                          color="danger"
                          style={{ flex: 1 }}>
                          {errorText}
                        </AppText>
                      </View>
                    ) : null}

                    {verifiedInfo ? (
                      <View style={styles.statusRow}>
                        <CheckCircle2 size={16} color={palette.success} />
                        <AppText
                          weight="semibold"
                          size={12.5}
                          color="success"
                          style={{ flex: 1 }}>
                          {verifiedInfo}
                        </AppText>
                      </View>
                    ) : null}

                    <ActionPressable
                      disabled={connecting}
                      onPress={() =>
                        void (mode === 'token' ? handleConnect() : authenticate())
                      }
                      accessibilityRole="button"
                      style={[
                        styles.submitBtn,
                        { backgroundColor: palette.accent },
                      ]}>
                      {connecting ? (
                        <ActivityIndicator color={palette.onAccent} />
                      ) : (
                        <>
                          <LogIn
                            size={17}
                            color={palette.onAccent}
                            strokeWidth={2.2}
                          />
                          <AppText weight="bold" size={15} color="onAccent">
                            {mode === 'register'
                              ? 'Buat akun'
                              : mode === 'login'
                                ? 'Masuk'
                                : 'Hubungkan'}
                          </AppText>
                        </>
                      )}
                    </ActionPressable>

                    {mode === 'register' ? (
                      <ActionPressable
                        accessibilityRole="button"
                        disabled={connecting}
                        style={[styles.providerBtn, { borderColor: palette.border }]}
                        onPress={() => void authenticate('google')}>
                        <Globe size={18} color={palette.accent} />
                        <AppText weight="semibold">Daftar dengan Google</AppText>
                      </ActionPressable>
                    ) : null}

                    {mode === 'login' ? (
                      <>
                        <ActionPressable
                          accessibilityRole="button"
                          disabled={connecting}
                          style={[
                            styles.providerBtn,
                            { borderColor: palette.border },
                          ]}
                          onPress={() => void authenticate('google')}>
                          <Globe size={18} color={palette.accent} />
                          <AppText weight="semibold">Masuk dengan Google</AppText>
                        </ActionPressable>

                        <ActionPressable
                          accessibilityRole="button"
                          disabled={connecting}
                          style={[
                            styles.providerBtn,
                            {
                              borderColor: passkeyInfo
                                ? palette.accent
                                : palette.border,
                              backgroundColor: passkeyInfo
                                ? palette.activeBg
                                : 'transparent',
                            },
                          ]}
                          onPress={() => void handlePasskeyBiometricLogin()}>
                          <Fingerprint size={18} color={palette.accent} />
                          <AppText
                            weight="semibold"
                            color={passkeyInfo ? 'accent' : 'primary'}>
                            {passkeyInfo
                              ? `Masuk dengan Passkey (${passkeyInfo.username || passkeyInfo.email})`
                              : 'Masuk dengan Passkey (Sidik Jari / Wajah)'}
                          </AppText>
                        </ActionPressable>

                        <AppText size={12.5} color="secondary">
                          {passkeyInfo
                            ? 'Passkey aktif di perangkat ini. Ketuk tombol di atas untuk memindai sidik jari atau wajah.'
                            : 'Setelah masuk, Anda cukup klik "Aktifkan" pada menu Passkey Biometrik di Profil & memindai sidik jari/wajah (seperti mobile banking).'}
                        </AppText>
                      </>
                    ) : null}
                  </Animated.View>
                </Surface>
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Confirmation Dialog before closing OTP page */}
        <Modal
          visible={confirmExitOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setConfirmExitOpen(false)}>
          <View style={styles.modalBackdrop}>
            <Surface solid style={styles.confirmCard}>
              <View
                style={[
                  styles.confirmIconWrap,
                  { backgroundColor: 'rgba(217, 119, 6, 0.14)' },
                ]}>
                <AlertTriangle size={24} color={palette.warning} strokeWidth={2.2} />
              </View>
              <AppText
                weight="extrabold"
                size={18}
                style={{ textAlign: 'center', marginTop: 4 }}>
                Tutup Halaman Aktivasi OTP?
              </AppText>
              <AppText
                size={13}
                color="secondary"
                style={{ textAlign: 'center', lineHeight: 19 }}>
                Verifikasi akun untuk{' '}
                <AppText weight="bold" size={13}>
                  {identity.trim() || 'email Anda'}
                </AppText>{' '}
                belum selesai. Jika Anda kembali sekarang, halaman input OTP akan
                ditutup. Yakin ingin kembali?
              </AppText>
              <View style={styles.confirmBtnRow}>
                <ActionPressable
                  onPress={() => setConfirmExitOpen(false)}
                  accessibilityRole="button"
                  style={[
                    styles.confirmBtn,
                    {
                      borderColor: palette.border,
                      backgroundColor: palette.background,
                    },
                  ]}>
                  <AppText weight="bold" size={13.5}>
                    Tetap di Sini
                  </AppText>
                </ActionPressable>
                <ActionPressable
                  onPress={confirmAndCloseOtpPage}
                  accessibilityRole="button"
                  style={[
                    styles.confirmBtn,
                    {
                      borderColor: palette.danger,
                      backgroundColor: palette.danger,
                    },
                  ]}>
                  <AppText
                    weight="bold"
                    size={13.5}
                    style={{ color: '#FFFFFF' }}>
                    Ya, Kembali
                  </AppText>
                </ActionPressable>
              </View>
            </Surface>
          </View>
        </Modal>
      </SafeAreaView>
    </AuroraBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollPad: { paddingHorizontal: Spacing.screen, paddingBottom: 40 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 44,
    marginLeft: -6,
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    marginBottom: 6,
  },
  formCard: { padding: 18, gap: 14 },
  connectedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  infoStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  otpSlotsRow: {
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  otpSlot: {
    flex: 1,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenOtpInput: {
    position: 'absolute',
    inset: 0,
    opacity: 0.01,
  },
  field: { gap: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  providerBtn: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  submitBtn: {
    height: 48,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 11, 26, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    alignItems: 'center',
    gap: 10,
  },
  confirmIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 8,
  },
  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
