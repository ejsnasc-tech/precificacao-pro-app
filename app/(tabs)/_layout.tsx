import { Tabs } from "expo-router";
import { BRAND, TEXT_MUTED, CARD, BORDER } from "@/constants/colors";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BRAND,
        tabBarInactiveTintColor: TEXT_MUTED,
        tabBarStyle: {
          backgroundColor: CARD,
          borderTopColor: BORDER,
          borderTopWidth: 1,
          paddingBottom: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Empresas", tabBarIcon: ({ color }) => <TabIcon emoji="🏪" color={color} /> }}
      />
      <Tabs.Screen
        name="financeiro-pessoal"
        options={{ title: "Finanças", tabBarIcon: ({ color }) => <TabIcon emoji="💰" color={color} /> }}
      />
    </Tabs>
  );
}

function TabIcon({ emoji, color }: { emoji: string; color: string }) {
  const { Text } = require("react-native");
  return <Text style={{ fontSize: 20, opacity: color === TEXT_MUTED ? 0.5 : 1 }}>{emoji}</Text>;
}
