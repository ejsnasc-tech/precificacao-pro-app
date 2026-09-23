import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { initDB } from "@/lib/db";
import { BRAND, BG } from "@/constants/colors";
import { useAlertas } from "@/hooks/useAlertas";
import { LicencaProvider, useLicenca } from "@/lib/LicencaContext";
import AtivarScreen from "@/components/AtivarScreen";
import UpdateBanner from "@/components/UpdateBanner";

function AppContent() {
  useAlertas();
  const { licenca, carregando, onAtivado } = useLicenca();

  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!licenca) {
    return <AtivarScreen onAtivado={onAtivado} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <UpdateBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="empresa" />
        <Stack.Screen name="backup" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDB().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <LicencaProvider>
        <AppContent />
      </LicencaProvider>
    </SafeAreaProvider>
  );
}
