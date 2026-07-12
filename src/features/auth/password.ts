import { hash, verify } from "@node-rs/argon2";

const passwordHashOptions = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

const dummyPasswordHashPromise = Promise.resolve(
  "$argon2id$v=19$m=19456,t=2,p=1$Z/jH6O4vNnApI2+haR8YSA$34Wv5d2rh4L1EariNmvBNIisA4djqHjILLpv2AjxAiI",
);

export function hashPassword(password: string) {
  return hash(password, passwordHashOptions);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}

export function getDummyPasswordHash() {
  return dummyPasswordHashPromise;
}
