import { EncryptJWT, base64url } from "jose";

export async function encryptJWE<T extends string | object>(
  payload: T,
  expirationTime: string,
  secret: string | undefined = process.env.JWE_SECRET,
): Promise<string> {
  if (!secret) throw new Error("Missing JWE secret");
  return new EncryptJWT(payload as Record<string, unknown>)
    .setExpirationTime(expirationTime)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(base64url.decode(secret));
}
