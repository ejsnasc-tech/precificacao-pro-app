import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { BRAND, BRAND_DARK } from "@/constants/colors";

const VERSION_CHECK_URL = "https://topprecificacao.com.br/downloads/android-latest.json";

type RemoteVersion = {
  versionCode: number;
  version: string;
  apkUrl: string;
};

export default function UpdateBanner() {
  const [update, setUpdate] = useState<RemoteVersion | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const localVersionCode = Constants.expoConfig?.android?.versionCode ?? 0;

    fetch(VERSION_CHECK_URL)
      .then((res) => res.json())
      .then((data: RemoteVersion) => {
        if (data.versionCode > localVersionCode) setUpdate(data);
      })
      .catch(() => { /* sem internet ou site fora do ar: ignora silenciosamente */ });
  }, []);

  if (!update) return null;

  return (
    <View style={{ backgroundColor: BRAND, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600", flex: 1 }}>
        Nova versão disponível ({update.version})
      </Text>
      <TouchableOpacity
        onPress={() => Linking.openURL(update.apkUrl)}
        style={{ backgroundColor: BRAND_DARK, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
      >
        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Baixar</Text>
      </TouchableOpacity>
    </View>
  );
}
