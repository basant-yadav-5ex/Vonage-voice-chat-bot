import { Vonage } from "@vonage/server-sdk";
import { readFileSync } from "fs";
import { tokenGenerate } from "@vonage/jwt";

const privateKey = readFileSync(
  process.env.VONAGE_PRIVATE_KEY_PATH,
  "utf8"
);

export const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey
});

export function generateJwt() {
  return tokenGenerate(process.env.VONAGE_APPLICATION_ID, privateKey);
}