import { createHash, timingSafeEqual } from "crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import config from "../config";
import { decryptNestedJwt } from "./jwe";

export interface SessionClaims {
  uid: number;
  roles: string[];
  expiresAt: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function verify(signedToken: string): JwtPayload | null {
  try {
    const payload = jwt.verify(signedToken, config.jwtSecret, { algorithms: ["HS256"] });
    return typeof payload === "string" ? null : payload;
  } catch {
    return null;
  }
}

class TokenService {
  public static verifyAccessToken(token: string): SessionClaims | null {
    const signedToken = decryptNestedJwt(token, config.jwtEncryptionKey);
    const payload = signedToken ? verify(signedToken) : null;

    if (
      !payload ||
      payload.scope !== undefined ||
      typeof payload.uid !== "number" ||
      typeof payload.exp !== "number" ||
      !Array.isArray(payload.roles) ||
      !payload.roles.every((role: unknown) => typeof role === "string")
    ) {
      return null;
    }

    return { uid: payload.uid, roles: payload.roles as string[], expiresAt: payload.exp * 1000 };
  }

  public static isInternalToken(token: unknown): boolean {
    return typeof token === "string" && timingSafeEqual(digest(token), digest(config.internalServiceToken));
  }
}

export default TokenService;
