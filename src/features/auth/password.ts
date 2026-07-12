import { hash, verify } from "@node-rs/argon2";

const passwordHashOptions = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string) {
  return hash(password, passwordHashOptions);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}
