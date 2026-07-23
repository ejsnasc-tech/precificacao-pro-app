import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function enviarNotificacao(titulo: string, corpo: string, dados?: Record<string, unknown>): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: titulo, body: corpo, data: dados ?? {}, sound: true },
    trigger: null, // imediata
  });
}

export async function cancelarTodasNotificacoes(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
