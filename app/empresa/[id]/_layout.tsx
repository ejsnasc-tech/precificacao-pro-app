import { Stack } from "expo-router";

export default function EmpresaLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="precificacao" />
      <Stack.Screen name="financeiro" />
      <Stack.Screen name="estoque" />
      <Stack.Screen name="configuracoes" />
      <Stack.Screen name="fornecedores" />
    </Stack>
  );
}
