import type {
  DesktopDeviceIdentityProtector
} from "./device-identity.js";

export type DesktopSafeStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export interface DesktopSafeStorageAdapter {
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>;
  readonly getSelectedStorageBackend: () => DesktopSafeStorageBackend;
  readonly encryptStringAsync: (plainText: string) => Promise<Buffer>;
  readonly decryptStringAsync: (
    encrypted: Buffer
  ) => Promise<Readonly<{ result: string; shouldReEncrypt: boolean }>>;
}

export class DesktopSecureStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopSecureStorageUnavailableError";
  }
}

export async function createDesktopDeviceIdentityProtector({
  safeStorage,
  platform,
  requireProtectedLinuxBackend
}: {
  readonly safeStorage: Readonly<DesktopSafeStorageAdapter>;
  readonly platform: NodeJS.Platform;
  /** True for installed production builds; development/native smoke is isolated. */
  readonly requireProtectedLinuxBackend: boolean;
}): Promise<Readonly<DesktopDeviceIdentityProtector>> {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new DesktopSecureStorageUnavailableError(
      "운영체제의 안전한 자격정보 저장소를 사용할 수 없어 로컬 엔진 identity를 시작하지 않았습니다."
    );
  }
  if (platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend();
    if (
      backend === "unknown"
      || (requireProtectedLinuxBackend && backend === "basic_text")
    ) {
      throw new DesktopSecureStorageUnavailableError(
        backend === "basic_text"
          ? "Linux Secret Service/KWallet을 찾지 못해 평문 basic_text 저장소를 거부했습니다."
          : "Linux 자격정보 저장소 backend를 확인하지 못했습니다."
      );
    }
  }
  return Object.freeze({
    protect: async (plainText: string) => {
      const encrypted = await safeStorage.encryptStringAsync(plainText);
      try {
        return Uint8Array.from(encrypted);
      } finally {
        encrypted.fill(0);
      }
    },
    unprotect: async (protectedBytes: Uint8Array) => {
      const encrypted = Buffer.from(protectedBytes);
      try {
        const decrypted = await safeStorage.decryptStringAsync(encrypted);
        return decrypted.result;
      } finally {
        encrypted.fill(0);
      }
    }
  });
}
