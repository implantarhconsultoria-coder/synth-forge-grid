import { workerBaseFromSettings } from "@/lib/worker-endpoint";

function base64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export async function ensureFactoryServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      return registration;
    } catch (error) {
      console.warn("Falha ao registrar service worker:", error);
      return null;
    }
  })();

  return registrationPromise;
}

async function fetchVapidPublicKey() {
  const response = await fetch(`${workerBaseFromSettings()}/notifications/vapid-public-key`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Worker nao retornou chave publica VAPID.");
  const payload = (await response.json()) as { publicKey?: string };
  if (!payload.publicKey) throw new Error("Chave publica VAPID ausente no worker.");
  return payload.publicKey;
}

export async function subscribePushNotifications(userId?: string) {
  if (typeof window === "undefined") throw new Error("Push indisponivel no servidor.");
  if (!("Notification" in window)) throw new Error("Este navegador nao suporta notificacoes.");
  if (!("PushManager" in window)) throw new Error("Este navegador nao suporta push web.");

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permissao de notificacao negada.");
  }

  const registration = await ensureFactoryServiceWorker();
  if (!registration) throw new Error("Service worker nao registrado.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await fetchVapidPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(publicKey),
    });
  }

  const response = await fetch(`${workerBaseFromSettings()}/notifications/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: userId || null,
      subscription: subscription.toJSON(),
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    }),
  });
  if (!response.ok) {
    throw new Error("Worker recusou o cadastro de notificacao push.");
  }

  return subscription;
}

export async function unsubscribePushNotifications() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  const registration = await ensureFactoryServiceWorker();
  if (!registration) return false;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;

  await fetch(`${workerBaseFromSettings()}/notifications/subscriptions`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});

  return subscription.unsubscribe();
}

export async function sendPushTestNotification(
  title = "AI Factory",
  body = "Push de teste ativo.",
) {
  const response = await fetch(`${workerBaseFromSettings()}/notifications/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, tag: "test" }),
  });
  if (!response.ok) throw new Error("Falha ao disparar push de teste.");
  return response.json();
}
